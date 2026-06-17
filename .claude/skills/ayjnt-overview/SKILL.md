---
name: ayjnt-overview
description: Primer on the ayjnt framework — file conventions, what the codegen produces, the CLI surface, and where to find each feature. Use this when the user asks general "how does ayjnt work" / "what is ayjnt" / "how do I get started" questions, when they need to understand the layout of a freshly cloned ayjnt project, or as a default fallback when no more specific ayjnt skill matches. Detects ayjnt projects by the presence of an `agents/` directory or the `ayjnt` dependency in `package.json`.
---

# ayjnt overview

**ayjnt** is a folder-based framework for Cloudflare Workers + Durable
Objects. The user authors `agents/`; the framework generates the worker
entry, the wrangler config, the migrations, and (optionally) the React
UI bundles.

## File conventions — the whole API

```
agents/
  app.tsx            # optional — root home UI, served at /
  middleware.ts      # optional — applies to every descendant agent
  <route>/
    agent.ts         # required — default-exports a class extending Agent or McpAgent
    app.tsx          # optional — co-located React UI, served at same URL
    docs.md          # optional — markdown, served at /<route>/docs
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
import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { /* whatever */ };

export default class FooAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { /* … */ };

  override async onRequest(request: Request): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
```

**Must default-export the class**, **must extend `Agent`** (or `McpAgent`
from `agents/mcp` — see [`ayjnt-mcp`](../ayjnt-mcp/SKILL.md)).
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
| `bun run dev` (== `ayjnt dev`) | Codegen + `wrangler dev`. |
| `bun run build` (== `ayjnt build`) | Pure codegen — writes `.ayjnt/dist/{wrangler.jsonc,entry.ts}` + the typed `useAgent` hooks. |
| `bun run migrate` | Preview pending DO-migration entry without writing it. |
| `bun run deploy` (== `ayjnt deploy`) | Git safety + build + `wrangler deploy`. |

All commands forward unknown flags to wrangler.

## The generated `.ayjnt/` tree

After `bun run build` you'll see:

```
.ayjnt/
  migrations.json              # committed to git — the source of truth for what's in prod
  tsconfig.json                # path aliases @ayjnt/env, @ayjnt/<route>
  env.d.ts                     # GeneratedEnv type — every DO binding
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
| Add a new agent under `agents/<route>/`. | `ayjnt-new-agent` | [`examples/basic`](../../../examples/basic) |
| Add a React UI to an existing agent. | `ayjnt-add-ui` | [`examples/with-ui`](../../../examples/with-ui) |
| Build an MCP agent (Claude Desktop, Codex, MCP clients). | `ayjnt-mcp` | [`examples/mcp`](../../../examples/mcp) |
| Add auth or other middleware to a subtree. | `ayjnt-middleware` | [`examples/middleware`](../../../examples/middleware) |
| Call one agent from another (typed RPC). | `ayjnt-rpc` | [`examples/inter-agent`](../../../examples/inter-agent) |
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
