import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type InventoryAgent from "../inventory/agent.ts";

type Env = {
  INVENTORY_AGENT: DurableObjectNamespace<InventoryAgent>;
};

type Order = { sku: string; qty: number; remaining: number };
type State = { orders: Order[] };

/**
 * OrdersAgent is instanced per customer (so /orders/customer-1 is one DO,
 * /orders/customer-2 is another). On each POST it calls InventoryAgent to
 * decrement stock, then records the order locally. The two agents run in
 * separate Durable Objects inside the same worker.
 */
export default class OrdersAgent extends Agent<Env, State> {
  override initialState: State = { orders: [] };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      this.setState({ orders: [] });
      return Response.json({ ok: true, customer: this.name, orders: [] });
    }

    if (request.method === "POST") {
      const { sku, qty } = (await request.json()) as {
        sku: string;
        qty: number;
      };

      // Single inventory DO ("main") for the demo; a real app could shard
      // by sku or warehouse id. The generic on getAgent gives us full
      // method autocomplete on `inv` — try renaming `decrement` and watch
      // both sides break at compile time.
      const inv = await getAgent<InventoryAgent>(
        this.env.INVENTORY_AGENT,
        "main",
      );

      // Errors thrown by the callee propagate across the RPC boundary.
      // Catch them here and translate into a structured HTTP response so
      // external clients get predictable JSON back instead of a 500 plain
      // text stack trace.
      try {
        const remaining = await inv.decrement(sku, qty);
        this.setState({
          orders: [...this.state.orders, { sku, qty, remaining }],
        });
        return Response.json({
          ok: true,
          customer: this.name,
          sku,
          qty,
          remaining,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json(
          { ok: false, customer: this.name, sku, qty, error: message },
          { status: 409 },
        );
      }
    }

    return Response.json({ customer: this.name, ...this.state });
  }
}
