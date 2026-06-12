import { describe, expect, test } from "bun:test";
import type { Agent } from "agents";
import type { AgentWorkflow } from "agents/workflows";
import { withWorkflow, type WorkflowParams } from "./workflow.ts";

type OrderParams = { orderId: string; qty: number };

// A realistic workflow subclass SHAPE (declare-only — we never run it).
// The first generic is what real user code passes: their agent class.
// (A concrete class, not `any` — `AgentWorkflow<any, …>` instantiates
// DurableObjectStub<any> and trips TS2589 under the pinned workers-types.)
declare class FakeOrdersAgent extends Agent {}
declare class OrdersProcessing extends AgentWorkflow<
  FakeOrdersAgent,
  OrderParams
> {}

// ---- type-level regression ---------------------------------------------
// WorkflowParams used `never` in the non-inferred slots, which made the
// conditional fail for EVERY real subclass and degrade Params to `unknown`
// — `this.workflow({ anything: true })` compiled. `unknown` accepts any
// assignment, so if the extraction regresses, the @ts-expect-error below
// becomes unused and `bunx tsc --noEmit` fails this file.
type Extracted = WorkflowParams<typeof OrdersProcessing>;
const exactShapeAccepted: Extracted = { orderId: "a", qty: 1 };
// @ts-expect-error — a wrong-shaped param must be rejected
const wrongShapeRejected: Extracted = { nope: true };
void exactShapeAccepted;
void wrongShapeRejected;

// ---- runtime behavior ----------------------------------------------------

class FakeAgentBase {
  calls: [string, unknown][] = [];
  runWorkflow(binding: string, params: unknown): Promise<string> {
    this.calls.push([binding, params]);
    return Promise.resolve("wf-instance-1");
  }
}

describe("withWorkflow", () => {
  test("throws a guided error when the codegen never injected a binding", async () => {
    const Mixed = withWorkflow<typeof OrdersProcessing>()(FakeAgentBase);
    const agent = new Mixed();
    expect(() =>
      (agent as InstanceType<typeof Mixed>).workflow({ orderId: "a", qty: 1 }),
    ).toThrow(/workflow\.ts sits next to agent\.ts/);
  });

  test("forwards to runWorkflow with the injected binding", async () => {
    const Mixed = withWorkflow<typeof OrdersProcessing>()(FakeAgentBase);
    Object.defineProperty(Mixed.prototype, "__ayjntWorkflowBinding", {
      value: "ORDERS_PROCESSING",
      enumerable: false,
    });
    const agent = new Mixed() as InstanceType<typeof Mixed> & FakeAgentBase;
    const id = await agent.workflow({ orderId: "a", qty: 2 });
    expect(id).toBe("wf-instance-1");
    expect(agent.calls).toEqual([
      ["ORDERS_PROCESSING", { orderId: "a", qty: 2 }],
    ]);
  });
});
