import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent } from "agents/workflows";
import type { WorkflowStep } from "cloudflare:workers";
import type OrdersAgent from "./agent.ts";

type Params = {
  orderId: string;
  sku: string;
  qty: number;
  customerId: string;
};

/**
 * OrdersProcessing — durable order-processing workflow paired with
 * OrdersAgent.
 *
 * Because this file is named `workflow.ts` and the class extends
 * `AgentWorkflow`, ayjnt's scan picks it up automatically. The codegen:
 *
 *   1. Adds the workflow binding to `wrangler.jsonc`:
 *      ```
 *      workflows: [{
 *        name: "orders-processing",
 *        binding: "ORDERS_PROCESSING",
 *        class_name: "OrdersProcessing",
 *      }]
 *      ```
 *   2. Re-exports `OrdersProcessing` from the generated entry.ts so the
 *      runtime can register the class.
 *   3. Adds `ORDERS_PROCESSING: Workflow` to `GeneratedEnv` so
 *      `this.env.ORDERS_PROCESSING` autocompletes inside agents.
 *
 * Workflows have NO Durable Object migrations — they're ephemeral
 * execution containers; state lives in the parent agent's DO.
 *
 * `step.do(...)` blocks are the unit of durability. Each step:
 *   - runs once, retries on failure with exponential backoff
 *   - persists its return value
 *   - resumes from the next un-run step on worker restart
 *
 * `this.agent` is a typed RPC stub for OrdersAgent (the generic above
 * gives us autocomplete on `agent.markStatus(...)` etc.).
 */
export default class OrdersProcessing extends AgentWorkflow<OrdersAgent, Params> {
  async run(
    event: Readonly<AgentWorkflowEvent<Params>>,
    step: WorkflowStep,
  ): Promise<{ orderId: string; charged: boolean }> {
    const { orderId, sku, qty, customerId } = event.payload;

    // Each step.do block is a durable boundary. The framework re-runs
    // failed steps with backoff and resumes from here on cold start.
    await step.do("mark-processing", async () => {
      await this.agent.markStatus(orderId, "processing");
    });

    const reserved = await step.do("reserve-inventory", async () => {
      // Stand in for an inventory call. Throwing here triggers the
      // workflow's retry policy.
      if (qty <= 0) throw new Error("qty must be positive");
      return { sku, qty, reservation: crypto.randomUUID() };
    });

    // Simulate a deliberate delay — payment processors take time.
    // `step.sleep` survives restarts; the workflow resumes after.
    await step.sleep("payment-clearance-delay", "2 seconds");

    const charged = await step.do("charge-customer", async () => {
      // Real call: env.PAYMENTS.fetch(...). Stub it.
      return { customerId, amount: qty * 9.99, txn: crypto.randomUUID() };
    });

    await step.do("mark-complete", async () => {
      await this.agent.markStatus(orderId, "complete");
    });

    return { orderId, charged: !!charged };
  }
}
