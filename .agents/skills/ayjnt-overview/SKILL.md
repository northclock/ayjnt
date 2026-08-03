---
name: ayjnt-overview
description: Primer on the ayjnt framework — file conventions, what the codegen produces, the CLI surface, and where to find each feature. Use this when the user asks general "how does ayjnt work" / "what is ayjnt" / "how do I get started" questions, when they need to understand the layout of a freshly cloned ayjnt project, or as a default fallback when no more specific ayjnt skill matches. Detects ayjnt projects by the presence of an `agents/` directory or the `ayjnt` dependency in `package.json`.
---

# ayjnt overview

**ayjnt** is a human-first agent harness framework powered by Bun and
workerd. The user authors `agents/`; the framework generates the worker
entry, runtime configuration, migrations, typed clients, and browser UI
bundles.

## File conventions — the whole API

```
cli.ts               # optional — project root; default-exports the program `ayjnt run` invokes
agents/
  app.tsx            # optional — root home UI, served at /
  middleware.ts      # optional — applies to every descendant agent
  <route>/
    agent.ts         # required — default-exports a class extending Agent or McpAgent
    app.tsx          # optional — co-located React UI, served at same URL
    docs.md          # optional — markdown, served at /<route>/docs
    tools.ts         # optional — model tools running in workerd; deploys normally
    tools.host.ts    # optional — model tools running on the Bun host; compile-only
    workflow.ts      # optional — durable workflow co-located with this agent
  (group)/           # optional — route group; folder name stripped from URL, middleware chains still apply
    <route>/agent.ts
```

The folder path under `agents/` is the URL prefix.
`agents/admin/users/agent.ts` becomes `/admin/users`. Each path segment
after the prefix is a Durable Object instance id —
`/admin/users/bob` selects the `bob` instance. **No instance segment
defaults to `"default"`**: `/admin/users` and `/admin/users/default`
hit the same DO.

## Required agent shape

```ts
// agents/<route>/agent.ts
import { Agent } from "ayjnt";

type State = { /* whatever */ };

export default class FooAgent extends Agent<State> {
  override initialState: State = { /* … */ };

  override async onRequest(request: Request): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
```

**Must default-export the class.** Prefer Ayjnt's `Agent<State>` so
generated environment bindings, typed peer lookup, co-located workflows,
and sessions stay ergonomic. A default export extending Cloudflare's
unchanged `Agent<Env, State>` remains supported when the author needs
full control over the environment generic. Use `McpAgent` for MCP
servers; see [`ayjnt-mcp`](../ayjnt-mcp/SKILL.md).
The class name (PascalCase) becomes the DO binding name (UPPER_SNAKE_CASE)
on `env`.

For stable identity across folder renames, optionally export an explicit
agentId:

```ts
export const agentId = "users_v1";
```

## CLI surface

| Command | What it does |
|---|---|
| `bunx ayjnt new <dir>` | Scaffold a fresh project. UI included by default (home page + counter); `--empty` for a bare, no-UI starter. |
| `bun run dev` (== `ayjnt dev`) | Codegen + `wrangler dev`. Does **not** run `cli.ts`. |
| `ayjnt run` | Codegen + bundle + boot ayjnt's own local workerd, then invoke `cli.ts` in the foreground. Same code path a compiled binary uses. |
| `bun run build` (== `ayjnt build`) | Pure codegen — writes `.ayjnt/dist/{wrangler.jsonc,entry.ts}` + the typed `useAgent` hooks. |
| `ayjnt compile` | Self-contained executable containing Bun, workerd, and the app. |
| `bun run migrate` | Preview pending DO-migration entry without writing it. |
| `bun run deploy` (== `ayjnt deploy`) | Git safety + build + `wrangler deploy`. |

`dev`, `deploy` and `build` forward unknown flags to wrangler. `run` and
`compile` own their flags; for `run`, arguments after `--` go to `cli.ts`
as `argv`.

## The generated `.ayjnt/` tree

After `bun run build` you'll see:

```
.ayjnt/
  migrations.json              # committed to git — the source of truth for what's in prod
  tsconfig.json                # path aliases @ayjnt/<route> and @ayjnt/cli
  env.d.ts                     # ambient Ayjnt.GeneratedEnv + workflow registry
  client/<route>/index.tsx     # typed useAgent() hook per agent
  client/<route>/mount.tsx     # React mount wrapper (when app.tsx exists)
  assets/__ayjnt/<flat>/*      # bundled HTML + JS per UI agent
  dist/entry.ts                # worker entry — the file wrangler runs
  dist/wrangler.jsonc          # DO bindings, migrations, assets binding
```

Everything except `migrations.json` is regenerated on each build and
should be gitignored.

## Built-in routes the framework reserves

- `/<route>/docs` — serves the agent's `docs.md` (if present) with mime
  `text/markdown`. Goes through the same middleware chain as the agent.
- `/__ayjnt/catalog` — JSON tree of every agent the caller can reach,
  filtered by each agent's middleware. Returns `@callable` methods,
  `hasApp`, `hasDocs`, `docsUrl` per agent.
- `/` — serves the root home UI when `agents/app.tsx` exists (HTML
  navigations only), through the root `agents/middleware.ts` chain.
  404 otherwise. See [`ayjnt-add-ui`](../ayjnt-add-ui/SKILL.md).

## Feature index

| Task | Skill | Example |
|---|---|---|
| Add a new agent under `agents/<route>/`. | `ayjnt-new-agent` | [`examples/scheduler`](../../../examples/scheduler) |
| Add a React UI to an existing agent. | `ayjnt-add-ui` | [`examples/code`](../../../examples/code) |
| Persist synchronized state or relational records. | `ayjnt-state` | [`examples/chess`](../../../examples/chess) |
| Keep durable conversation memory. | `ayjnt-sessions` | [`examples/code`](../../../examples/code) |
| Run delayed, recurring, or cron work. | `ayjnt-scheduling` | [`examples/scheduler`](../../../examples/scheduler) |
| Build an MCP agent (Claude Desktop, Codex, MCP clients). | `ayjnt-mcp` | — |
| Add auth or other middleware to a subtree. | `ayjnt-middleware` | — |
| Call one agent from another (typed RPC). | `ayjnt-rpc` | [`examples/orchestration`](../../../examples/orchestration) |
| Add a durable co-located workflow. | `ayjnt-workflows` | [`examples/workflow`](../../../examples/workflow) |
| Give the model tools (workerd or Bun host). | `ayjnt-tools` | [`examples/code`](../../../examples/code) |
| Turn the project into a runnable program (`cli.ts`). | `ayjnt-cli-file` | [`examples/code`](../../../examples/code) |
| Run locally on ayjnt's runtime, or ship a binary. | `ayjnt-compile` | [`examples/code`](../../../examples/code) |
| Diagnose a failure mode. | `ayjnt-troubleshoot` | — |

## Gotchas to keep in mind

- `.ayjnt/migrations.json` is **committed**. `ayjnt deploy` refuses to
  run from an out-of-sync tree or with a divergent lockfile.
- The class name dictates the DO binding name. Renaming the class
  without bumping `agentId` is a rename (storage preserved).
- `app.tsx` must `export default` a React component. The framework
  owns the mount.
- Folder names in parens are route groups: stripped from the URL,
  still contribute to the middleware chain.
- A locally-running app spans **two runtimes**: `cli.ts` and
  `tools.host.ts` run in Bun (`Bun.$`, `Bun.file`, `bun:sqlite`),
  everything under `agents/` runs in workerd (no Bun APIs). `ayjnt
  deploy` refuses a project containing `tools.host.ts` — there's no
  host process on Cloudflare.
- Inside an Ayjnt agent, resolve a peer with its class value:
  `await this.agent(InventoryAgent, "primary")`. Do not repeat a route,
  binding, or class name as a string.
- A sibling `workflow.ts` is started with `this.workflow(params)`.
  Do not add `withWorkflow`; it is retained only for compatibility.
