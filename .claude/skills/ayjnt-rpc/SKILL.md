---
name: ayjnt-rpc
description: Call one ayjnt agent from another with typed Durable Object RPC, and expose methods via the `@callable` JSDoc convention so they appear in `/__ayjnt/catalog`. Use when the user says "call <agentB> from <agentA>", "inter-agent RPC", "expose a method as RPC", "getAgent<T>", "@callable", or "advertise this method in the catalog". Adds the method on the callee with the `@callable` tag, sets up the caller's `getAgent<T>` site with the right types, and confirms both sides compile.
---

# Inter-agent RPC + `@callable`

Two intertwined patterns:

1. **`getAgent<T>(namespace, name)`** — typed DO stub for calling
   methods on another agent. Native Workers RPC, no HTTP, no JSON
   round-trip.
2. **`/** @callable */` JSDoc tag** — opt-in marker that surfaces the
   method in the `/__ayjnt/catalog` JSON tree so other agents (and
   external tooling) can discover the public RPC surface.

The two are independent — a method can be `@callable` without being
called via RPC, and a method can be RPC-called without being
`@callable`. Use them together when both apply.

## Callee — expose a method

```ts
// agents/inventory/agent.ts
import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { stock: Record<string, number> };

export default class InventoryAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { stock: { widget: 10 } };

  /**
   * Decrement stock for a SKU. Throws on insufficient stock.
   * @callable
   */
  async decrement(sku: string, qty: number): Promise<number> {
    const current = this.state.stock[sku] ?? 0;
    if (current < qty) throw new Error(`insufficient stock for ${sku}`);
    const remaining = current - qty;
    this.setState({ stock: { ...this.state.stock, [sku]: remaining } });
    return remaining;
  }
}
```

### `@callable` rules

- Tag is the **opt-in marker** — methods without it stay private to
  the class (still callable via DO RPC from other agents that import
  the type, but not advertised in the catalog).
- Parsed source-level. Three constraints:
  - JSDoc must **immediately precede** the method.
  - Parameter list must fit on **one line**.
  - Return type annotation must not contain a top-level `{` (object
    literal types as return annotation aren't supported).
- The first prose line of the JSDoc becomes the description in the
  catalog.

## Caller — typed stub

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
        this.env.INVENTORY_AGENT,   // generated DO binding — autocomplete works
        "main",                     // instance name
      );
      const remaining = await inv.decrement(sku, qty);   // typed!
      return Response.json({ ok: true, remaining });
    } catch (err) {
      // Exception from the callee re-throws here verbatim. Convert it
      // to a structured response so external clients don't see a
      // text/plain 500 stack.
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: message }, { status: 409 });
    }
  }
}
```

### `getAgent<T>` invariants

- Pass the **DO namespace from env**, not raw `env.INVENTORY_AGENT.idFromName(...)`.
  The helper wraps `idFromName → get → setName`, which is what
  teaches the target DO its own `name` — required for
  `CF_AGENT_IDENTITY` messages to the client.
- Generic parameter is the **agent class** — `type` import so the
  worker doesn't try to bundle the implementation. The return type
  is `DurableObjectStub<T>` with full method autocomplete.
- **`await` every call.** Each method call is an RPC round-trip to
  the target DO, possibly on another machine. Don't loop without
  batching.
- **Args must be structured-cloneable** — plain data, no functions.
  `Date`, `Map`, `Set` need explicit serialisation.

## Common pitfalls

- **`Error` is JSON-stringified to `"[object Object]"`.** When
  catching at an HTTP boundary, pull `.message`:

  ```ts
  catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 409 });
  }
  ```

- **DO state survives worker restarts.** Re-running a demo accumulates
  state. `rm -rf .wrangler` in dev to reset local DO storage.

- **`env.<BINDING>` autocomplete.** The DO binding name is derived
  from the class name (`InventoryAgent` → `INVENTORY_AGENT`). If
  autocomplete is missing, run `bun run build` once so `env.d.ts`
  regenerates.

- **Renaming a callee method without coordinating** breaks every
  caller at compile time — that's a feature. Both sides surface the
  break instantly because the types are linked through the
  `type` import.

## Catalog visibility

After tagging methods with `@callable`, run `bun run build` and:

```sh
curl http://localhost:8787/__ayjnt/catalog | jq '.agents[] | { route: .routePath, callables: .callables[].name }'
```

…lists every accessible agent and its callable methods. The catalog
is filtered by per-agent middleware — admin agents are hidden from
anonymous callers automatically. See
[`ayjnt-middleware`](../ayjnt-middleware/SKILL.md).

## Reference

- [`examples/inter-agent`](../../../examples/inter-agent) — Orders
  agent calls Inventory.decrement with oversell protection.
- [`examples/catalog`](../../../examples/catalog) — multi-agent
  showcase with a React UI that renders `/__ayjnt/catalog` live.
