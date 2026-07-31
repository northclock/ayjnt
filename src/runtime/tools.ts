// Agent tools — collections of functions an agent hands to a model as tool
// calls. Two runtimes, chosen by filename:
//
//   agents/<route>/tools.ts       → runs in workerd, next to the agent.
//                                   Deploys to Cloudflare like any other
//                                   worker code.
//   agents/<route>/tools.host.ts  → runs in the Bun host process, reached over
//                                   the __AYJNT_HOST bridge. Can use `Bun.$`,
//                                   `Bun.file`, `bun:sqlite`, `node:fs` — the
//                                   things workerd has no answer for.
//
// There is deliberately no `"use host"` directive: the filename already says
// which runtime a file targets, so a directive would be redundant ceremony
// that can disagree with the path. What IS checked is the inverse mistake — a
// workerd-side `tools.ts` reaching for a Bun global — which the scanner
// catches at build time with a pointer to `tools.host.ts`.
//
// IMPORTANT: host tools cannot run on deployed Cloudflare. There is no host
// process there. `ayjnt deploy` refuses a project containing them unless the
// file opts out with the `@ayjnt-optional-on-deploy` marker, in which case
// those tools are simply absent from the deployed ToolSet.
//
// Both kinds converge on the AI-SDK `ToolSet` shape, so they compose with
// `browserTools(this)` and spread straight into `generateText`:
//
//   const tools = { ...browserTools(this), ...agentTools(this) };
//   const result = await generateText({ model, tools, messages });

import * as path from "node:path";
import { dynamicTool, jsonSchema, type Tool, type ToolSet } from "ai";
import {
  HOST_BRIDGE_BINDING,
  HOST_BRIDGE_INVOKE_PATH,
  HOST_BRIDGE_ORIGIN,
  HOST_TOOLS_BINDING,
  type HostInvokeRequest,
  type HostInvokeResponse,
  type HostToolDescriptor,
  type SideEffects,
} from "../core/hostBridge.ts";

export type { SideEffects } from "../core/hostBridge.ts";

/**
 * Declare a tool that executes on the Bun host.
 *
 * Only meaningful inside a `tools.host.ts`. The `execute` body never reaches
 * workerd — the host imports this module directly, and the worker receives
 * only `description` + `inputSchema` so it can advertise the tool to the model
 * and proxy calls back.
 *
 *   // agents/research/tools.host.ts
 *   export const gitLog = hostTool({
 *     description: "Recent commits in a repo",
 *     sideEffects: "read",
 *     inputSchema: z.object({ dir: z.string() }),
 *     execute: async ({ dir }) => await Bun.$`git -C ${dir} log --oneline -10`.text(),
 *   });
 *
 * `sideEffects` is required rather than defaulted. The arguments to a host tool
 * come from model output, which may itself be shaped by untrusted content the
 * agent ingested (an inbound email, a retrieved document, a fetched page). A
 * default would silently pick a trust level on the author's behalf; making it
 * explicit forces the one decision that actually matters here.
 */
export function hostTool<TInput, TOutput>(definition: {
  description: string;
  sideEffects: SideEffects;
  /** Zod schema (v4, so `z.toJSONSchema()` works) or a plain JSON Schema. */
  inputSchema: unknown;
  execute: (input: TInput) => TOutput | Promise<TOutput>;
}): HostToolDefinition<TInput, TOutput> {
  return { ...definition, [HOST_TOOL_BRAND]: true };
}

/** Brand so the host can tell a `hostTool()` from an incidental export. */
export const HOST_TOOL_BRAND = "__ayjntHostTool" as const;

export type HostToolDefinition<TInput = unknown, TOutput = unknown> = {
  description: string;
  sideEffects: SideEffects;
  inputSchema: unknown;
  execute: (input: TInput) => TOutput | Promise<TOutput>;
  [HOST_TOOL_BRAND]: true;
};

/**
 * Confine a model-supplied path to a directory.
 *
 * Exported because "the model passed a path" is the most common way a host tool
 * turns into a file-disclosure primitive, and doing this correctly is easy to
 * get subtly wrong: a `startsWith` check on the raw string accepts both
 * `../../etc/passwd` and a sibling directory that merely shares a name prefix
 * (`/srv/data-evil` vs `/srv/data`). Resolving first, then comparing the
 * relative path, handles both.
 *
 *   execute: async ({ file }) => Bun.file(confinePath(ROOT, file)).text()
 *
 * Pure path arithmetic, so it's usable from either runtime.
 */
export function confinePath(root: string, candidate: string): string {
  const base = path.resolve(root);
  const resolved = path.resolve(base, candidate);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `path "${candidate}" escapes the permitted directory ${base}`,
    );
  }
  return resolved;
}

/** Narrow an unknown module export to a host tool definition. */
export function isHostTool(value: unknown): value is HostToolDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    HOST_TOOL_BRAND in value &&
    (value as Record<string, unknown>)[HOST_TOOL_BRAND] === true
  );
}

/**
 * Shape we read tools off the agent instance. The generated worker entry pins
 * the workerd-side ToolSet onto the agent's prototype (same technique used for
 * `__ayjntWorkflowBinding`), and `env` carries the host bridge.
 */
type AgentWithTools = {
  __ayjntTools?: ToolSet;
  env?: {
    [HOST_BRIDGE_BINDING]?: { fetch(input: string, init?: RequestInit): Promise<Response> };
    [HOST_TOOLS_BINDING]?: HostToolDescriptor[];
  } & Record<string, unknown>;
};

/**
 * Build the merged ToolSet for an agent: its workerd-side `tools.ts` plus
 * proxies for any `tools.host.ts` the local runtime advertised.
 *
 * Returns an empty object when the agent has no tools, so it is always safe to
 * spread. Host tools are absent when running deployed (no bridge is bound),
 * which is what makes an `@ayjnt-optional-on-deploy` file degrade rather than
 * explode.
 */
export function agentTools(agent: object): ToolSet {
  const self = agent as AgentWithTools;
  const own = self.__ayjntTools ?? {};
  const env = self.env;
  const descriptors = env?.[HOST_TOOLS_BINDING];
  const bridge = env?.[HOST_BRIDGE_BINDING];

  if (!descriptors || descriptors.length === 0 || !bridge) return { ...own };

  const proxies: ToolSet = {};
  for (const d of descriptors) {
    proxies[d.toolName] = hostToolProxy(d, bridge);
  }
  // Worker-side tools win a name collision: they're in the same file tree as
  // the agent and deploy with it, so they're the less surprising winner.
  return { ...proxies, ...own };
}

/**
 * A worker-side stand-in for one host tool. `dynamicTool` is the AI-SDK
 * primitive for exactly this case — a tool whose schema is only known at
 * runtime — so the JSON Schema the host computed can be used as-is without a
 * compile-time Zod type.
 */
function hostToolProxy(
  descriptor: HostToolDescriptor,
  bridge: { fetch(input: string, init?: RequestInit): Promise<Response> },
): Tool {
  return dynamicTool({
    description: descriptor.description,
    inputSchema: jsonSchema(
      (descriptor.inputSchema ?? { type: "object" }) as Record<string, unknown>,
    ),
    execute: async (input: unknown) => {
      const payload: HostInvokeRequest = {
        route: descriptor.route,
        name: descriptor.name,
        input,
      };
      const res = await bridge.fetch(
        HOST_BRIDGE_ORIGIN + HOST_BRIDGE_INVOKE_PATH,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      // A non-2xx here is a bridge-level failure (host crashed, tool refused
      // by policy). Surface the body: it carries the host's reason, and the
      // model can often recover from a clear message.
      if (!res.ok) {
        throw new Error(
          `host tool "${descriptor.toolName}" failed (${res.status}): ${await res.text()}`,
        );
      }
      const body = (await res.json()) as HostInvokeResponse;
      if (!body.ok) throw new Error(body.error);
      return body.result;
    },
  });
}
