# ayjnt

**An agent harness framework for people and their agents.**

Ayjnt gives agents a safe runtime, native host capabilities, durable state, and
first-class interfaces for the browser and terminal. You write the harness;
Ayjnt generates the runtime entrypoint, configuration, migrations, and typed
clients from the folder structure.

```
agents/
  app.tsx           ← optional home UI, served at /
  middleware.ts     ← optional, runs for every agent
  chat/
    agent.ts        ← export default class extends Agent
    app.tsx         ← optional React UI, typed to this agent
    docs.md         ← optional markdown, served at /chat/docs
  admin/
    middleware.ts   ← runs for every agent under admin/
    users/
      agent.ts      ← served at /admin/users/:instance-id
```

## Quickstart

```sh
bunx ayjnt new my-app           # UI included: a home page + a counter agent
bunx ayjnt new my-app --empty   # bare: one "I'm alive" agent, no UI

cd my-app
bun install
bun run dev
# open http://localhost:8787/              home page (agents/app.tsx)
# open http://localhost:8787/counter/demo  the counter agent's page
# (--empty)  curl http://localhost:8787/alive/hello
```

That's a running agent: the folder path is the URL, the trailing segment picks a Durable Object instance (`/counter/demo` and `/counter/bob` are two separate stateful instances; no segment means `default`).

A minimal agent looks like this:

```ts
// agents/chat/agent.ts
import { Agent } from "ayjnt";

type State = { messages: string[] };

export default class ChatAgent extends Agent<State> {
  override initialState: State = { messages: [] };

  override async onRequest(request: Request): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
```

Save it, and `ayjnt dev` picks it up — no config, no registration, no migration files to hand-write.

Ayjnt's `Agent` is a transparent subclass of Cloudflare's Agents SDK class. If
you need to own the complete environment generic, use the unchanged escape
hatch:

```ts
import { CloudflareAgent } from "ayjnt";

export default class AdvancedAgent
  extends CloudflareAgent<MyEnv, State> {}
```

Both default exports are discovered and routed the same way. Ayjnt's wrapper
adds class-safe peer lookup, co-located workflow dispatch, and session helpers.

## File conventions — the whole API

| File | What it does |
|---|---|
| `agents/<route>/agent.ts` | Required. Default-export a class extending `Agent` (or `McpAgent`). The folder path is the URL prefix. |
| `agents/<route>/app.tsx` | Optional React UI, served at the agent's own URL. A typed `useAgent()` hook is generated for you. |
| `agents/app.tsx` | Optional **home page**, served at `/`. The root UI — composes any agent through its typed hook, gated by the root `middleware.ts`. |
| `agents/<route>/docs.md` | Optional markdown docs, served at `/<route>/docs` behind the same middleware as the agent. |
| `agents/**/middleware.ts` | Hono-style middleware for every descendant agent. Files chain root → leaf, like Next.js layouts. |
| `agents/<route>/tools.ts` | Optional model tools that run **in workerd**, next to the agent. Deploy like any other worker code. |
| `agents/<route>/tools.host.ts` | Optional model tools that run **on the Bun host**, so they can use `Bun.$`, `Bun.file`, `bun:sqlite`. Cannot be deployed to Cloudflare. |
| `agents/<route>/workflow.ts` | Optional durable workflow paired with the agent by co-location. |
| `modules/**/*.wasm` | Optional compiled WebAssembly modules imported as `@ayjnt/modules/<path>` by agents and workflows. |
| `cli.ts` | Optional root-level program. `ayjnt run` (and a compiled binary) boots the worker and calls it in the foreground; when it returns, everything stops. |
| `agents/(group)/` | Route group — stripped from the URL, but its `middleware.ts` still applies. |
| `export const agentId = "..."` | Optional explicit identity for complex refactors. Plain folder moves are already tracked by class name. |

## Core APIs

Call another top-level agent by class value so TypeScript and the runtime use
the same identity:

```ts
import { Agent } from "ayjnt";
import InventoryAgent from "../inventory/agent";

export default class OrdersAgent extends Agent {
  async reserve(sku: string, quantity: number) {
    const inventory = await this.agent(InventoryAgent, "primary");
    return inventory.reserve(sku, quantity);
  }
}
```

Add `workflow.ts` beside `agent.ts`, extend `AgentWorkflow<Params>`, and start it
without a mixin or binding name:

```ts
const workflowId = await this.workflow({ documentId });
```

Browser interfaces use their generated `useAgent()` hook and typed
`agent.stub.method(...)` calls. Terminal interfaces live in the root `cli.ts`.
Durable state, SQLite, schedules, sub-agents, and Cloudflare's experimental
sessions remain available on the same `Agent<State>` class.

## Commands

| Command | What it does |
|---|---|
| `ayjnt new <dir>` | Scaffold a project. UI included by default; `--empty` for a bare, no-UI starter. |
| `ayjnt dev` | Codegen, then `wrangler dev`. |
| `ayjnt run` | Run the app on ayjnt's own local runtime, including `cli.ts`. The same code path a compiled binary uses. |
| `ayjnt build` | Pure codegen — writes `.ayjnt/` (wrangler config, worker entry, typed hooks, env types). |
| `ayjnt compile` | Build a self-contained executable — agents, UIs, `cli.ts`, the Bun runtime and workerd in one file. |
| `ayjnt migrate` | Preview the pending DO migration without writing anything. |
| `ayjnt deploy` | Git-safety checks, build, then `wrangler deploy`. |

`dev`, `build`, `migrate` and `deploy` accept `--cwd <path>` and forward unknown flags to wrangler (e.g. `ayjnt dev --port 8788`). `run` and `compile` have their own flags — see `ayjnt run --help` — and `run` passes anything after `--` to your `cli.ts`.

## What you can build

The examples are deliberately few and complete. Each is a recognizable harness,
with agent behavior and the interface a person actually uses:

- **Coding harness** — a full-screen OpenTUI coding agent, host tools, durable
  sessions, and a browser transcript and usage dashboard. →
  [`examples/code`](./examples/code)
- **Realtime voice** — low-latency Gemini Live audio with an expressive,
  audio-reactive browser interface. →
  [`examples/realtime-voice`](./examples/realtime-voice)
- **Chess arena** — play an agent or orchestrate two providers, with server-side
  rules and model output constrained to legal moves. →
  [`examples/chess`](./examples/chess)
- **Scheduled monitor** — one-time, recurring, and cron endpoint checks in one
  practical scheduling example. →
  [`examples/scheduler`](./examples/scheduler)
- **Human review workflow** — durable preparation steps followed by a visible,
  persistent approval gate. →
  [`examples/workflow`](./examples/workflow)
- **Research team** — a lead agent delegates to researcher and reviewer agents
  through typed RPC and exposes every handoff. →
  [`examples/orchestration`](./examples/orchestration)

## Two ways to run

The same agents ship two ways, and they are not equivalent.

**`ayjnt deploy`** puts them on Cloudflare's edge: globally distributed, scales
to zero, Durable Objects backed by real infrastructure.

**`ayjnt compile`** produces a single executable that carries the Bun runtime and
workerd inside it. It needs no Bun, no `node_modules`, and no wrangler to run —
and it has **strictly more capability** than the edge, because a `cli.ts` and a
`tools.host.ts` run in a Bun process alongside the Workers runtime. An agent can
hold Durable Object state, run a workflow, serve a React UI, *and* read a local
file or shell out to git.

That extra capability is exactly why host tools can't be deployed: there is no
host process on Cloudflare, so `ayjnt deploy` refuses a project containing a
`tools.host.ts` rather than shipping something that faults on its first tool call.

The cost of compiling is a large platform-dependent binary, mostly workerd, and that
Workers AI, Browser Rendering and email sending remain remote services needing
network access and credentials. `--no-embed-workerd` trades self-containment
for a smaller artifact that requires `AYJNT_WORKERD_PATH`.

## Deploys and migrations

`.ayjnt/migrations.json` is committed to git and is the source of truth for what's in production. `ayjnt deploy` refuses to run from a dirty or unsynced tree, so two developers can't race and produce divergent migration histories (`--force` bypasses, loudly).

Migrations are append-only and derived from your folder tree. A plain folder
move with the same class preserves storage automatically, and an in-place class
rename becomes a Durable Object rename migration. Use an explicit `agentId`
when a larger refactor would otherwise make identity ambiguous. Removing an
agent entirely stages a destructive deletion; `ayjnt migrate` previews every
pending change before a build writes it.

## Going deeper

- [`examples/`](./examples) — six complete, runnable harnesses
- [`src/README.md`](./src/README.md) — package architecture and the codegen pipeline
- [`src/codegen/README.md`](./src/codegen/README.md) — contracts between pipeline stages
- [`src/runtime/README.md`](./src/runtime/README.md) — runtime helpers, RPC gotchas
- [`.agents/skills/`](./.agents/skills) — portable coding-agent guidance,
  mirrored in [`.claude/skills/`](./.claude/skills) for Claude Code

## Development

```sh
bun install
bun test          # run all tests
bun run typecheck # server + client typecheck
bun run build     # build package artifacts
bun run bin/ayjnt.ts build --cwd examples/scheduler
```

## License

MIT
