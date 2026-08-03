---
name: ayjnt-add-ui
description: Add a co-located React UI to an existing Ayjnt agent. Use when the user asks to add app.tsx, co-locate a React component, render an agent page, or add a browser interface. Creates the route's app.tsx, uses the generated typed useAgent hook, verifies React dependencies, and confirms TypeScript includes the generated path aliases.
---

# Add a co-located UI

`app.tsx` next to `agent.ts` means the same URL serves both the agent
data (JSON / WebSocket) and the React UI (when the browser sends
`Accept: text/html`). State syncs from server → UI automatically via
the SDK's WebSocket protocol.

> **Home page?** A `app.tsx` at the `agents/` *root* (not inside an agent
> folder) is the home UI, served at `/`. Same `export default` shape and
> hook usage as below — it just composes agents through their generated
> `@ayjnt/<route>` hooks rather than being bound to one. It's gated by the
> root `agents/middleware.ts`. The default `ayjnt new` scaffold ships one.

## What the user needs in place

Before writing the UI:

1. **An existing agent** at `agents/<route>/agent.ts`. If the user
   wants both at once, scaffold the agent first using
   [`ayjnt-new-agent`](../ayjnt-new-agent/SKILL.md).
2. **React + types in `package.json`** — if missing, add:
   - `dependencies`: `react: "^19"`, `react-dom: "^19"`.
   - `devDependencies`: `@types/react: "^19"`, `@types/react-dom: "^19"`.
   - Then `bun install`.
3. **`tsconfig.json` with DOM lib + JSX**. Most ayjnt projects already
   have:
   ```json
   "lib": ["ESNext", "DOM", "DOM.Iterable"],
   "jsx": "react-jsx",
   "jsxImportSource": "react"
   ```
   Add them if absent.

## The `app.tsx` shape

```tsx
// agents/<route>/app.tsx
import { useAgent } from "@ayjnt/<route>";

export default function App() {
  const agent = useAgent();
  const value = agent.state?.foo ?? <fallback>;

  return (
    <main>
      <h1>{agent.name}</h1>
      <p>{JSON.stringify(value)}</p>
      <button onClick={() => agent.setState({ foo: "new" })}>update</button>
    </main>
  );
}
```

### Rules

- **`export default`** the root component. The framework wraps it in
  `<StrictMode>` + an error boundary + (for MCP apps) the postMessage
  bridge, then mounts to `#root`. Do not write `createRoot` yourself —
  it's owned by the generated mount wrapper. The legacy manual-mount
  pattern still works but emits a deprecation warning.
- **`useAgent()` takes no args** when the URL gives you the instance.
  Pass `{ name: "fixed-id" }` to override.
- **`agent.state` is `undefined` until the first state message arrives**
  over WebSocket. Optional-chain with `??` fallbacks.
- **`agent.setState({...})` round-trips through the DO** and broadcasts
  to every connected client. It's not a local set — open two tabs to
  verify sync.

### Import path

`@ayjnt/<route>` resolves to `.ayjnt/client/<route>/index.tsx`, which
ayjnt regenerates on every build. The hook is typed against the agent
class — `agent.state` autocompletes with the agent's `State` type and
`agent.setState({…})` is type-checked.

If TypeScript can't resolve `@ayjnt/<route>`:
- Run `bun run build` at least once so the file exists.
- Check `tsconfig.json` extends `./.ayjnt/tsconfig.json` OR inlines:
  ```json
  "paths": {
    "@ayjnt/env": ["./.ayjnt/env.d.ts"],
    "@ayjnt/*": ["./.ayjnt/client/*"]
  }
  ```

## Same URL, two responses

`GET /<route>/<instance>` returns:

| Request | Response |
|---|---|
| `Accept: text/html` (browser navigation) | Bundled HTML shell — the React UI. |
| `Upgrade: websocket` | WebSocket handshake — state sync. |
| Anything else (curl, POST) | `agent.onRequest()` output. |

So `curl /<route>/foo` returns the agent's JSON; opening the same
URL in a browser returns the UI. One URL, no extra config.

## Multi-tab sync demo

Once the UI runs, open the same URL in two tabs. State changes via
`agent.setState` in one tab show up live in the other — the SDK
broadcasts every state update to all connected clients on that
instance. Different instances (`/chat/room-1` vs `/chat/room-2`)
have independent state.

## Don't add to an MCP agent (in this framework version)

If the agent extends `McpAgent` (from `agents/mcp`), it's an MCP
server: tools/prompts/resources, no co-located UI. The framework
doesn't currently bundle a UI for MCP agents — `app.tsx` next to an
`McpAgent` subclass is unsupported. Build the MCP server with the
[`ayjnt-mcp`](../ayjnt-mcp/SKILL.md) pattern instead, and consume the
results in your client (Claude Desktop, Codex, etc.).

## Reference

[`examples/code`](../../../examples/code) — a root session dashboard and a
per-agent conversation UI sharing durable state.
