---
name: ayjnt-workflows
description: Pair an agent with a durable Cloudflare Workflow. Use when the user asks to "add a workflow", "run a long-running job", "extend AgentWorkflow", "make order processing durable", "retry with backoff", or "survive worker restarts". Creates `agents/<route>/workflow.ts` next to `agent.ts`; the framework wires the workflow binding, the typed RPC stub, and the GeneratedEnv field. Uses the `withWorkflow<typeof MyWorkflow>()(Agent)` mixin so the agent gets a typed `this.workflow(params)` shortcut with no magic binding strings. NO migrations — workflows are ephemeral execution containers; state lives in the paired Agent's DO.
---

# Pair an agent with a workflow

`workflow.ts` next to `agent.ts` is the entire convention. The
default-exported class extends `AgentWorkflow` (typed RPC back to the
agent) or `WorkflowEntrypoint` (fire-and-forget). The framework
discovers it at scan time and emits the binding.

## File shape

```ts
// agents/<route>/workflow.ts
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent } from "agents/workflows";
import type { WorkflowStep } from "cloudflare:workers";
import type MyAgent from "./agent.ts";

type Params = { /* user-defined params */ };

export default class MyWorkflow extends AgentWorkflow<MyAgent, Params> {
  async run(
    event: Readonly<AgentWorkflowEvent<Params>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const params = event.payload;

    await step.do("step-one", async () => {
      // durable work
      await this.agent.markStatus(params.id, "running");
    });

    const result = await step.do("step-two", async () => {
      // each step.do persists its return value
      return { something: "useful" };
    });

    await step.sleep("wait-a-bit", "5 seconds");

    return result;
  }
}
```

### Rules

- **Default-export the class.** ayjnt scans `agents/**/workflow.ts`
  files and reads the default export.
- **`extends AgentWorkflow`** for typed RPC back to the agent.
  **`extends WorkflowEntrypoint`** when the workflow doesn't talk to
  an agent. ayjnt detects either.
- **Generic params**: `AgentWorkflow<AgentType, Params>` — first arg
  is the paired Agent class (gives you `this.agent` with typed RPC);
  second is the workflow's payload type.
- **No aliased imports** for the base class. The detection is
  source-level regex on `extends AgentWorkflow` / `extends WorkflowEntrypoint`.

## Triggering from the agent

Use the `withWorkflow` mixin so you don't have to type the binding
name. The framework knows the pairing from the file layout and
injects the binding onto the agent's prototype at build time:

```ts
// agents/<route>/agent.ts
import { Agent } from "agents";
import { withWorkflow } from "ayjnt/workflow";
import type { GeneratedEnv } from "@ayjnt/env";
import type MyWorkflow from "./workflow.ts";

export default class MyAgent
  extends withWorkflow<typeof MyWorkflow>()(Agent)<GeneratedEnv, State>
{
  override async onRequest(req: Request): Promise<Response> {
    const params = await req.json();

    // No magic binding string — params type-checked against
    // MyWorkflow's Params generic. IntelliSense knows the shape.
    const workflowId = await this.workflow(params);

    return Response.json({ workflowId });
  }

  // The workflow calls this back via this.agent.markStatus(...)
  async markStatus(id: string, status: string): Promise<void> {
    this.setState({ /* … */ });
  }
}
```

### Why curried

`withWorkflow<W>()(Base)` curries: the outer call binds the
workflow type, the inner takes the base class. TypeScript can't
partially infer one generic from a type arg and another from a
value arg in a single call, so currying is the cleanest way to
keep the syntax ergonomic while preserving Agent's `<Env, State>`
parameterization downstream.

### For non-co-located workflows

If a workflow lives outside the agent's folder (e.g. a fire-and-forget
batch under a separate `workflows/` tree), don't use the mixin. Call
the SDK's `runWorkflow` directly with the binding name:

```ts
const workflowId = await this.runWorkflow("CLEANUP_JOB", params);
```

`this.runWorkflow(binding, params)` is provided by the SDK's `Agent`
base class. The binding is type-checked against bindings ayjnt
generated.

## Name derivation

Class name drives everything:

- `OrdersProcessing` → binding `ORDERS_PROCESSING`
- `OrdersProcessing` → workflow name `orders-processing` (kebab)
- `OrdersProcessing` → `class_name: "OrdersProcessing"`

Bindings must be unique across agents and workflows; the scanner
errors at build time if two classes would collide.

## What gets generated

```jsonc
// .ayjnt/dist/wrangler.jsonc
"workflows": [
  {
    "name": "orders-processing",
    "binding": "ORDERS_PROCESSING",
    "class_name": "OrdersProcessing"
  }
]
```

```ts
// .ayjnt/env.d.ts
export type GeneratedEnv = {
  ORDERS_AGENT: DurableObjectNamespace<OrdersAgent>;
  ORDERS_PROCESSING: Workflow;  // ← workflow binding, typed
};
```

```ts
// .ayjnt/dist/entry.ts
import OrdersProcessing from "../../agents/orders/workflow.ts";
export { OrdersProcessing };  // Cloudflare runtime registers the class
```

## Workflows ≠ Durable Objects

- **No entries in `migrations[]`.** Workflows are ephemeral execution
  containers. The framework will refuse to add a workflow class to
  the SQLite migrations.
- **State lives in the paired Agent's DO.** Workflows don't have
  `this.state`. If you need state, RPC back into the agent and have it
  call `setState`.

## step.do contract

Each `step.do("name", fn)` block is:

- Idempotent across retries — if `fn` throws, the framework retries
  with exponential backoff. If the worker restarts, execution resumes
  from the last successful step using the persisted return value.
- Keyed by name. **Renaming a step in a deployed workflow makes the
  runtime think it's a new step** and re-execute it. Treat step
  names like database column names — stable across deploys.

`step.sleep("name", duration)` also survives restarts.

## Pair with a UI

The agent ⇄ workflow loop is naturally visible — each step.do
flips the order's status, which broadcasts over WebSocket. Drop an
`app.tsx` next to the agent and use the generated `useAgent` hook:

```tsx
// agents/<route>/app.tsx
import { useAgent } from "@ayjnt/orders";

export default function OrdersUI() {
  const agent = useAgent();
  const orders = (agent.state as { orders?: Order[] })?.orders ?? [];
  // call agent.call("placeOrder", [{ sku, qty, customerId }]) on submit
  // render orders with their live status
}
```

Make the agent's trigger method `@callable({ description: "..." })`
so the UI can drive it via `agent.call(method, args)` without going
through `fetch`.

## Looking up a running workflow

```ts
// Inside the agent
const instance = await this.env.MY_WORKFLOW.get(workflowId);
const status = await instance.status();
// → { status: "running" | "complete" | "errored" | ..., output?: ... }
```

## When NOT to use a workflow

- The task is a single fetch + return → just do it in the agent.
- The task is a stateless background side-effect → use{" "}
  `this.ctx.waitUntil(fetch(...))`.
- The task needs millisecond-precision orchestration → workflows have
  per-step overhead; use the agent's scheduler instead.

Reach for workflows when you want **durable, multi-step, retry-aware**
execution.

## Reference

- [`examples/workflow`](../../../examples/workflow) — durable content
  preparation followed by a human approval gate.
- [Cloudflare's Workflow + Agents docs](https://developers.cloudflare.com/agents/api-reference/run-workflows/).
