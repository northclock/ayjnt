// Host side of the agent-tools bridge.
//
// Loads every `agents/<route>/tools.host.ts`, derives the schema the worker
// needs to advertise each tool to a model, and executes calls that come back
// over the bridge.
//
// The host is the only side that can do this. A `tools.host.ts` uses `Bun.$`,
// `Bun.file`, `bun:sqlite` — none of which exist in workerd — so the module can
// never be bundled into the worker. Importing it here and shipping only
// `{name, description, inputSchema}` across is what makes the split work, and
// it means schemas are always in sync with the implementation because they are
// derived from it rather than restated.
//
// SECURITY. The arguments to these functions come from model output, and that
// output may have been shaped by content the agent ingested — an inbound email,
// a retrieved document, a fetched page. A host tool is therefore a path from
// untrusted text to local code execution. Two things guard it: tools must
// declare a side-effect level, and anything above `read` needs explicit
// permission (a flag, an env var, or an interactive confirm). Neither is a
// substitute for tool authors validating their own inputs, which is why
// `confinePath` exists below.

import * as path from "node:path";
import {
  hostToolName,
  type HostToolDescriptor,
  type SideEffects,
} from "../core/hostBridge.ts";
import { isHostTool, type HostToolDefinition } from "../runtime/tools.ts";
import type { Manifest, ToolsEntry } from "../core/types.ts";
import { hostToolFiles } from "../codegen/scan.ts";

export type HostToolPolicy = {
  /** Side-effect levels permitted without asking. `read` is always included. */
  allow: Set<SideEffects>;
  /** Prompt on a TTY for levels not in `allow`. When false, they're refused. */
  interactive: boolean;
};

export type LoadedHostTools = {
  descriptors: HostToolDescriptor[];
  invoke(route: string, name: string, input: unknown): Promise<unknown>;
};

/**
 * Build a policy from flags + environment.
 *
 * `AYJNT_ALLOW_HOST_EFFECTS` takes a comma list (`write,exec`) so a compiled
 * binary can be run non-interactively in CI without rebuilding it with
 * different flags.
 */
export function resolvePolicy(opts: {
  allowWrite?: boolean;
  allowExec?: boolean;
  interactive?: boolean;
}): HostToolPolicy {
  const allow = new Set<SideEffects>(["read"]);
  if (opts.allowWrite) allow.add("write");
  if (opts.allowExec) allow.add("exec");
  for (const raw of (process.env["AYJNT_ALLOW_HOST_EFFECTS"] ?? "").split(",")) {
    const level = raw.trim();
    if (level === "read" || level === "write" || level === "exec") {
      allow.add(level);
    }
  }
  return {
    allow,
    // Only offer a prompt when someone is actually there to answer it.
    interactive: opts.interactive ?? Boolean(process.stdin.isTTY),
  };
}

/**
 * Convert a tool's declared input schema to JSON Schema.
 *
 * Accepts a Zod v4 schema (converted with the `z.toJSONSchema` that ships in
 * zod 4) or a plain JSON Schema object, which passes through untouched. Falls
 * back to a permissive object schema rather than throwing: a tool with an
 * unconvertible schema is still more useful to the model than a boot failure.
 */
export async function toJsonSchema(schema: unknown): Promise<unknown> {
  const permissive = { type: "object", additionalProperties: true };
  if (!schema || typeof schema !== "object") return permissive;

  // Order matters. A zod 4 schema exposes a `.type` string of its own
  // ("object", "string", …), so testing `"type" in schema` first would match it
  // and hand the live schema object straight through — which then fails
  // Miniflare's JSON binding validation with a wall of
  // "Expected string, received object". Identify library schemas first, and
  // only treat what's left as literal JSON Schema.
  if (isSchemaLibraryObject(schema)) {
    try {
      const zod = (await import("zod")) as unknown as {
        toJSONSchema?: (s: unknown, o?: unknown) => unknown;
        z?: { toJSONSchema?: (s: unknown, o?: unknown) => unknown };
      };
      const convert = zod.toJSONSchema ?? zod.z?.toJSONSchema;
      if (convert) {
        // `io: "input"` keeps optional and defaulted fields optional, which is
        // what a model needs to see. The output view marks them required.
        return convert(schema, { io: "input" });
      }
    } catch {
      // zod missing, or older than toJSONSchema. Fall through.
    }
    return permissive;
  }

  if ("type" in schema || "$schema" in schema || "properties" in schema) {
    return schema; // already JSON Schema
  }
  return permissive;
}

/**
 * Whether a value is a schema-library object (Zod, or anything implementing
 * Standard Schema) as opposed to a literal JSON Schema.
 *
 * Detected structurally rather than with an `instanceof`, so a project using a
 * different copy of zod than the framework resolved still works.
 */
export function isSchemaLibraryObject(value: object): boolean {
  const v = value as Record<string, unknown>;
  return (
    "_zod" in v ||
    "_def" in v ||
    "~standard" in v ||
    typeof v["parse"] === "function" ||
    typeof v["safeParse"] === "function"
  );
}

/**
 * Import every host tools file in the manifest and build the descriptor list
 * plus the invoker.
 *
 * `onWarn` reports files that exist but export nothing usable — a real
 * mistake (forgetting `hostTool(...)`) that would otherwise present as a model
 * mysteriously not having the tool.
 */
export async function loadHostTools(
  manifest: Manifest,
  policy: HostToolPolicy,
  onWarn: (msg: string) => void = () => {},
  /** How to obtain a tools module. Defaults to a dynamic `import()`, which is
   *  right on a developer machine. A compiled binary has no filesystem to
   *  import from, so its bootstrap imports the modules statically and supplies
   *  them through here instead. */
  loader: (sourceFile: string) => Promise<Record<string, unknown>> = (file) =>
    import(pathToImportUrl(file)) as Promise<Record<string, unknown>>,
): Promise<LoadedHostTools | null> {
  const files = hostToolFiles(manifest);
  if (files.length === 0) return null;

  const descriptors: HostToolDescriptor[] = [];
  const impls = new Map<string, HostToolDefinition>();

  for (const entry of files) {
    const mod = await loader(entry.sourceFile);
    let found = 0;
    for (const [exportName, value] of Object.entries(mod)) {
      if (!isHostTool(value)) continue;
      found++;
      descriptors.push({
        route: entry.routePath,
        name: exportName,
        toolName: hostToolName(entry.routePath, exportName),
        description: value.description,
        sideEffects: value.sideEffects,
        inputSchema: await toJsonSchema(value.inputSchema),
      });
      impls.set(implKey(entry.routePath, exportName), value);
    }
    if (found === 0) {
      onWarn(
        `⚠ ayjnt: ${entry.sourceFile} exports no host tools — wrap each function ` +
          `with \`hostTool({ ... })\` from "ayjnt/tools" so the framework can find it.`,
      );
    }
  }

  const granted = new Map<string, boolean>();

  return {
    descriptors,
    invoke: async (route, name, input) => {
      const impl = impls.get(implKey(route, name));
      if (!impl) {
        throw new Error(`unknown host tool ${route}#${name}`);
      }
      await authorize(impl, route, name, policy, granted);
      return await impl.execute(input);
    },
  };
}

function implKey(route: string, name: string): string {
  return `${route}#${name}`;
}

/** `import()` needs a file URL for absolute paths to work on Windows. */
function pathToImportUrl(file: string): string {
  return Bun.pathToFileURL(path.resolve(file)).href;
}

/**
 * Gate one call by its declared side-effect level.
 *
 * A granted answer is remembered for the rest of the process, per tool. An
 * agent loop can call the same tool many times, and re-prompting for each would
 * train the user to approve without reading.
 */
async function authorize(
  impl: HostToolDefinition,
  route: string,
  name: string,
  policy: HostToolPolicy,
  granted: Map<string, boolean>,
): Promise<void> {
  if (policy.allow.has(impl.sideEffects)) return;

  const key = implKey(route, name);
  const remembered = granted.get(key);
  if (remembered === true) return;
  if (remembered === false) {
    throw new Error(
      `host tool ${name} (${impl.sideEffects}) was denied earlier in this session`,
    );
  }

  if (!policy.interactive) {
    throw new Error(
      `host tool ${name} declares sideEffects: "${impl.sideEffects}", which is not ` +
        `permitted. Re-run with --allow-host-${impl.sideEffects === "exec" ? "exec" : "writes"} ` +
        `or set AYJNT_ALLOW_HOST_EFFECTS=${impl.sideEffects}.`,
    );
  }

  const ok = await confirm(
    `\n[ayjnt] An agent wants to run host tool "${name}" (${route}), ` +
      `declared sideEffects: "${impl.sideEffects}".\n` +
      `        Arguments came from model output. Allow for this session? [y/N] `,
  );
  granted.set(key, ok);
  if (!ok) throw new Error(`host tool ${name} denied by the user`);
}

/** Minimal y/N prompt on stdin. Anything other than y/yes is a no. */
async function confirm(prompt: string): Promise<boolean> {
  process.stdout.write(prompt);
  const decoder = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    const answer = decoder.decode(chunk).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }
  return false;
}

/** Re-exported so the CLI and tool authors share one implementation. Lives in
 *  the runtime module because that's what users import from (`ayjnt/tools`). */
export { confinePath } from "../runtime/tools.ts";

/** Host tool files that would block a deploy (i.e. not opted out). */
export function deployBlockingHostTools(manifest: Manifest): ToolsEntry[] {
  return hostToolFiles(manifest).filter((t) => !t.optionalOnDeploy);
}
