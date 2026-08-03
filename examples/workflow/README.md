# Human review workflow

A durable content-preparation workflow with a real human gate:

1. Fetch a source.
2. Extract a bounded research note.
3. Draft a publishable update.
4. Run deterministic policy checks.
5. Pause in `awaiting-approval` until a person approves or rejects it.

```sh
bun install
bun run dev
```

Open `/review/demo`. Workflow steps survive retries and restarts; the approval
decision remains in the parent agent's durable state. Replace the small
deterministic draft step with your model of choice without changing the
architecture.

The sibling files are connected by co-location:

```ts
// workflow.ts
export default class ReviewWorkflow extends AgentWorkflow<Params> {}

// agent.ts
const workflowId = await this.workflow({ id, topic, sourceUrl });
```

There is no origin-agent generic, workflow mixin, or generated binding string
in application code.
