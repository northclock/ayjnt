# ayjnt example: browser-tools

Demonstrates the zero-config `ayjnt/browser` wrapper around Cloudflare's
`createBrowserTools` from `agents/browser/ai` — a single import line is
all you need to wire up Browser Rendering, the Worker Loader, the
Workers AI binding, and the `nodejs_compat` flag.

## What the agent looks like

```ts
import { Agent } from "agents";
import { browserTools } from "ayjnt/browser";    // ← the trigger
import type { GeneratedEnv } from "@ayjnt/env";

export default class ResearchAgent extends Agent<GeneratedEnv, State> {
  override async onRequest(req: Request): Promise<Response> {
    const tools = browserTools(this);             // → AI-SDK ToolSet
    // pass `tools` to generateText() / streamText() etc.
  }
}
```

## What ayjnt wires up

The build picks up `import { browserTools } from "ayjnt/browser"` and
adds **four** pieces of plumbing to `.ayjnt/dist/wrangler.jsonc`:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],     // ← Loader runtime requirement
  "browser":         { "binding": "BROWSER" },  // ← Browser Rendering
  "worker_loaders":  [{ "binding": "LOADER" }], // ← sandboxed CDP execution
  "ai":              { "binding": "AI" }        // ← model for the tools
}
```

It also augments `.ayjnt/env.d.ts` with typed `BROWSER`, `LOADER`, and
`AI` fields on `GeneratedEnv` — so reading them inside the agent (via
`this.env.BROWSER` etc.) autocompletes.

Forget any of those four pieces in a hand-rolled `wrangler.jsonc` and
the runtime fails in opaque ways — that's why the framework hooks them
up the moment it sees the import.

## Try it

```sh
bun install
bun run dev
```

Then open <http://localhost:8787/research/demo> — the co-located UI
submits questions to the agent via `agent.call("investigate", [q])`
and shows the browser-tool registry that came back. Each query is
recorded into agent state and the history rendered live over the
WebSocket.

Prefer curl?

```sh
curl -X POST http://localhost:8787/research/test \
  -H 'content-type: application/json' \
  -d '{"question":"hello"}'
```

Returns the list of tool names the framework registered. Wire those
into `generateText({ model, tools, prompt })` — see the JSDoc on
`agents/research/agent.ts` for the complete LLM call shape.

## Authoring story

### `browserTools(agent, options?)`

| Argument | Type | Purpose |
|---|---|---|
| `agent` | the agent instance (`this`) | Reads `agent.env.BROWSER` and `agent.env.LOADER` |
| `options.cdpUrl`? | `string` | Override CDP endpoint (e.g. local Chromium for dev) |
| `options.cdpHeaders`? | `Record<string,string>` | Headers for the CDP URL (e.g. Cloudflare Access) |
| `options.timeout`? | `number` | Per-tool execution timeout, default 30000ms |

Returns the same `ToolSet` shape Cloudflare's `createBrowserTools`
returns — `browser_search` and `browser_execute` keyed under their
own names.

### Why "zero config"

Compare to the raw upstream usage:

```ts
// without ayjnt/browser:
import { createBrowserTools } from "agents/browser/ai";
const tools = createBrowserTools({
  browser: env.BROWSER,
  loader:  env.LOADER,
});
// + remember to add browser + worker_loaders + ai + nodejs_compat
// to wrangler.jsonc by hand.
```

vs:

```ts
// with ayjnt/browser:
import { browserTools } from "ayjnt/browser";
const tools = browserTools(this);
// framework handles wrangler.jsonc and env.d.ts.
```

You can still import `createBrowserTools` from `ayjnt/browser` if you
prefer the explicit form — the framework re-exports it for that
purpose, and the binding-injection still fires on either import shape.

## Production caveats

- **Browser Rendering must be enabled** on your Cloudflare account
  (free tier supports it for development).
- **`@cloudflare/codemode`** is a peer dependency of the agents SDK's
  browser tools — installed by this example automatically.
- **No-binding fallback for local dev**: pass `cdpUrl` to
  `browserTools(this, { cdpUrl: "http://localhost:9222" })` to point
  at a local Chromium when Browser Rendering isn't wired up.

## See also

- [Cloudflare's Browser Rendering docs](https://developers.cloudflare.com/agents/api-reference/browse-the-web/)
- [`src/runtime/browser.ts`](../../src/runtime/browser.ts) — the
  framework's tiny wrapper.
