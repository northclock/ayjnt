# ayjnt example: with-ui

Demonstrates co-located `app.tsx` — a React UI lives next to the agent, bound to it by a generated typed `useAgent()` hook. State syncs live across every connected tab via the Agents SDK's WebSocket protocol.

## Layout

```
agents/
  counter/
    agent.ts       ← CounterAgent (state: { count: number })
    app.tsx        ← React UI importing from @ayjnt/counter
```

## How the pieces fit

1. You write `agents/counter/app.tsx`. It imports `{ useAgent } from "@ayjnt/counter"`.
2. `ayjnt build` generates `.ayjnt/client/counter/index.tsx` — a typed `useAgent()` hook bound to this route (`/counter`) and this class (`CounterAgent`). State type is inferred from the class.
3. `ayjnt build` bundles `app.tsx` with Bun (target: browser) and inlines the JS into an HTML shell.
4. The worker entry serves the HTML shell on `GET /counter/:id` when the request has `Accept: text/html`. Any other request (WebSocket upgrade, JSON fetch) goes to the agent.
5. The bundled JS runs in the browser, connects to the same URL via WebSocket (`basePath: "counter/<id>"`), and state flows.

## Run it

```sh
bun install
bun run dev
# open http://localhost:8787/counter/room-1 in two tabs
# click + in one tab — the other updates live
```

`/counter/room-1` and `/counter/room-2` are different Durable Objects with independent state. The URL path segment after `/counter/` becomes the instance name.

## The typed hook

```tsx
// agents/counter/app.tsx
import { useAgent } from "@ayjnt/counter";

const agent = useAgent();          // state typed as { count: number } | undefined
const agent = useAgent<MyState>(); // override if you want
const agent = useAgent({ name: "room-42" });  // override URL-derived instance name
```

The hook handles the URL parsing and the `basePath` / `agent` SDK fiddliness for you. Method autocomplete on the returned `agent` flows from the agent class via `InstanceType<typeof CounterAgent>["state"]`.

## Setup needed in your tsconfig

The path alias `@ayjnt/*` needs to resolve. Two options:

**Option A — extend the generated config** (one line, propagates automatically as ayjnt evolves):

```json
{
  "extends": "./.ayjnt/tsconfig.json",
  "compilerOptions": { ... }
}
```

Run `ayjnt build` at least once to create `.ayjnt/tsconfig.json`, then the extends resolves.

**Option B — inline the paths** (what this example does, so it typechecks before a first build):

```json
{
  "compilerOptions": {
    ...
    "paths": {
      "@ayjnt/env": ["./.ayjnt/env.d.ts"],
      "@ayjnt/*": ["./.ayjnt/client/*"]
    }
  }
}
```

Note the `./` prefixes — TypeScript requires relative paths when `baseUrl` is not set.

## Gotcha: HTML vs agent on the same URL

`/counter/room-1` is one URL, but the worker serves two different things from it:

| Request | Response |
|---|---|
| `GET` + `Accept: text/html`, no `Upgrade` header | HTML shell (the UI) |
| `GET` + `Upgrade: websocket` | WebSocket handshake → agent |
| `POST`, `PUT`, or any non-HTML `GET` | agent's `onRequest` |

The disambiguation is in the generated `entry.ts`. You don't have to think about it unless you curl the URL: `curl http://localhost:8787/counter/room-1` returns JSON (the agent response), while a browser navigation returns HTML.

If you want JSON explicitly from a tool, pass the `Accept` header: `curl -H "Accept: application/json" ...` or just use any non-HTML Accept.

## Gotcha: initial state is undefined on first render

`agent.state` is `undefined` until the first `CF_AGENT_STATE` message arrives over WebSocket. The optional chaining in the example (`agent.state?.count ?? 0`) handles this. If you're rendering something more complex, guard with `if (!agent.state) return <Loading />;`.

## Gotcha: two-way state sync, not method calls

This example uses `agent.setState({...})` directly from the client. The SDK handles propagating the update to the server (which persists it to the DO) and broadcasting back to every connected client. No methods are decorated with `@callable` — we just let state be the API.

If you need method calls (for operations that shouldn't be expressible as state replacements — e.g., `placeOrder` from the `inter-agent` example), the Agents SDK has `@unstable_callable()` + `agent.call("methodName", [args])`. That's outside v0.3's scope but planned for a future version's demo.

## What `.ayjnt/` contains after build

```
.ayjnt/
  migrations.json              ← committed
  tsconfig.json                ← path aliases (regenerated each build)
  env.d.ts                     ← GeneratedEnv type
  client/counter/index.tsx     ← typed useAgent hook
  dist/
    entry.ts                   ← worker with inlined HTML
    wrangler.jsonc
```

The whole `.ayjnt/` tree is safe to wipe — it all regenerates on the next `ayjnt build`. Only `migrations.json` is committed; everything else is gitignored.

## See also

- [Main README — Co-located UI](../../README.md#co-located-ui) for the framework-level story
- [`src/codegen/README.md`](../../src/codegen/README.md) for how generation works
- [`examples/with-client`](../with-client) for the script-based client integration (no UI)
- [`examples/inter-agent`](../inter-agent) for method-call RPC between agents
