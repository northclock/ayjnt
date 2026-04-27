# InventoryAgent

Owns the stock counters. One Durable Object instance per warehouse —
the demo uses a single `"main"` instance, but you could shard by SKU
or region.

## Callable methods

- `decrement(sku, qty)` — atomic decrement. Throws `insufficient stock for <sku>: have X, need Y` if the caller asks for more than what's available. Returns the remaining count.
- `reset()` — wipes back to seed values (`widget: 10, gadget: 5`). Demo-only.

Use them via the typed RPC stub:

```ts
import { getAgent } from "ayjnt/rpc";
import type InventoryAgent from "../inventory/agent.ts";

const inv = await getAgent<InventoryAgent>(env.INVENTORY_AGENT, "main");
const remaining = await inv.decrement("widget", 3);   // typed return
```

## HTTP

| Method | Path | Behaviour |
|---|---|---|
| `GET`    | `/inventory/<instance>` | Read the current stock map. |
| `DELETE` | `/inventory/<instance>` | Reset to seed values. |

## State shape

```ts
type State = { stock: Record<string, number> };
```
