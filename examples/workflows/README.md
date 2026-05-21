# ayjnt example: workflows

Demonstrates zero-config Cloudflare **Workflows** paired with an
agent. Drop a file named `workflow.ts` next to `agent.ts` and the
framework wires up the workflow binding, the typed RPC stub, and the
`GeneratedEnv` field.

## What the file tree looks like

```
agents/
└── orders/
    ├── agent.ts        ← OrdersAgent (Durable Object)
    ├── workflow.ts     ← OrdersProcessing  (the trigger)
    └── app.tsx         ← co-located React UI (live status board)
```

The build picks up any `export default class … extends AgentWorkflow`
(or `extends WorkflowEntrypoint`) under `agents/**/workflow.ts` and:

1. Adds the workflow binding to `.ayjnt/dist/wrangler.jsonc`:
   ```jsonc
   "workflows": [{
     "name":       "orders-processing",
     "binding":    "ORDERS_PROCESSING",
     "class_name": "OrdersProcessing"
   }]
   ```
2. Re-exports the class from the generated `entry.ts` so the runtime
   can register it.
3. Adds `ORDERS_PROCESSING: Workflow` to `GeneratedEnv` so
   `this.env.ORDERS_PROCESSING` autocompletes inside agents.

No migrations are needed — Workflows are ephemeral execution
containers; state lives in the paired Agent's Durable Object.

## What the agent looks like

```ts
import { Agent } from "agents";
import { withWorkflow } from "ayjnt/workflow";
import type { GeneratedEnv } from "@ayjnt/env";
import type OrdersProcessing from "./workflow.ts";

export default class OrdersAgent
  extends withWorkflow<typeof OrdersProcessing>()(Agent)<GeneratedEnv, State>
{
  override async onRequest(req: Request): Promise<Response> {
    const { sku, qty, customerId } = await req.json();
    const orderId = crypto.randomUUID();

    // No magic binding string — params shape is lifted from
    // OrdersProcessing's Params generic. IntelliSense knows the fields.
    const workflowId = await this.workflow({ orderId, sku, qty, customerId });

    return Response.json({ orderId, workflowId });
  }

  // Called by the workflow at each milestone via this.agent.markStatus(...)
  async markStatus(orderId: string, status: Status): Promise<void> {
    this.setState({ /* update DO state */ });
  }
}
```

`withWorkflow<typeof OrdersProcessing>()(Agent)` is ayjnt's
ergonomic mixin for co-located workflows. The framework derived the
binding name (`ORDERS_PROCESSING`) at scan time and patched it onto
the agent's prototype, so user code never has to spell the binding
string. Params are type-checked against the workflow's `Params`
generic — rename a field in `workflow.ts` and every call site lights
up red.

> **Not co-located?** If the workflow lives outside the agent's
> folder (e.g. a fire-and-forget batch under a separate `workflows/`
> tree), skip the mixin and call the SDK's
> `this.runWorkflow("BINDING_NAME", params)` directly.

## What the workflow looks like

```ts
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent } from "agents/workflows";
import type { WorkflowStep } from "cloudflare:workers";
import type OrdersAgent from "./agent.ts";

type Params = { orderId: string; sku: string; qty: number; customerId: string };

export default class OrdersProcessing extends AgentWorkflow<OrdersAgent, Params> {
  async run(event: Readonly<AgentWorkflowEvent<Params>>, step: WorkflowStep) {
    const { orderId, sku, qty, customerId } = event.payload;

    // step.do(...) is the unit of durability — each step persists its
    // return value, retries on failure with backoff, and resumes from
    // the last completed step on cold start.
    await step.do("mark-processing", async () => {
      await this.agent.markStatus(orderId, "processing");
    });

    const reserved = await step.do("reserve-inventory", async () => {
      if (qty <= 0) throw new Error("qty must be positive");
      return { sku, qty, reservation: crypto.randomUUID() };
    });

    // step.sleep survives restarts.
    await step.sleep("payment-clearance-delay", "2 seconds");

    const charged = await step.do("charge-customer", async () => {
      return { customerId, amount: qty * 9.99, txn: crypto.randomUUID() };
    });

    await step.do("mark-complete", async () => {
      await this.agent.markStatus(orderId, "complete");
    });

    return { orderId, charged: !!charged };
  }
}
```

The `<OrdersAgent, Params>` generics give you fully typed RPC on
`this.agent` — so `this.agent.markStatus(...)` autocompletes and is
checked against the Agent's signature.

## Try it

```sh
bun install
bun run dev
```

Then open <http://localhost:8787/orders/demo> — the co-located UI
lets you submit an order and watch the row flip through{" "}
`queued → processing → complete` in real time. The workflow's
`step.do(...)` blocks RPC back into the agent (`this.agent.markStatus(...)`),
and setState broadcasts each update over the WebSocket.

Prefer curl?

```sh
curl -X POST http://localhost:8787/orders/cust-42 \
  -H 'content-type: application/json' \
  -d '{"sku":"WIDGET-1","qty":3,"customerId":"cust-42"}'
```

Returns `{ orderId, workflowId }`. GET the same URL for the current
order list.

## Authoring story

### `this.runWorkflow(binding, params)`

`AgentWorkflow<AgentType, Params>` registers itself with the parent
Agent at runtime. The Agent's `this.runWorkflow(binding, params)` is
typed against the bindings the framework knows about — pass a string
that isn't a workflow binding and TypeScript will complain.

Returns the workflow instance id. Look up status later with
`this.env.ORDERS_PROCESSING.get(id).status()`.

### The agent ⇄ workflow loop

Workflows are stateless; agents own the state. The pattern is:

1. Agent receives a request, inserts a record at `queued`, calls
   `this.runWorkflow(...)`.
2. Workflow runs durably, calls back into the agent via
   `this.agent.<method>(...)` (typed RPC) to update milestones.
3. Agent's `setState` updates broadcast to connected WebSocket
   clients — the UI watches state change in real time.

### Step naming matters

`step.do("...", fn)` keys the step's persisted result by its name.
Renaming a step in a deployed workflow makes the runtime think it's a
new step — it will re-execute on resume. Keep step names stable.

### Workflows ≠ Durable Objects

- **Workflows** are ephemeral execution containers. State is
  per-step result snapshots, not arbitrary mutable state.
- **Durable Objects** (agents) hold the durable record of the work.

The framework reflects this: workflow classes go into the
`workflows[]` array, **not** `migrations[]`. There are no SQLite
migrations for workflow classes.

## See also

- [Cloudflare's Workflow + Agents pairing docs](https://developers.cloudflare.com/agents/api-reference/run-workflows/)
- [`src/codegen/scan.ts`](../../src/codegen/scan.ts) — `scanWorkflows` +
  `parseWorkflowSource` are the relevant entry points.
- [`src/codegen/wrangler.ts`](../../src/codegen/wrangler.ts) — where
  the `workflows[]` array gets emitted.
