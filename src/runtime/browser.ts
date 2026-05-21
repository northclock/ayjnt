// Zero-config wrapper for Cloudflare Browser Rendering tools.
//
// Cloudflare's `createBrowserTools` from `agents/browser/ai` returns an
// AI-SDK `ToolSet` that drives a sandboxed Chrome DevTools Protocol
// session over the Browser Rendering and Worker Loader bindings. The
// upstream signature requires the user to pass both bindings explicitly:
//
//   import { createBrowserTools } from "agents/browser/ai";
//
//   const tools = createBrowserTools({
//     browser: env.BROWSER,
//     loader: env.LOADER,
//   });
//
// And the wrangler config needs `browser`, `worker_loaders`, and `ai`
// bindings plus the `nodejs_compat` flag. That's four pieces of plumbing
// for one feature — and forgetting any of them produces a runtime
// failure that's annoying to diagnose.
//
// ayjnt removes the plumbing: a single import from `ayjnt/browser`
// signals "this agent uses browser tools." The codegen pass detects the
// import, adds every required binding to `wrangler.jsonc`, and ensures
// `nodejs_compat` is set. At the call site, the user passes the agent
// instance and we pull bindings off `this.env`:
//
//   import { browserTools } from "ayjnt/browser";
//
//   class ResearchAgent extends Agent<GeneratedEnv, State> {
//     async onChatMessage() {
//       const tools = browserTools(this);
//       const result = await generateText({ model, tools, messages });
//       // …
//     }
//   }
//
// We re-export `createBrowserTools` directly too, so users who prefer
// the explicit upstream shape can still import it from `ayjnt/browser`
// and get the same automatic binding detection.

export { createBrowserTools } from "agents/browser/ai";
export type { BrowserToolsOptions } from "agents/browser/ai";

import {
  createBrowserTools as upstreamCreateBrowserTools,
  type BrowserToolsOptions,
} from "agents/browser/ai";

/**
 * Loose agent shape we read bindings off of. We only require `server`
 * is unset (so this isn't accidentally typed-narrowed to an `McpAgent`).
 * The actual `env` field is `protected` on Cloudflare's `Agent` base
 * class, so we cast through {@link AgentWithEnv} internally rather than
 * exposing it on this public interface — that keeps `browserTools(this)`
 * ergonomic at call sites.
 */
export type BrowserAgentLike = object;

/** Internal alias for the env field we cast `this` into. The cast is
 *  contained here so user code stays clean. Same trick the framework
 *  uses for `registerAppUi` against MCP agents. */
type AgentWithEnv = {
  env: {
    BROWSER?: Fetcher;
    LOADER: WorkerLoader;
  } & Record<string, unknown>;
};

/**
 * Extra options that mirror the upstream `BrowserToolsOptions` minus
 * the bindings (which we pull off the agent). Use this to override
 * timeout / CDP URL / headers when you need to.
 */
export type BrowserToolsRuntimeOptions = Omit<
  BrowserToolsOptions,
  "browser" | "loader"
>;

/**
 * Create the AI-SDK browser tools for the given agent instance.
 *
 * Reads `BROWSER` and `LOADER` off `agent.env` — both bindings are
 * added to your `wrangler.jsonc` automatically the moment you `import`
 * anything from `ayjnt/browser`. If `BROWSER` isn't bound (e.g. in
 * local dev without Browser Rendering enabled) you can pass a
 * `cdpUrl` override pointing at a local Chromium instance:
 *
 *   const tools = browserTools(this, {
 *     cdpUrl: "http://localhost:9222",
 *     timeout: 60_000,
 *   });
 *
 * Return type tracks Cloudflare's `createBrowserTools` exactly — the
 * AI-SDK `ToolSet` shape, ready to spread into `generateText`'s
 * `tools` field. Because `agents` is declared as a peer dep of `ayjnt`,
 * the type resolves to the consumer's own `agents`/`ai` install, so
 * there's no "two copies of `ai`" duplicated-type drama.
 */
export function browserTools(
  agent: BrowserAgentLike,
  options?: BrowserToolsRuntimeOptions,
): ReturnType<typeof upstreamCreateBrowserTools> {
  // The SDK marks `env` protected on the Agent base class, so we cast
  // through AgentWithEnv. User code keeps the simple `this`-passing
  // ergonomic; the unsafe cast is contained here.
  const env = (agent as AgentWithEnv).env;
  if (!env || !env.LOADER) {
    throw new Error(
      `browserTools: env.LOADER is not bound. The codegen adds the ` +
        `Worker Loader binding automatically when any agent imports ` +
        `from "ayjnt/browser" — make sure you've run \`bun run dev\` ` +
        `or \`ayjnt build\` so wrangler.jsonc is regenerated.`,
    );
  }
  return upstreamCreateBrowserTools({
    ...(env.BROWSER ? { browser: env.BROWSER } : {}),
    loader: env.LOADER,
    ...(options ?? {}),
  });
}
