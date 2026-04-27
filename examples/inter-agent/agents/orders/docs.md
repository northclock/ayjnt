# OrdersAgent

One Durable Object instance per customer. Each `POST` performs an
inventory decrement via the typed `getAgent<InventoryAgent>` stub
and records the order locally — two writes across two DOs in a
single request.

## HTTP

| Method | Path | Body | Behaviour |
|---|---|---|---|
| `POST`   | `/orders/<customer>` | `{ "sku": string, "qty": number }` | Decrement inventory, record order. Returns 409 with `{ ok: false, error }` if the inventory call throws. |
| `DELETE` | `/orders/<customer>` | — | Wipe this customer's order list. |
| `GET`    | `/orders/<customer>` | — | Return `{ customer, orders: [...] }`. |

## Cross-agent flow

```
POST /orders/customer-1            (qty: 3)
  → OrdersAgent("customer-1").onRequest
      → getAgent<InventoryAgent>("main").decrement("widget", 3)
      → InventoryAgent("main") updates stock
      ← remaining count
  → OrdersAgent records { sku, qty, remaining }
  ← 200 { ok: true, ...order }
```

If the inventory call throws, the catch in OrdersAgent converts it
to a structured `409` so external clients don't see a plain-text
stack trace.

## State shape

```ts
type Order = { sku: string; qty: number; remaining: number };
type State = { orders: Order[] };
```
