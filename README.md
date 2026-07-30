# ayjnt

**Agent-first framework for Cloudflare.** No worker boilerplate, no wrangler wrestling.

You write agents. ayjnt generates the worker entrypoint, the wrangler config, and the durable-object migrations — all from your folder structure.

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
import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { messages: string[] };

export default class ChatAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { messages: [] };

  override async onRequest(request: Request): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
```

Save it, and `ayjnt dev` picks it up — no config, no registration, no migration files to hand-write.

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
| `cli.ts` | Optional root-level program. `ayjnt run` (and a compiled binary) boots the worker and calls it in the foreground; when it returns, everything stops. |
| `agents/(group)/` | Route group — stripped from the URL, but its `middleware.ts` still applies. |
| `export const agentId = "..."` | Optional stable ID in `agent.ts`, so renaming the folder preserves the DO's storage. |

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

Each feature is one file or one import away. The linked example is a complete, runnable project.

- **React UI per agent + a home page** — drop `app.tsx` next to `agent.ts` for a per-agent page, or `agents/app.tsx` for a home page at `/`; the generated `useAgent()` hook gives you typed live state with multi-tab sync. → [`examples/with-ui`](./examples/with-ui)
- **Middleware** — auth gates, logging, response wrapping; layered by folder. → [`examples/middleware`](./examples/middleware)
- **Inter-agent RPC** — call another agent's methods with full type safety via `getAgent<T>()` from `ayjnt/rpc`. Native Workers RPC, no HTTP. → [`examples/inter-agent`](./examples/inter-agent)
- **Browser-callable methods** — mark a method with Cloudflare's `@callable()` decorator and call it from the UI as `agent.stub.method()`, typed end-to-end. → [`examples/callable-client`](./examples/callable-client)
- **MCP servers** — extend `McpAgent` and ayjnt routes it through the SDK's MCP transport automatically; connect Claude Desktop or any MCP client. → [`examples/mcp`](./examples/mcp)
- **Scheduling** — `this.schedule()` for one-shot deferred work, `this.scheduleEvery()` for recurring tasks; both survive restarts. → [`examples/scheduled-tasks`](./examples/scheduled-tasks), [`examples/recurring-tasks`](./examples/recurring-tasks)
- **Durable workflows** — pair an agent with a Cloudflare Workflow (`agents/<route>/workflow.ts`) for long-running jobs with retries. → [`examples/workflows`](./examples/workflows)
- **Voice** — wrap your agent in `withVoice()` for streaming speech-to-text and text-to-speech over WebSocket. → [`examples/voice-agent`](./examples/voice-agent)
- **Email** — define `async onEmail(message)` and ayjnt wires Cloudflare Email Routing so the agent can receive and reply. → [`examples/email-bot`](./examples/email-bot)
- **Web browsing** — import `browserTools` from `ayjnt/browser` to give an LLM a real browser via Cloudflare Browser Rendering. → [`examples/browser-tools`](./examples/browser-tools)
- **Agent catalog** — `GET /__ayjnt/catalog` returns a JSON tree of every agent the caller can reach, with its `@callable` methods and docs — filtered by middleware, so gated agents stay hidden. → [`examples/catalog`](./examples/catalog)
- **Model tools, in either runtime** — `tools.ts` next to an agent runs in workerd; `tools.host.ts` runs on the Bun host so a tool can shell out or read a local file. Both merge into one `ToolSet` via `agentTools(this)`. → [`examples/compiled-cli`](./examples/compiled-cli)
- **A single-file executable** — `ayjnt compile` packs your agents, their UIs, `cli.ts`, the Bun runtime and workerd into one binary that runs with no Bun, no `node_modules` and no wrangler. → [`examples/compiled-cli`](./examples/compiled-cli)

For bigger end-to-end apps — multiplayer games, AI chatbots, RAG pipelines, multi-agent systems — browse the full gallery in [`examples/`](./examples).

## Two targets

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

The cost of compiling is size — roughly 170MB, most of it workerd — and that
Workers AI, Browser Rendering and email sending remain remote services needing
network access and credentials. `--no-embed-workerd` trades self-containment for
about 67MB.

## Deploys and migrations

`.ayjnt/migrations.json` is committed to git and is the source of truth for what's in production. `ayjnt deploy` refuses to run from a dirty or unsynced tree, so two developers can't race and produce divergent migration histories (`--force` bypasses, loudly).

Migrations are append-only and derived from your folder tree: renaming an agent folder while keeping its `agentId` preserves storage; removing the `agentId` deletes the DO and its storage irreversibly. `ayjnt migrate` previews what a build would stage.

## Going deeper

- [`examples/`](./examples) — runnable reference projects, smallest to largest
- [`src/README.md`](./src/README.md) — package architecture and the codegen pipeline
- [`src/codegen/README.md`](./src/codegen/README.md) — contracts between pipeline stages
- [`src/runtime/README.md`](./src/runtime/README.md) — runtime helpers, RPC gotchas

## Development

```sh
bun install
bun test          # run all tests
bunx tsc --noEmit # typecheck
bun run bin/ayjnt.ts build --cwd examples/basic
```

## License

MIT
