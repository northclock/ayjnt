// Types for the optional root-level `cli.ts`.
//
// `cli.ts` is the foreground of a locally-running ayjnt app. `ayjnt run` (and
// a binary produced by `ayjnt compile`) boots the worker under a local
// workerd, hands the default export a context, and shuts everything down —
// workerd included — the moment that function settles.
//
// The important thing to understand is that a running ayjnt app spans TWO
// runtimes:
//
//   cli.ts            → Bun.     Full `Bun.$`, `Bun.file`, `bun:sqlite`,
//                                `node:fs`, argv, stdin/TTY.
//   agents/**/agent.ts → workerd. Durable Object storage, setState, alarms,
//                                workflows. No Bun APIs.
//
// That asymmetry is the point: cli.ts can read a local file, shell out to
// git, or open a native SQLite database, and feed the results into agents.
//
// Agents and workflows are reached IN-PROCESS, not over HTTP. Because cli.ts
// runs in the same process that owns the local runtime, it gets real Durable
// Object stubs and real workflow bindings — no port, no WebSocket handshake,
// no URL construction. `fetch` is still provided for the cases where you
// genuinely want to exercise the HTTP path (middleware, routing, an app.tsx
// shell).
//
// Users don't import this module directly for the context type. Codegen emits
// a project-specific `@ayjnt/cli` with `agents` and `workflows` typed against
// the actual agent classes:
//
//   import type { AyjntCli } from "@ayjnt/cli";
//
//   export default async function ({ agents, workflows }: AyjntCli) {
//     const c = agents.counter("demo");
//     console.log(await c.increment(1));
//   }

/**
 * The method surface of an agent class as seen through a Durable Object stub:
 * public methods only, every return type promisified.
 *
 * Deliberately derived from the class rather than from its `@callable`
 * methods. `cli.ts` is a privileged peer — it runs inside the same binary as
 * the agent — so it gets the same full-surface access that inter-agent
 * `getAgent<T>()` has (see src/runtime/rpc.ts). `@callable` stays what it has
 * always been: the marker for *browser* exposure.
 */
export type AgentStub<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown
    ? K
    : never]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

/** Infer an agent's state type from `Agent<Env, State>`. Falls back to
 *  `unknown` for agents that don't declare one. */
export type AgentState<T> = T extends { state: infer S } ? S : unknown;

/**
 * A handle to one agent instance. Callable methods come from the class; the
 * extras below are added by the framework.
 */
export type AgentHandle<T> = AgentStub<T> & {
  /** Raw HTTP into this instance — reaches the agent's `onRequest`, through
   *  the middleware chain, exactly as an external client would. */
  fetch(input?: string, init?: RequestInit): Promise<Response>;
  /**
   * Subscribe to live state pushes.
   *
   * Opt-in because it is the one operation that needs more than an in-process
   * stub: state pushes arrive over the agent WebSocket protocol, so calling
   * this lazily opens a connection to the bound port. Returns an unsubscribe
   * function; the framework also closes any open watchers during teardown.
   */
  watch(
    onState: (state: AgentState<T>) => void,
  ): Promise<() => void>;
};

/** A workflow binding as seen from the host. Mirrors the Cloudflare
 *  Workflows binding surface that `env.<WORKFLOW>` exposes in a worker. */
export type WorkflowHandle<Params = unknown> = {
  create(options?: {
    id?: string;
    params?: Params;
  }): Promise<WorkflowInstanceHandle>;
  get(id: string): Promise<WorkflowInstanceHandle>;
};

export type WorkflowInstanceHandle = {
  id: string;
  status(): Promise<{
    status: string;
    output?: unknown;
    error?: unknown;
  }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  terminate(): Promise<void>;
};

/**
 * The parts of the `cli.ts` context that are the same in every project.
 * Codegen extends this with project-specific `agents` and `workflows` maps.
 */
export type AyjntCliBase = {
  /** Every binding on the worker's `env`, proxied into this process. Escape
   *  hatch for bindings the framework doesn't give a nicer accessor. */
  env: Record<string, unknown>;
  /** Arguments after the executable name — `process.argv.slice(2)`. Parse
   *  these however you like; the framework claims none of them except the
   *  handful documented for `ayjnt run`. */
  argv: string[];
  /** Origin the worker is listening on, e.g. "http://localhost:8787". Useful
   *  for opening a browser or printing a link. */
  url: string;
  /** HTTP into the worker. A path is resolved against {@link url}, so
   *  `fetch("/counter/demo")` works. */
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Request shutdown. Returns once teardown has been scheduled; the process
   *  exits after the default export settles. Mainly for breaking out of a
   *  long-lived `watch` loop. */
  stop(): void;
};

/**
 * Signature of a `cli.ts` default export. `TCli` is the project's generated
 * context type — import `AyjntCli` from `@ayjnt/cli` rather than spelling
 * this out.
 */
export type CliMain<TCli extends AyjntCliBase = AyjntCliBase> = (
  cli: TCli,
) => void | Promise<void>;

/**
 * Optional identity helper for authoring `cli.ts` with inference and without
 * naming the context type:
 *
 *   import { defineCli } from "ayjnt/cli";
 *   export default defineCli(async ({ agents }) => { ... });
 *
 * Purely a type-level convenience — it returns the function unchanged.
 */
export function defineCli<TCli extends AyjntCliBase = AyjntCliBase>(
  main: CliMain<TCli>,
): CliMain<TCli> {
  return main;
}
