---
name: ayjnt-workflows
description: Add durable workflow execution to an Ayjnt harness. Use for co-located workflow.ts files, AgentWorkflow payloads, durable steps, retries, progress, approvals, or plain Workflows. Ayjnt infers the origin and payload from file placement, so start co-located work with `this.workflow(params)` without an agent-name generic, mixin, or binding string.
---

# Pair an agent with a workflow

`workflow.ts` next to `agent.ts` is the entire relationship. Extend
Ayjnt's `AgentWorkflow<Params>` for a workflow originating from that
agent, or `Workflow<Params>` for a plain Cloudflare Workflow. The
framework discovers, binds, exports, and types both.

## File shape

```ts
// agents/<route>/workflow.ts
import { AgentWorkflow } from "ayjnt/workflows";
import type {
  AgentWorkflowEvent,
  AgentWorkflowStep,
} from "ayjnt/workflows";

type Params = { id: string };

export default class MyWorkflow extends AgentWorkflow<Params> {
  async run(
    event: Readonly<AgentWorkflowEvent<Params>>,
    step: AgentWorkflowStep,
  ): Promise<unknown> {
    const params = event.payload;

    await step.do("step-one", async () => {
      // durable work
      return { id: params.id, status: "running" };
    });

    const result = await step.do("step-two", async () => {
      // each step.do persists its return value
      return { something: "useful" };
    });

    await step.reportProgress({
      step: "step-two",
      status: "complete",
      percent: 1,
    });
    await step.reportComplete(result);
    return result;
  }
}
```

### Rules

- **Default-export the class.** ayjnt scans `agents/**/workflow.ts`
  files and reads the default export.
- **`extends AgentWorkflow<Params>`** for co-located agent workflows.
  The optional second generic types progress.
- **`extends Workflow<Params>`** from `ayjnt/workflows` for a plain
  workflow without an originating agent.
- **No aliased imports** for the base class. The detection is
  source-level on `extends AgentWorkflow` / `extends Workflow`.

## Triggering from the agent

Extend Ayjnt's `Agent` directly. The generated workflow registry maps
the sibling workflow payload to `this.workflow(params)`:

```ts
// agents/<route>/agent.ts
import { Agent, callable } from "ayjnt";

export default class MyAgent extends Agent<State> {
  @callable()
  async start(id: string) {
    return this.workflow({ id });
  }

  override async onWorkflowComplete(
    workflowName: string,
    workflowId: string,
    result?: unknown,
  ) {
    this.setState({ /* persist the durable result */ });
  }
}
```

Do not add `withWorkflow`. It is a deprecated compatibility export for
older projects. New agents get the method from `Agent<State>`.

### For non-co-located workflows

If a workflow lives outside the agent's folder (for example a plain
batch under `workflows/`), call
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
declare global {
  namespace Ayjnt {
    interface GeneratedEnv {
      ORDERS_AGENT: DurableObjectNamespace<OrdersAgent>;
      ORDERS_PROCESSING: Workflow;
    }

    interface WorkflowRegistry {
      "/orders": {
        agent: OrdersAgent;
        workflow: typeof OrdersProcessing;
      };
    }
  }
}
```

```ts
// .ayjnt/dist/entry.ts
import OrdersProcessing from "../../agents/orders/workflow.ts";
export { OrdersProcessing };  // Cloudflare runtime registers the class
```

## Workflows and durable state

- **No entries in `migrations[]`.** Workflows are ephemeral execution
  containers. The framework will refuse to add a workflow class to
  the SQLite migrations.
- **State lives in the paired Agent's DO.** Workflows don't have
  `this.state`. Report progress or completion and update durable agent
  state in `onWorkflowProgress`, `onWorkflowComplete`, or
  `onWorkflowError`.

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
  // call agent.stub.placeOrder({ sku, qty, customerId }) on submit
  // render orders with their live status
}
```

Make the agent's trigger method `@callable({ description: "..." })`
so the UI can drive it via a typed `agent.stub.method(...)` call.

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
