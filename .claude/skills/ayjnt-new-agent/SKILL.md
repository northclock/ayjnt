---
name: ayjnt-new-agent
description: Add a new agent to an ayjnt project. Use when the user asks to "create an agent", "add an agent at /<route>", "scaffold a new agent", or similar. Drops `agents/<route>/agent.ts` with the correct base class, env, and state shape, makes sure the URL maps the way the user expects, and decides whether to also add `app.tsx`, `docs.md`, middleware, or RPC methods based on what the user said. Triggers in any project with an `agents/` folder and an `ayjnt` dependency.
---

# Add a new agent

## The minimum file

Every agent is one folder under `agents/` with an `agent.ts` that
default-exports a class extending `Agent`. The folder path becomes the
URL prefix; `agents/foo/bar/agent.ts` is reachable at `/foo/bar`.

```ts
// agents/<route>/agent.ts
import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { /* fields the agent persists */ };

export default class FooAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { /* defaults */ };

  override async onRequest(request: Request): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
```

## Decisions to make with the user

Before writing the file, confirm:

1. **Folder path** — controls the URL. `agents/chat/agent.ts` → `/chat`.
   Use `(parens)` for a route group that's stripped from the URL but
   still scoped for middleware: `agents/(public)/status/agent.ts` → `/status`.
2. **Class name** — PascalCase. Becomes the DO binding (`FooAgent` →
   `FOO_AGENT` on `env`). Renames are storage-destructive unless
   `agentId` is pinned (see below).
3. **State shape** — what's persisted on each Durable Object instance.
   `this.state` reads, `this.setState({...})` writes + broadcasts to
   any connected UI.
4. **Instance model** — what does the segment after `/<route>/` mean?
   Common patterns: per-user (`/chat/<userId>`), per-room
   (`/room/<roomId>`), per-region (`/inventory/<region>`), or single
   shared instance (always use `"main"`).

## Optional pieces — ask before adding

Only scaffold these if the user explicitly asked for them or if their
description clearly implies one:

- **`app.tsx`** — React UI. Use [`ayjnt-add-ui`](../ayjnt-add-ui/SKILL.md).
- **`docs.md`** — served at `/<route>/docs` through the same middleware
  chain. Useful when others (or other agents) will consume this one.
- **`@callable` methods** — RPC surface exposed in the catalog. Use
  [`ayjnt-rpc`](../ayjnt-rpc/SKILL.md).
- **`extends McpAgent`** instead of `Agent` — when the agent is an MCP
  server (Claude Desktop, Codex, MCP clients). Use [`ayjnt-mcp`](../ayjnt-mcp/SKILL.md).
- **Sibling `middleware.ts`** — only when the user wants this agent's
  *subtree* gated. A middleware sitting next to a leaf agent doesn't
  scope anything additional. Use [`ayjnt-middleware`](../ayjnt-middleware/SKILL.md).

## Stable identity (rename-safe agents)

Folder renames re-derive the default `agentId` from the path, which
the lockfile treats as a *delete + add* — irreversible storage loss.
If the agent has data worth preserving across renames, pin it:

```ts
export const agentId = "chat_v1";
export default class ChatAgent extends Agent<GeneratedEnv> { /* … */ }
```

After that, folder renames are free. Class renames become rename
migrations (storage preserved).

## After writing the file

Tell the user to run `bun run dev` (or build) so the migration entry
is generated. The next build will:

1. Detect the new agent.
2. Stage a `v<N>` migration in `.ayjnt/migrations.json`.
3. Regenerate `wrangler.jsonc` with the new DO binding.
4. Regenerate `env.d.ts` and the typed `useAgent()` hook (if there's
   a UI).

`.ayjnt/migrations.json` **must be committed** — `ayjnt deploy`
refuses to ship if the lockfile diverges.

## URL shape reminder

| URL | Resolves to |
|---|---|
| `/<route>` | Default instance (`"default"`) of the agent. |
| `/<route>/` | Same — default instance. |
| `/<route>/<id>` | `<id>` instance. |
| `/<route>/<id>/<path>` | `<id>` instance; `<path>` arrives as `c.params.pathSuffix`. |
| `/<route>/docs` | The agent's `docs.md` (if present). `"docs"` is a reserved instance name. |

For MCP agents (`extends McpAgent`), the instance scheme doesn't
apply — sessions are managed by the MCP transport.

## Quick check

After scaffolding, the project structure should look like:

```
agents/
  <route>/
    agent.ts       # the file you just added
    [app.tsx]      # optional, only if the user asked
    [docs.md]      # optional
```

Run `bun run dev`. The agent is reachable at `http://localhost:8787/<route>`.
