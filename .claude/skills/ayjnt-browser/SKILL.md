---
name: ayjnt-browser
description: Add Browser Rendering tools to an agent with one import. Use when the user asks to "let the agent browse the web", "add browser tools", "search the web", "use Cloudflare Browser Rendering", or "give the LLM access to a browser". One import of `browserTools` from `ayjnt/browser` triggers the framework to wire BROWSER, LOADER, AI, and `nodejs_compat` into wrangler.jsonc — and the helper returns an AI-SDK ToolSet you can pass straight to `generateText`.
---

# Add browser tools to an agent

`import { browserTools } from "ayjnt/browser"` is the only thing you
need to write. Detection is source-level: the moment that import is
present anywhere in your agent tree, the build provisions four
wrangler bindings.

## File shape

```ts
// agents/<route>/agent.ts
import { Agent } from "agents";
import { browserTools } from "ayjnt/browser";    // ← the trigger
import type { GeneratedEnv } from "@ayjnt/env";

type State = { /* whatever */ };

export default class ResearchAgent extends Agent<GeneratedEnv, State> {
  override async onRequest(req: Request): Promise<Response> {
    const tools = browserTools(this);
    // → AI-SDK ToolSet: { browser_search, browser_execute, ... }
    return Response.json({ tools: Object.keys(tools) });
  }
}
```

### Rules

- **Import from `ayjnt/browser`**, not `agents/browser/ai` directly.
  Both end up calling the same upstream `createBrowserTools`, but the
  ayjnt re-export is what the scanner watches for.
- **Pass the agent (`this`)** as the first arg. The helper reads
  `agent.env.BROWSER` and `agent.env.LOADER` off it.
- **Either name triggers detection.** `browserTools` and
  `createBrowserTools` are both exported; the scanner regex matches
  either symbol coming from `ayjnt/browser`.

## What ayjnt wires up

```jsonc
// .ayjnt/dist/wrangler.jsonc (auto-generated)
{
  "compatibility_flags": ["nodejs_compat"],     // Loader runtime requirement
  "browser":         { "binding": "BROWSER" },  // Browser Rendering
  "worker_loaders":  [{ "binding": "LOADER" }], // sandboxed CDP execution
  "ai":              { "binding": "AI" }        // model for the tools
}
```

```ts
// .ayjnt/env.d.ts (auto-generated)
export type GeneratedEnv = {
  // ... existing agent bindings ...
  BROWSER: Fetcher;
  LOADER: { get(name: string): Worker };
  AI: Ai;
};
```

Forget any of those four and the runtime fails in opaque ways — that's
why the framework hooks them up together.

## Wiring tools into an LLM call

```ts
import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

const tools = browserTools(this);
const ai = createWorkersAI({ binding: this.env.AI });

const result = await generateText({
  model: ai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
  tools,
  prompt: "What's the current weather in Tokyo?",
  maxSteps: 5,
});
```

The model gets `browser_search` (search the web) and `browser_execute`
(run a scripted browser session). It decides when to call them; the
SDK handles the loop.

## Options

```ts
browserTools(this, {
  cdpUrl?: string,                       // local Chromium override
  cdpHeaders?: Record<string, string>,   // e.g. Cloudflare Access
  timeout?: number,                      // per-tool, default 30000ms
});
```

## Local dev without Browser Rendering

Browser Rendering only works on Cloudflare's edge by default. For
local dev, start a local Chromium with remote debugging:

```sh
chromium --remote-debugging-port=9222
```

Then point the tools at it:

```ts
const tools = browserTools(this, { cdpUrl: "http://localhost:9222" });
```

## Cloudflare prerequisites

- **Browser Rendering enabled** on the Cloudflare account (free tier
  supports it for dev). Dashboard → Workers & Pages → Browser Rendering.
- **`@cloudflare/codemode`** is a peer dependency of the agents SDK's
  browser tools — `bun add @cloudflare/codemode`.

## Reference

- [`examples/browser-tools`](../../../examples/browser-tools) — full
  ResearchAgent with `generateText` integration.
- [`src/runtime/browser.ts`](../../../src/runtime/browser.ts) — the
  thin wrapper. Two lines of real logic.
- [Cloudflare's Browser Rendering docs](https://developers.cloudflare.com/agents/api-reference/browse-the-web/).
