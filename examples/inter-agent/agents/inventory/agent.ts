import { Agent } from "agents";

type Env = Record<string, never>;
type State = { stock: Record<string, number> };

/**
 * InventoryAgent owns the stock counters. Other agents call `decrement`
 * via getAgent<InventoryAgent>; external clients can hit /inventory/:id
 * directly to read state.
 */
export default class InventoryAgent extends Agent<Env, State> {
  override initialState: State = {
    stock: { widget: 10, gadget: 5 },
  };

  /**
   * Public method callable via DO RPC. Throws on insufficient stock so
   * the caller's transaction fails fast instead of silently going negative.
   */
  async decrement(sku: string, qty: number): Promise<number> {
    const current = this.state.stock[sku] ?? 0;
    if (current < qty) {
      throw new Error(
        `insufficient stock for ${sku}: have ${current}, need ${qty}`,
      );
    }
    const remaining = current - qty;
    this.setState({
      stock: { ...this.state.stock, [sku]: remaining },
    });
    return remaining;
  }

  /** Reset stock to the initial values. Useful for demos; you wouldn't
   *  expose this in a real inventory system. */
  async reset(): Promise<void> {
    this.setState({ stock: { widget: 10, gadget: 5 } });
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      await this.reset();
    }
    return Response.json({ instance: this.name, ...this.state });
  }
}
