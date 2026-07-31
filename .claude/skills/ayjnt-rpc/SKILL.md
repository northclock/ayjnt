---
name: ayjnt-rpc
description: Call agent methods — from another agent (typed DO RPC via `getAgent<T>`) or from a browser UI / catalog consumers (Cloudflare's `@callable()` decorator + `agent.stub.method()`). Use when the user says "call <agentB> from <agentA>", "inter-agent RPC", "call from the UI", "call from the browser", "agent.stub.method", "agent.call", "@callable decorator", or "advertise this method in the catalog". The framework treats the `@callable()` decorator as the single source of truth for both browser-callability and catalog inclusion. A legacy `/** @callable */` JSDoc tag exists as a fallback for the rare catalog-only case.
---

# Three patterns, two markers

The word "callable" shows up in three different contexts. They map
cleanly to a small set of markers:

| Pattern | Caller | Mechanism | Marker on the method |
|---|---|---|---|
| **`getAgent<T>`** | Another agent (worker-side) | Native Cloudflare DO RPC | None — TypeScript `public` is enough |
| **`@callable()` decorator** | Browser UI (`agent.stub.method()`) AND `/__ayjnt/catalog` | WebSocket RPC + build-time catalog | `@callable({ description })` from `"agents"` |
| **`/** @callable */` JSDoc** (legacy) | `/__ayjnt/catalog` only — NOT the browser | Build-time catalog only | `/** @callable */` JSDoc tag |

The decorator is the **one marker** users should reach for: it makes a
method browser-callable AND lists it in the catalog with the same
`description` the SDK's `getCallableMethods()` returns. The JSDoc tag
is a fallback for the rare "advertised in the catalog but not exposed
over WebSocket" case (e.g., agent-to-agent RPC methods you want
discoverable).

See [`examples/orchestration`](../../../examples/orchestration)
for a worked inter-agent RPC example.

## Pattern 1 — agent-to-agent: `getAgent<T>`

When one agent in the worker needs to call another. Native DO RPC,
no decorator needed — TypeScript's `public` is enough.

### Callee (no decorator required)

```ts
// agents/inventory/agent.ts
import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { stock: Record<string, number> };

export default class InventoryAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { stock: { widget: 10 } };

  // Plain public method — callable by other agents via getAgent<T>.
  async decrement(sku: string, qty: number): Promise<number> {
    const current = this.state.stock[sku] ?? 0;
    if (current < qty) throw new Error(`insufficient stock for ${sku}`);
    const remaining = current - qty;
    this.setState({ stock: { ...this.state.stock, [sku]: remaining } });
    return remaining;
  }
}
```

### Caller

```ts
// agents/orders/agent.ts
import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type InventoryAgent from "../inventory/agent.ts";
import type { GeneratedEnv } from "@ayjnt/env";

export default class OrdersAgent extends Agent<GeneratedEnv> {
  override async onRequest(request: Request): Promise<Response> {
    const { sku, qty } = (await request.json()) as { sku: string; qty: number };
    try {
      const inv = await getAgent<InventoryAgent>(
        this.env.INVENTORY_AGENT,   // generated DO binding
        "main",                     // instance name
      );
      const remaining = await inv.decrement(sku, qty);   // typed!
      return Response.json({ ok: true, remaining });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: message }, { status: 409 });
    }
  }
}
```

### Invariants

- Pass the DO namespace from `env`, not raw `env.X.idFromName(...)`.
  `getAgent` wraps `idFromName → get → setName` so the target DO learns
  its own `name` (required for `CF_AGENT_IDENTITY` messages).
- Generic parameter is the agent class — `type` import so the worker
  doesn't bundle the implementation.
- Awaiting every call. Each one is a DO round-trip, possibly on
  another machine.
- Args must be structured-cloneable. No functions; serialise `Date`,
  `Map`, `Set` yourself.

## Pattern 2 — browser-to-agent: Cloudflare's `@callable()`

When the React UI in `app.tsx` needs to invoke an agent method.
This is **the right pattern** for any UI interaction that isn't a
pure state replacement.

### Agent — decorate methods to expose

```ts
// agents/notes/agent.ts
import { Agent, callable } from "agents";        // ← decorator from "agents"
import type { GeneratedEnv } from "@ayjnt/env";

type Note = { id: string; text: string };
type State = { notes: Note[] };

export default class NotesAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { notes: [] };

  @callable({ description: "Add a new note." })
  async addNote(text: string): Promise<Note> {
    const note = { id: crypto.randomUUID(), text };
    this.setState({ notes: [...this.state.notes, note] });
    return note;
  }

  @callable()
  async deleteNote(id: string): Promise<boolean> {
    const before = this.state.notes.length;
    this.setState({ notes: this.state.notes.filter((n) => n.id !== id) });
    return this.state.notes.length < before;
  }
}
```

### UI — call via `agent.stub.method()`

```tsx
// agents/notes/app.tsx
import { useAgent } from "@ayjnt/notes";        // ← generated, type-bound

export default function NotesApp() {
  const agent = useAgent();                      // no generic needed
  const submit = async () => {
    const note = await agent.stub.addNote("hello");   // typed end-to-end
    console.log("created:", note.id, note.text);
  };
  // ...
}
```

The generated `useAgent()` hook is pre-bound to the agent class, so
`agent.stub.<method>` autocompletes with every `@callable()`
decorator. `agent.call("<method>", [args])` is the untyped fallback.

### When to reach for `@callable()` instead of `setState()`

Use it for behaviour that can't be expressed as a pure state
replacement:

- **Server-generated values.** "Create with a fresh UUID" — only the
  server can produce the id.
- **Conditional logic.** "Delete if exists", "decrement only if
  positive", "verify a secret before applying".
- **Derived values.** "How many items match this filter?" — count
  on the server, return the number.
- **Anything that should fail at the boundary.** Throw from the
  callable; the Promise rejects on the client.

`setState({...})` is still right when the change *is* the new state.

### Invariants

- **Decorator imported from `"agents"`**, not `"ayjnt/rpc"`. The
  decorator name is `callable` (also exported as deprecated
  `unstable_callable`). Use `callable`.
- **Method must be public.** Decorated methods are exposed over
  WebSocket — they're public by definition.
- **Args and return values must be JSON-serialisable.** Same
  constraint as DO RPC: plain data only.
- **Throwing propagates to the client.** The browser-side Promise
  rejects with the error message.
- **Bun handles the decorator transpilation natively** — no Vite
  plugin or tsconfig flag needed. Modern TS5 decorators.

### Streaming responses

For long-running calls, decorate with `streaming: true` and receive
a `StreamingResponse`:

```ts
@callable({ streaming: true })
async generate(stream: StreamingResponse, prompt: string) {
  for await (const chunk of this.llm.stream(prompt)) {
    stream.send(chunk);
  }
  stream.end();
}
```

## Pattern 3 — discovery: `/__ayjnt/catalog`

Catalog inclusion is **driven by the `@callable()` decorator from
Pattern 2** — the same marker. ayjnt's build-time scanner sees the
decorator on the method and lists it in the catalog automatically:

```sh
curl http://localhost:8787/__ayjnt/catalog \
  | jq '.agents[] | select(.routePath == "/notes") | .callables'
```

```json
[
  {
    "name": "addNote",
    "params": "text: string",
    "returnType": "Promise<Note>",
    "description": "Add a new note to the list."
  },
  …
]
```

Description precedence:

1. `@callable({ description: "…" })` — the decorator option (wins).
2. First prose line of the JSDoc above the method (fallback when the
   decorator has no `description`).
3. `null`.

So this pattern is enough:

```ts
/** Decrement stock for a SKU. Throws on insufficient stock. */
@callable()
async decrement(sku: string, qty: number): Promise<number> { /* … */ }
```

The JSDoc above provides editor hover + the catalog fallback
description. The decorator does the runtime + catalog work. No
`@callable` JSDoc tag needed.

Catalog filtering still goes through each agent's middleware chain —
admin agents stay hidden from anonymous callers.

### Legacy JSDoc tag (catalog-only fallback)

For the rare case where you want catalog visibility *without*
browser exposure — typically a method other agents call via
`getAgent<T>` that you still want advertised — use the legacy JSDoc
tag instead of the decorator:

```ts
/**
 * Re-seed the notes from a snapshot. Agent-to-agent RPC only —
 * listed in the catalog but not browser-callable.
 * @callable
 */
async reseed(snapshot: Note[]): Promise<void> { /* … */ }
```

The JSDoc-tag path has no runtime effect; it's pure metadata for the
catalog. Most code shouldn't need it — if a method is part of your
public surface, decorate it.

### Tag/decorator constraints

Both markers are parsed source-level (regex), so:

- Parameter list must fit on **one line**.
- Return type annotation must not contain a top-level `{`
  (object literal return types aren't supported).
- Decorator detection doesn't follow import aliases. Write
  `@callable(...)` literally (not `@cb(...)` after renaming the
  import). Same limitation as `extends McpAgent`.
- `@callable({ validate: (x) => x })` — decorator args with nested
  parens confuse the non-greedy capture. Stick to simple object
  literals in the decorator args, or use the JSDoc-tag fallback.

## Combining them

The matrix collapses to three rows under the unified design:

| `@callable()` decorator | `/** @callable */` JSDoc | Browser-callable? | In catalog? | Use for |
|---|---|---|---|---|
| ✗ | ✗ | ✗ | ✗ | Internal helpers. Other agents can still call via `getAgent<T>` — visibility is just TypeScript's `public`. |
| ✓ | ✗ | ✓ | ✓ | **Default.** Public RPC surface for both browsers and catalog consumers. |
| ✗ | ✓ | ✗ | ✓ | Catalog-only: advertised but not exposed over WebSocket. Useful for agent-to-agent RPC methods you want discoverable. |

(The decorator-plus-JSDoc-tag combination still works but is
redundant — the decorator alone covers both audiences. If the user
has both, treat the JSDoc tag as a no-op cleanup target.)

`getAgent<T>` always works against any public method regardless of
decoration — DO RPC doesn't go through the WebSocket or catalog
layers.

## Common pitfalls

- **Error JSON-stringifies to `"[object Object]"`.** Pull `.message`
  when translating to an HTTP response:

  ```ts
  catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 409 });
  }
  ```

- **DO state survives worker restarts.** Re-running a demo accumulates
  state. `rm -rf .wrangler` in dev to reset.

- **Decorator transpilation.** Modern TS5 decorators work natively
  in Bun (server) and Bun.build (client). No `experimentalDecorators`
  flag needed. If you see "decorators are not valid here", your
  bundler is doing pre-TS5 decorator transformation — fix the target
  or update the tooling.

- **`agent.stub` is untyped → `UntypedAgentStub`.** Means the typed
  `useAgent()` overload didn't bind — usually a generated-hook
  mismatch. Re-run `bun run build`; the generated hook in
  `.ayjnt/client/<route>/index.tsx` should call
  `useAgentUpstream<Instance, AgentState>(...)`.

- **Renaming a `@callable` method.** Breaks every browser call
  site at compile time when types are properly threaded. Renames in
  the agent class propagate to `agent.stub.<new-name>` after the
  next build.

## Catalog visibility

After tagging methods with `/** @callable */`, run `bun run build` and:

```sh
curl http://localhost:8787/__ayjnt/catalog \
  | jq '.agents[] | { route: .routePath, callables: .callables[].name }'
```

…lists every accessible agent and its callable methods.

## Reference

- [`examples/orchestration`](../../../examples/orchestration) — typed
  `getAgent<T>` calls across lead, researcher, and reviewer agents.
- [Cloudflare's @callable docs](https://developers.cloudflare.com/agents/api-reference/callable-methods/).
