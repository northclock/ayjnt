# ayjnt example: inter-agent

Demonstrates typed inter-agent RPC via `getAgent<T>()`. Two agents running in separate Durable Objects talk to each other inside the same worker — no network, no serialization tax beyond Workers RPC.

## Layout

```
agents/
  orders/
    agent.ts        → /orders/:customerId   (one DO per customer)
  inventory/
    agent.ts        → /inventory/:id        (one DO per warehouse — here, "main")
```

## How it works

```ts
// agents/orders/agent.ts
import { getAgent } from "ayjnt/rpc";
import type InventoryAgent from "../inventory/agent.ts";

type Env = {
  INVENTORY_AGENT: DurableObjectNamespace<InventoryAgent>;
};

// inside OrdersAgent.onRequest:
const inv = await getAgent<InventoryAgent>(this.env.INVENTORY_AGENT, "main");
const remaining = await inv.decrement(sku, qty);   // fully typed, no HTTP
```

`getAgent<T>` is a thin alias over the Agents SDK's `getAgentByName`. The generic parameter is the target agent class — `inv` gets method-level autocomplete and return-type inference. If you rename `decrement` in `InventoryAgent`, both the call site and the method definition break at compile time.

## Run it

```sh
bun install
bun run dev                                    # terminal 1
HOST=http://localhost:8787 bun run client      # terminal 2
```

Expected flow (after the initial `DELETE` reset the client sends, which keeps the demo reproducible — see [Gotcha: DO state persists across runs](#gotcha-do-state-persists-across-runs)):

```
0) reset state (inventory + customer orders) for a fresh run
{ status: 200, body: { ok: true, instance: 'main', stock: { widget: 10, gadget: 5 } } }
{ status: 200, body: { ok: true, customer: 'customer-1', orders: [] } }
...

1) place order: customer-1 buys 3 widgets
{ status: 200, body: { ok: true, customer: 'customer-1', sku: 'widget', qty: 3, remaining: 7 } }

2) place order: customer-2 buys 4 widgets
{ status: 200, body: { ok: true, customer: 'customer-2', sku: 'widget', qty: 4, remaining: 3 } }

3) inventory state (main): widget should be 3, gadget 5
{ status: 200, body: { instance: 'main', stock: { widget: 3, gadget: 5 } } }

4) customer-1's orders
{ status: 200, body: { customer: 'customer-1', orders: [ { sku: 'widget', qty: 3, remaining: 7 } ] } }

5) oversell check: widget stock is 3, try to buy 99 → 409
{ status: 409, body: { ok: false, customer: 'customer-3', sku: 'widget', qty: 99, error: 'insufficient stock for widget: have 3, need 99' } }
```

`customer-1` and `customer-2` are **separate Durable Objects** — each has its own isolated state. But both share `/inventory/main`, so order 2's `remaining` sees the decrement from order 1. The coordination across three DOs happens via `getAgent` RPC; there is no shared memory and no external database.

## Gotcha: DO state persists across runs

Durable Object storage survives worker restarts. That's the correct production behavior — your `ChatAgent` doesn't forget its history every time you redeploy — but it means re-running a demo script produces different results each time unless you reset.

This example's client script starts with a `DELETE` against each DO it touches, which the agents handle by resetting their state. In a real app you'd never expose a "wipe everything" endpoint; for reproducible demos it's fine.

If you run `bun run client` once and see the numbers you expect, then run it again without the reset and see different numbers — that's DO persistence working as advertised, not a bug.

To wipe state entirely (nukes the `.wrangler/` local storage):

```sh
rm -rf .wrangler && bun run dev   # fresh start
```

## Gotcha: errors across the RPC boundary

Exceptions thrown in the callee surface as exceptions at the call site. `InventoryAgent.decrement` throws `insufficient stock for widget: have 3, need 99`; the `await inv.decrement(...)` in `OrdersAgent` receives that error unchanged. If you don't catch it, the agent's `onRequest` propagates the throw, the worker returns a 500 with a plain-text stack trace, and any client trying to `res.json()` on the response fails with a parse error.

The fix is what production code should do anyway — wrap the call site and translate the error into a structured response:

```ts
try {
  const remaining = await inv.decrement(sku, qty);
  // ... happy path
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json(
    { ok: false, error: message },
    { status: 409 },  // Conflict — inventory-level business rule violated
  );
}
```

Now external clients always get JSON, the status code communicates intent, and the `Override onError(error)` warning from the Agent base class stops firing.

## Gotcha: every callee is an async trip, even in the same worker

Durable Object RPC is an async boundary. Calling `inv.decrement(sku, qty)` is not a local function call — it reaches the target DO, which may be on a different machine. `await` is required. The overhead is much lower than HTTP (no URL parsing, no body serialization beyond the RPC envelope) but it isn't free.

Corollaries:

- Don't call `getAgent` + method in a tight loop. Batch where you can, or keep local state.
- RPC args must be [Cloudflare-structured-cloneable](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/) — plain data only. No functions, no `Date` passed raw (serialize it).

## Gotcha: instance sharding is your responsibility

We hardcoded `"main"` for the inventory instance. In a production app with real stock, you'd shard by sku or warehouse:

```ts
const inv = await getAgent<InventoryAgent>(this.env.INVENTORY_AGENT, sku);
```

Now each sku has its own DO — reads and writes for different skus scale independently and never contend for the same DO's storage. The tradeoff is inventory-wide operations (like "total stock across all skus") now require fan-out.

This is a general DO design thing, not an ayjnt thing, but it's the first decision you hit when you try to use inter-agent RPC for anything real.

## Gotcha: the Env type on the caller must declare the binding

`OrdersAgent` declares:

```ts
type Env = {
  INVENTORY_AGENT: DurableObjectNamespace<InventoryAgent>;
};
```

The binding name is `INVENTORY_AGENT` because ayjnt derives it from the class name (`InventoryAgent` → `INVENTORY_AGENT`). You have to type it yourself — the framework generates the wrangler config and the worker entry, but it doesn't (yet) generate a typed `Env` for every agent. That lands in v0.3 along with co-located `app.tsx`.

Until then, declare the bindings you use explicitly. TS will catch typos since the generic parameter must extend `Agent`.

## See also

- [Main README — Inter-agent RPC](../../README.md#inter-agent-rpc) for the framework-wide story
- [`src/runtime/rpc.ts`](../../src/runtime/rpc.ts) for the one-line implementation
- [`examples/middleware`](../middleware) for the other v0.2 feature
