# `src/runtime/` — public runtime API

This directory contains the small runtime surface user code imports.
Codegen owns discovery and wiring; runtime modules expose ergonomic,
typed operations over that generated information.

## Import paths

| Import | Purpose |
|---|---|
| `"ayjnt"` | `Agent<State>`, `CloudflareAgent`, `callable`, class-safe RPC, and common upstream primitives |
| `"ayjnt/client"` | Route-aware `AgentClient` and the unchanged `CloudflareAgentClient` |
| `"ayjnt/workflows"` | `AgentWorkflow<Params>`, `Workflow<Params>`, workflow event/step types, and upstream escape hatches |
| `"ayjnt/session"` | Direct exports of Cloudflare's experimental Session API |
| `"ayjnt/rpc"` | `getAgent(namespace, name)` for custom namespaces or code outside Ayjnt's Agent |
| `"ayjnt/middleware"` | `Middleware`, `Context`, `Next`, and generated-entry composition helpers |
| `"ayjnt/tools"` | `agentTools`, `hostTool`, `confinePath`, and the host-bridge tool surface |
| `"ayjnt/browser"` | Browser Rendering tools plus automatic binding detection |
| `"ayjnt/voice/client"` | Ayjnt-route-aware voice transport and React hook |
| `"ayjnt/cli"` | Base types and helpers for root `cli.ts` |
| `"@ayjnt/<route>"` | Generated, agent-specific React hook |
| `"@ayjnt/cli"` | Generated project-specific CLI context |

## `Agent<State, Props?>`

[`agent.ts`](./agent.ts) is a thin subclass of Cloudflare's
`Agent<Env, State, Props>`. Ayjnt owns the environment generic through
the ambient `Ayjnt.GeneratedEnv`, so application code normally writes:

```ts
import { Agent } from "ayjnt";

type State = { count: number };

export default class CounterAgent extends Agent<State> {
  initialState: State = { count: 0 };
}
```

Projects add custom bindings through interface merging:

```ts
declare global {
  namespace Ayjnt {
    interface GeneratedEnv {
      OPENAI_API_KEY: string;
      CACHE: KVNamespace;
    }
  }
}
```

The generated `.ayjnt/env.d.ts` merges Durable Object, workflow, and
feature bindings into the same interface. It also exports a
`GeneratedEnv` compatibility alias, but user-authored Ayjnt agents
should not thread it through every class.

### Upstream escape hatch

`CloudflareAgent` is the unchanged class from `"agents"`:

```ts
import { CloudflareAgent } from "ayjnt";

export default class AdvancedAgent
  extends CloudflareAgent<MyEnv, State> {}
```

The scanner discovers either default export. Use the escape hatch when
owning the complete environment generic is intentional.

## Class-safe peer agents

Inside Ayjnt's `Agent`, resolve another top-level agent with its class:

```ts
import InventoryAgent from "../inventory/agent";

const inventory = await this.agent(InventoryAgent, "primary");
await inventory.reserve("widget", 2);
```

The class value serves two roles:

1. TypeScript infers the returned stub and its public methods.
2. Generated entry code looks up the matching Durable Object binding
   from a constructor-to-binding map injected on every agent prototype.

Missing classes fail with a guided error. Do not replace the class with
a route or binding string.

The namespace overload and standalone helper remain for advanced code:

```ts
const custom = await this.agent(this.env.CUSTOM_AGENT, "primary");
const outside = await getAgent(env.INVENTORY_AGENT, "primary");
```

Both delegate to Cloudflare's canonical named-agent lookup so the
target learns its instance name.

## Co-located workflows

`Agent.workflow(params)` starts the sibling `workflow.ts`. The generated
`Ayjnt.WorkflowRegistry` connects the origin agent type to the
workflow's parameter type.

```ts
// agent.ts
const workflowId = await this.workflow({ documentId });
```

```ts
// workflow.ts
import { AgentWorkflow } from "ayjnt/workflows";

export default class ReviewWorkflow
  extends AgentWorkflow<{ documentId: string }> {}
```

No binding string, origin-agent generic, or mixin is required.
`withWorkflow` remains exported only for source compatibility.

`Workflow<Params, Env?>` wraps a plain `WorkflowEntrypoint`.
`CloudflareAgentWorkflow` and `WorkflowEntrypoint` are exported as
unchanged escape hatches.

## Sessions

`Agent.createSession(id?)` and `Agent.createSessionManager()` return
Cloudflare's experimental Session objects backed by the agent's SQLite.
[`session.ts`](./session.ts) re-exports the same classes and types
without changing their storage or behavior.

Keep this API marked experimental in user documentation and check the
installed SDK types when upgrading.

## Browser clients

Generated hooks under `@ayjnt/<route>` bake in the file route and agent
class. Prefer:

```tsx
const agent = useAgent();
await agent.stub.addNote("hello");
```

For non-React browser code, [`client.ts`](./client.ts) subclasses the
upstream client only to translate `{ route, name }` into Ayjnt's
`basePath`:

```ts
const client = new AgentClient<NotesAgent>({
  route: "/notes",
  name: "personal",
});

await client.ready;
await client.stub.addNote("hello");
```

## Middleware

`Middleware<Env>` composes in root-to-leaf order. Return a response to
short-circuit, or call `next()` once and optionally wrap the result.
Middleware runs in the generated worker entry, outside the Durable
Object; pass request-scoped data to an agent through headers or the
request body rather than the middleware stash.

## Adding a runtime helper

1. Add a focused module under `src/runtime/`.
2. Add its package export in [`../../package.json`](../../package.json).
3. Re-export it from [`index.ts`](./index.ts) only when it belongs on
   the default surface.
4. Add direct tests and declaration-build coverage.
5. Put generated relationships in `src/codegen`, not in runtime
   reflection or user-authored strings.

Runtime helpers should stay thin. If an operation needs framework
knowledge, generate the smallest typed registry and consume it here.
