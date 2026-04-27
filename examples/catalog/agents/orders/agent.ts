import { Agent } from "agents";

type Env = Record<string, never>;
type Order = { id: string; sku: string; qty: number };
type State = { orders: Order[] };

/**
 * OrdersAgent — orders for the current instance (one DO per customer).
 * Has no docs.md to demonstrate that `hasDocs` is independent per agent.
 */
export default class OrdersAgent extends Agent<Env, State> {
  override initialState: State = { orders: [] };

  /**
   * Append a new order to this customer's history.
   * @callable
   */
  async createOrder(sku: string, qty: number): Promise<Order> {
    const order: Order = { id: `o_${this.state.orders.length + 1}`, sku, qty };
    this.setState({ orders: [...this.state.orders, order] });
    return order;
  }

  /**
   * Return every order for this customer.
   * @callable
   */
  async listOrders(): Promise<Order[]> {
    return this.state.orders;
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ customer: this.name, ...this.state });
  }
}
