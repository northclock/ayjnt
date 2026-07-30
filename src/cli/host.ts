// The local runtime host: boots the generated worker under a workerd that we
// own, in-process.
//
// This is what `ayjnt run` and a binary from `ayjnt compile` both sit on top
// of, and the reason they behave identically. `ayjnt dev` deliberately does NOT
// use it — that command stays a thin wrapper around `wrangler dev`, with all of
// wrangler's own behavior.
//
// Why own the runtime at all, rather than shelling out to wrangler:
//
//   1. A compiled binary has no `bunx`, no `node_modules`, and no wrangler.
//      Driving Miniflare directly is the only way agents can run from a
//      single-file executable.
//   2. Owning the Miniflare instance means `cli.ts` gets in-process access to
//      Durable Object stubs and workflow bindings — real RPC, no HTTP, no port,
//      no handshake. Under `wrangler dev` there is no handle to ask.
//   3. Workflows have no HTTP surface in the generated entry at all. In-process
//      bindings are the only way to trigger one from outside an agent.
//
// The worker script this runs is NOT bundled by us. `ayjnt compile` shells out
// to real wrangler (`deploy --dry-run --outdir`) at build time, when
// node_modules is still available, so the bundle gets wrangler's own esbuild +
// unenv `nodejs_compat` treatment. We only ever hand Miniflare a finished
// script. That keeps bundling fidelity out of the risk surface entirely.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import * as path from "node:path";
import type { Miniflare } from "miniflare";
import {
  HOST_BRIDGE_BINDING,
  HOST_TOOLS_BINDING,
  type HostToolDescriptor,
} from "../core/hostBridge.ts";
import type { AgentEntry, Manifest } from "../core/types.ts";
import { accessorKeyPath, camelizeSegment } from "../codegen/cli.ts";
import type { AyjntCliBase } from "../runtime/cliContext.ts";

/** Default port, matching `wrangler dev` so muscle memory carries over. */
export const DEFAULT_PORT = 8787;

/** Shape of the bits of the generated wrangler config we consume. */
export type GeneratedWranglerConfig = {
  name: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  durable_objects?: { bindings: { name: string; class_name: string }[] };
  workflows?: { name: string; binding: string; class_name: string }[];
  assets?: {
    directory: string;
    binding?: string;
    html_handling?: string;
    not_found_handling?: string;
  };
  vars?: Record<string, unknown>;
  ai?: { binding: string };
  browser?: { binding: string };
  send_email?: { name: string }[];
  worker_loaders?: { binding: string }[];
};

export type HostToolInvoker = (
  route: string,
  name: string,
  input: unknown,
) => Promise<unknown>;

export type StartHostOptions = {
  /** Project root. */
  cwd: string;
  /** Parsed generated wrangler config. */
  config: GeneratedWranglerConfig;
  /** Absolute path to the bundled worker script (wrangler dry-run output). */
  scriptPath: string;
  /** Directory the script lives in — Miniflare's `modulesRoot`. */
  bundleDir: string;
  /** Absolute path to the assets tree, when the project has UIs. */
  assetsDir?: string | null;
  manifest: Manifest;
  /** Port to bind. 0 picks a free one. */
  port?: number;
  /** Override the persistence directory. */
  dataDir?: string | null;
  /** Extra plain-JSON bindings (e.g. parsed .dev.vars). */
  vars?: Record<string, string>;
  /** Host tool descriptors advertised to the worker, plus the invoker that
   *  actually runs them in this process. */
  hostTools?: {
    descriptors: HostToolDescriptor[];
    invoke: HostToolInvoker;
  } | null;
  log?: (msg: string) => void;
};

export type RunningHost = {
  /** Origin the worker is bound to, e.g. "http://localhost:8787". */
  url: string;
  mf: Miniflare;
  /** Build the context object handed to `cli.ts`. */
  buildCliContext(argv: string[], stop: () => void): Promise<AyjntCliBase>;
  /** Tear everything down: watchers, then Miniflare (which stops workerd). */
  dispose(): Promise<void>;
};

/**
 * Per-app persistence directory.
 *
 * A compiled ayjnt app is a shipped program, not a dev server, so state has to
 * outlive a single run and survive the binary being moved. That rules out both
 * `.wrangler/state` (tied to a project checkout) and a temp dir. Keyed by
 * worker name so two apps never share Durable Object storage.
 */
export function defaultDataDir(workerName: string): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "ayjnt", workerName);
    case "win32":
      return path.join(
        process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local"),
        "ayjnt",
        workerName,
      );
    default:
      return path.join(
        process.env["XDG_STATE_HOME"] ?? path.join(home, ".local", "state"),
        "ayjnt",
        workerName,
      );
  }
}

/**
 * Parse the generated wrangler.jsonc.
 *
 * The file is JSON with a generated `//` header, and users can inject arbitrary
 * `extras`. Stripping only whole-line comments is enough and avoids mangling a
 * `//` inside a string value (a URL in `vars`, most obviously).
 */
export function parseGeneratedConfig(text: string): GeneratedWranglerConfig {
  const withoutComments = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(withoutComments) as GeneratedWranglerConfig;
}

/** Parse a `.dev.vars` / dotenv-style file into a flat string map. */
export function parseDevVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, the dotenv convention.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Read the project's `.dev.vars`, if present. */
export async function readDevVars(cwd: string): Promise<Record<string, string>> {
  const file = path.join(cwd, ".dev.vars");
  if (!existsSync(file)) return {};
  return parseDevVars(await Bun.file(file).text());
}

/**
 * Translate the generated wrangler config into Miniflare options and start it.
 *
 * Bindings the framework can emit map onto Miniflare cleanly, with two
 * exceptions the caller is warned about (see `warnUnsupported`): `worker_loaders`
 * has no Miniflare equivalent at all, and `ai` / `browser` / `send_email` are
 * remote-only services that need network access plus Cloudflare credentials.
 */
export async function startHost(
  opts: StartHostOptions,
): Promise<RunningHost> {
  const log = opts.log ?? (() => {});
  const { config, manifest } = opts;

  // Imported lazily so `ayjnt build` / `dev` don't pay Miniflare's load cost.
  const { Miniflare } = await import("miniflare");

  const dataDir = opts.dataDir ?? defaultDataDir(config.name);
  mkdirSync(dataDir, { recursive: true });

  const durableObjects: Record<
    string,
    { className: string; useSQLite: boolean }
  > = {};
  for (const b of config.durable_objects?.bindings ?? []) {
    // Every ayjnt agent is a SQLite-backed Durable Object — the Agents SDK
    // requires it, which is why codegen only ever emits `new_sqlite_classes`.
    durableObjects[b.name] = { className: b.class_name, useSQLite: true };
  }

  const workflows: Record<string, { name: string; className: string }> = {};
  for (const w of config.workflows ?? []) {
    workflows[w.binding] = { name: w.name, className: w.class_name };
  }

  const bindings: Record<string, unknown> = {
    ...(config.vars ?? {}),
    ...(opts.vars ?? {}),
  };

  const serviceBindings: Record<string, unknown> = {};
  if (opts.hostTools && opts.hostTools.descriptors.length > 0) {
    bindings[HOST_TOOLS_BINDING] = opts.hostTools.descriptors;
    serviceBindings[HOST_BRIDGE_BINDING] = makeHostBridge(opts.hostTools.invoke);
  }

  const mfOptions: Record<string, unknown> = {
    // Modules are declared EXPLICITLY rather than via `scriptPath`.
    //
    // With `scriptPath`, Miniflare walks the script's AST to discover its
    // dependencies, and throws ERR_MODULE_DYNAMIC_SPEC on any `import()` whose
    // specifier isn't a literal string. Real dependency graphs contain those —
    // the `ai` package has one — even when the call sits in a try/catch for an
    // optional dependency and never executes. Since wrangler's bundler already
    // produced a self-contained bundle, there is nothing left to discover, so
    // handing Miniflare the finished modules avoids the walk entirely.
    modules: await collectModules(opts.scriptPath, opts.bundleDir),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags ?? ["nodejs_compat"],
    port: opts.port ?? DEFAULT_PORT,
    durableObjects,
    bindings,
    // Persist everything stateful into one per-app directory.
    durableObjectsPersist: dataDir,
    kvPersist: dataDir,
    r2Persist: dataDir,
    d1Persist: dataDir,
    cachePersist: dataDir,
  };

  if (Object.keys(workflows).length > 0) mfOptions["workflows"] = workflows;
  if (Object.keys(serviceBindings).length > 0) {
    mfOptions["serviceBindings"] = serviceBindings;
  }

  if (config.assets && opts.assetsDir) {
    mfOptions["assets"] = {
      directory: opts.assetsDir,
      binding: config.assets.binding ?? "ASSETS",
      // Mirror the generated config exactly. `html_handling: "none"` in
      // particular is load-bearing: the default issues a 301 for
      // `/__ayjnt/<flat>/index.html`, which leaks into the URL bar and breaks
      // the client hook's instance derivation.
      assetConfig: {
        html_handling: config.assets.html_handling ?? "none",
        not_found_handling: config.assets.not_found_handling ?? "none",
      },
    };
  }

  warnUnsupported(config, log);

  const mf = new Miniflare(mfOptions as never);
  const readyUrl = await mf.ready;
  // Trim the trailing slash so `url + "/path"` composes predictably.
  const url = readyUrl.toString().replace(/\/$/, "");

  const watchers: (() => void)[] = [];

  const buildCliContext = async (
    argv: string[],
    stop: () => void,
  ): Promise<AyjntCliBase> => {
    const env = await mf.getBindings<Record<string, unknown>>();
    return {
      env,
      argv,
      url,
      stop,
      fetch: (input: string, init?: RequestInit) =>
        mf.dispatchFetch(resolveUrl(url, input), init as never) as unknown as Promise<Response>,
      agents: await buildAgentAccessors(mf, manifest, url, watchers),
      workflows: buildWorkflowAccessors(manifest, env),
    } as AyjntCliBase;
  };

  return {
    url,
    mf,
    buildCliContext,
    dispose: async () => {
      // Watchers hold WebSockets to the very runtime we're about to stop —
      // close them first so disposal isn't racing live connections.
      for (const close of watchers) {
        try {
          close();
        } catch {
          /* already closed */
        }
      }
      await mf.dispose();
    },
  };
}

/**
 * Read the bundle's modules for Miniflare's explicit `modules` array.
 *
 * The entry must come first — Miniflare treats `modules[0]` as the worker's
 * entrypoint. Any sibling `.js` files are included too: wrangler normally emits
 * a single self-contained `entry.js`, but code splitting would produce chunks,
 * and a missing chunk fails at runtime rather than at startup.
 *
 * Paths are module-namespace-relative to the bundle directory, which is what
 * import specifiers inside the bundle resolve against.
 */
async function collectModules(
  scriptPath: string,
  bundleDir: string,
): Promise<{ type: "ESModule"; path: string; contents: string }[]> {
  const entryRel = path.relative(bundleDir, scriptPath).replace(/\\/g, "/");
  const files = existsSync(bundleDir)
    ? readdirSync(bundleDir).filter(
        (f) => f.endsWith(".js") && !f.endsWith(".map"),
      )
    : [];

  const ordered = [
    entryRel,
    ...files.filter((f) => f !== entryRel).map((f) => f),
  ];

  const modules: { type: "ESModule"; path: string; contents: string }[] = [];
  for (const rel of ordered) {
    modules.push({
      type: "ESModule",
      path: rel,
      contents: await Bun.file(path.join(bundleDir, rel)).text(),
    });
  }
  return modules;
}

/**
 * Split a compiled binary's argv into the flags the app owns and everything
 * destined for `cli.ts`.
 *
 * A compiled ayjnt app claims exactly four flags. Everything else is the user's
 * program, so this is deliberately conservative — it never consumes an unknown
 * flag, and an explicit `--` hands the whole remainder to `cli.ts` so a program
 * that wants its own `--port` can have one.
 *
 * Lives here, exported, rather than inline in the generated bootstrap: logic
 * embedded in a template string can't be unit tested, and this has exactly the
 * kind of off-by-one that wants tests. (The first version dropped `--port` but
 * left its value behind, so `cli.ts` saw a stray `8787` as a subcommand.)
 */
export function splitBinaryArgs(argv: string[]): {
  port?: number;
  dataDir?: string;
  allowWrite: boolean;
  allowExec: boolean;
  cliArgv: string[];
} {
  const out: {
    port?: number;
    dataDir?: string;
    allowWrite: boolean;
    allowExec: boolean;
    cliArgv: string[];
  } = { allowWrite: false, allowExec: false, cliArgv: [] };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      out.cliArgv.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--allow-host-writes") {
      out.allowWrite = true;
    } else if (a === "--allow-host-exec") {
      out.allowExec = true;
    } else if (a === "--port") {
      out.port = Number(argv[++i]);
    } else if (a.startsWith("--port=")) {
      out.port = Number(a.slice("--port=".length));
    } else if (a === "--data-dir") {
      out.dataDir = argv[++i];
    } else if (a.startsWith("--data-dir=")) {
      out.dataDir = a.slice("--data-dir=".length);
    } else {
      out.cliArgv.push(a);
    }
  }

  if (
    out.port !== undefined &&
    (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535)
  ) {
    throw new Error("--port must be an integer 0-65535");
  }
  return out;
}

/** Resolve a possibly-relative path against the bound origin. */
export function resolveUrl(origin: string, input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return origin + (input.startsWith("/") ? input : "/" + input);
}

/**
 * The host side of the tool bridge: a plain function Miniflare runs in THIS
 * process and exposes to the worker as a Fetcher.
 */
function makeHostBridge(invoke: HostToolInvoker) {
  return async (request: Request): Promise<Response> => {
    let payload: { route?: string; name?: string; input?: unknown };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return Response.json({ ok: false, error: "malformed bridge request" }, { status: 400 });
    }
    if (!payload.route || !payload.name) {
      return Response.json(
        { ok: false, error: "bridge request missing route or name" },
        { status: 400 },
      );
    }
    try {
      const result = await invoke(payload.route, payload.name, payload.input);
      return Response.json({ ok: true, result });
    } catch (err) {
      // Tool failures are expected traffic — a model passes a bad path, a
      // command exits non-zero. Report them as a structured error the worker
      // turns into a tool-call rejection, not as a bridge fault.
      return Response.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/**
 * Build the route-nested `agents` accessor tree.
 *
 * A route that is both a leaf and a parent (`/admin` alongside `/admin/users`)
 * becomes a function with properties hanging off it, matching the intersection
 * type codegen emits.
 */
async function buildAgentAccessors(
  mf: Miniflare,
  manifest: Manifest,
  origin: string,
  watchers: (() => void)[],
): Promise<Record<string, unknown>> {
  const root: Record<string, unknown> = {};

  for (const agent of manifest.agents) {
    const ns = await mf.getDurableObjectNamespace(agent.binding);
    const accessor = (instance = "default") =>
      makeAgentHandle(ns, agent, instance, origin, watchers);

    const keys = accessorKeyPath(agent.routePath);
    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const last = i === keys.length - 1;
      if (last) {
        // Preserve any child namespace already attached under this key.
        const existing = cursor[key];
        if (existing && typeof existing === "object") {
          Object.assign(accessor, existing);
        }
        cursor[key] = accessor;
      } else {
        if (typeof cursor[key] !== "object" && typeof cursor[key] !== "function") {
          cursor[key] = {};
        }
        cursor = cursor[key] as Record<string, unknown>;
      }
    }
  }

  return root;
}

/**
 * One agent instance handle.
 *
 * A Proxy rather than a plain object so every public method on the agent class
 * is reachable without enumerating them — `cli.ts` is a privileged peer and
 * gets the same full surface as inter-agent `getAgent<T>()`, not the
 * `@callable`-only surface a browser sees.
 *
 * The `setName` call matters: the Agents SDK keys identity messages and some
 * user code off `this.name`, and a raw `idFromName` stub has never been told
 * what it is called. The SDK's own `getAgentByName` does the same thing. We
 * memoize it so it costs one round trip per handle, not one per call.
 */
function makeAgentHandle(
  ns: { idFromName(name: string): unknown; get(id: unknown): unknown },
  agent: AgentEntry,
  instance: string,
  origin: string,
  watchers: (() => void)[],
): unknown {
  const stub = ns.get(ns.idFromName(instance)) as Record<string, unknown>;
  let named: Promise<void> | null = null;
  const ensureNamed = () => {
    named ??= (async () => {
      try {
        const setName = stub["setName"];
        if (typeof setName === "function") {
          await (setName as (n: string) => Promise<void>).call(stub, instance);
        }
      } catch {
        // Older SDKs, or an agent that overrode setName. Identity messages may
        // be less useful; every other call still works.
      }
    })();
    return named;
  };

  return new Proxy(stub, {
    get(target, prop, receiver) {
      if (prop === "watch") {
        return (onState: (state: unknown) => void) =>
          watchAgent(agent, instance, origin, onState, watchers);
      }
      if (prop === "fetch") {
        return async (input = "/", init?: RequestInit) => {
          await ensureNamed();
          const fetcher = target["fetch"] as (
            i: string,
            n?: RequestInit,
          ) => Promise<Response>;
          return fetcher.call(target, resolveUrl(origin, input), init);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        await ensureNamed();
        try {
          return await (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
        } catch (err) {
          throw translateStubError(err, agent, String(prop));
        }
      };
    },
  });
}

/**
 * Make an error from an in-process Durable Object call legible.
 *
 * Miniflare's host-side DO proxy does not propagate exceptions thrown by the
 * method. workerd returns a 4xx for an application error, and the proxy asserts
 * `!isClientError(status)` before it ever reads the body — so the caller gets
 * `AssertionError: false == true` from deep inside miniflare, with the real
 * message discarded. Worker-to-DO calls are unaffected; this is specific to
 * calling in from the host, which is exactly what cli.ts does.
 *
 * We can't recover the original message (it's dropped upstream), so the least
 * bad outcome is an error that says what happened, which call caused it, and how
 * to see the real reason. Silently surfacing the assertion would send people
 * looking for a bug in miniflare's internals.
 */
export function translateStubError(
  err: unknown,
  agent: AgentEntry,
  method: string,
): Error {
  const isProxyAssertion =
    err instanceof Error &&
    (err as { code?: string }).code === "ERR_ASSERTION" &&
    /false == true/.test(err.message);

  if (!isProxyAssertion) return err instanceof Error ? err : new Error(String(err));

  return new Error(
    `${agent.className}.${method}() threw inside the agent, and the local runtime ` +
      `cannot forward the original message (a Miniflare limitation: exceptions from ` +
      `host-initiated Durable Object calls lose their body).\n\n` +
      `To see the real error, either:\n` +
      `  • log it inside the agent method, or\n` +
      `  • return a result instead of throwing, e.g. { ok: false, error: string }, or\n` +
      `  • call it over HTTP with agents.${accessorKeyPath(agent.routePath).join(".")}(...).fetch(), ` +
      `where errors propagate normally.`,
  );
}

/**
 * Subscribe to an agent's state pushes.
 *
 * The one operation that genuinely needs the network: state broadcasts travel
 * over the agent WebSocket protocol, so this connects to the bound port using
 * the SDK's own client. `basePath` is set explicitly because ayjnt serves
 * agents at `/<route>/<instance>` rather than the SDK's default
 * `/agents/<kebab>/<name>`.
 */
async function watchAgent(
  agent: AgentEntry,
  instance: string,
  origin: string,
  onState: (state: unknown) => void,
  watchers: (() => void)[],
): Promise<() => void> {
  const { AgentClient } = await import("agents/client");
  const client = new AgentClient({
    // Ignored when basePath is set, but the SDK requires the field.
    agent: agent.className,
    // ayjnt serves agents at /<route>/<instance>, not the SDK's default
    // /agents/<kebab>/<name>, so the path is supplied explicitly.
    basePath: `${agent.routePath.slice(1)}/${instance}`,
    host: origin.replace(/^https?:\/\//, ""),
    onStateUpdate: (state: unknown) => onState(state),
  });
  await client.ready;
  const close = () => client.close();
  watchers.push(close);
  return () => {
    close();
    const i = watchers.indexOf(close);
    if (i >= 0) watchers.splice(i, 1);
  };
}

/** Workflow bindings, keyed by camelized workflow name. */
function buildWorkflowAccessors(
  manifest: Manifest,
  env: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const w of manifest.workflows) {
    const binding = env[w.binding];
    if (binding) out[camelizeSegment(w.name)] = binding;
  }
  return out;
}

/**
 * Warn about bindings the local runtime can't fully honor.
 *
 * Deliberately loud rather than silent: an agent that works under
 * `wrangler dev` and then fails opaquely here would be a bad trade for the
 * capabilities the local runtime adds.
 */
function warnUnsupported(
  config: GeneratedWranglerConfig,
  log: (msg: string) => void,
): void {
  if (config.worker_loaders && config.worker_loaders.length > 0) {
    log(
      `⚠ ayjnt: this project uses browser tools (\`ayjnt/browser\`), which need a ` +
        `\`worker_loaders\` binding. The local runtime has no equivalent, so those ` +
        `tools will fail here. Use \`ayjnt dev\` or a deployed worker for browser tools.`,
    );
  }
  const remoteOnly: string[] = [];
  if (config.ai) remoteOnly.push("ai");
  if (config.browser) remoteOnly.push("browser");
  if (config.send_email && config.send_email.length > 0) {
    remoteOnly.push("send_email");
  }
  if (remoteOnly.length > 0) {
    log(
      `⚠ ayjnt: ${remoteOnly.join(", ")} ${remoteOnly.length === 1 ? "is a" : "are"} ` +
        `remote-only Cloudflare service${remoteOnly.length === 1 ? "" : "s"} — ` +
        `${remoteOnly.length === 1 ? "it" : "they"} need network access and Cloudflare ` +
        `credentials even when the rest of the app runs locally.`,
    );
  }
}
