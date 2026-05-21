import { Agent, callable } from "agents";
import { withWorkflow } from "ayjnt/workflow";
import type { GeneratedEnv } from "@ayjnt/env";
import type OrdersProcessing from "./workflow.ts";

type OrderRequest = { sku: string; qty: number; customerId: string };
type Order = {
  id: string;
  sku: string;
  qty: number;
  status: "queued" | "processing" | "complete" | "failed";
  workflowId?: string;
};
type State = {
  orders: Order[];
};

/**
 * OrdersAgent — hands long-running order-processing work off to a
 * paired Workflow.
 *
 * The pattern: POST a new order, this agent inserts it as "queued",
 * triggers the workflow via `this.workflow(...)`, and stashes the
 * workflow's instance id. The workflow can RPC back into this agent
 * (via the `agent` property on `AgentWorkflow`) to update the order
 * status as steps complete.
 *
 * `withWorkflow<typeof OrdersProcessing>(Agent)` adds a typed
 * `this.workflow(params)` method whose `params` shape is inferred from
 * `OrdersProcessing`'s `Params` generic. The framework injects the
 * workflow binding name onto this class's prototype at codegen time
 * based on the co-located `workflow.ts` next door — so there's no
 * magic binding string in user code. To trigger a workflow that
 * ISN'T co-located, use the SDK's `this.runWorkflow("BINDING", params)`
 * directly.
 *
 * Why workflows: durable execution. The workflow's `step.do(...)`
 * blocks survive worker restarts, retries with backoff, and resume
 * from the last successful step on failure. Without workflows you'd
 * be re-running the whole chain on every transient error.
 */
export default class OrdersAgent
  extends withWorkflow<typeof OrdersProcessing>()(Agent)<GeneratedEnv, State>
{
  override initialState: State = { orders: [] };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ orders: this.state.orders });
    }

    const req = (await request.json()) as OrderRequest;
    const { orderId, workflowId } = await this.placeOrder(req);
    return Response.json({ orderId, workflowId });
  }

  /**
   * Place a new order and kick off its workflow.
   *
   * Browser-callable via `agent.call("placeOrder", [{...}])` from the
   * co-located UI (see app.tsx). Listed in the agent catalog with the
   * description below.
   */
  @callable({
    description: "Place a new order and start the processing workflow.",
  })
  async placeOrder(
    req: OrderRequest,
  ): Promise<{ orderId: string; workflowId: string }> {
    const orderId = crypto.randomUUID();

    // Insert the order at "queued" so the UI shows it immediately.
    this.setState({
      orders: [
        ...this.state.orders,
        { id: orderId, sku: req.sku, qty: req.qty, status: "queued" },
      ],
    });

    // Trigger the workflow. The framework added the
    // `ORDERS_PROCESSING` binding to wrangler.jsonc the moment we
    // dropped `workflow.ts` next to this file. `this.workflow(...)` is
    // the `withWorkflow` mixin's typed shortcut — params are checked
    // against `OrdersProcessing`'s `Params` generic.
    const workflowId = await this.workflow({
      orderId,
      sku: req.sku,
      qty: req.qty,
      customerId: req.customerId,
    });

    this.setState({
      orders: this.state.orders.map((o) =>
        o.id === orderId ? { ...o, workflowId } : o,
      ),
    });

    return { orderId, workflowId };
  }

  /**
   * Called by the workflow at each milestone via `this.agent.markStatus(...)`.
   * Updates the order's status in DO state, which broadcasts to any
   * connected client.
   */
  async markStatus(orderId: string, status: Order["status"]): Promise<void> {
    this.setState({
      orders: this.state.orders.map((o) =>
        o.id === orderId ? { ...o, status } : o,
      ),
    });
  }
}
