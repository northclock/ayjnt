---
name: ayjnt-new-agent
description: Add a new agent to an Ayjnt project. Use when the user asks to create or scaffold an agent, add an agent at a route, or extend an existing harness. Creates the route's agent.ts with Ayjnt's state-typed Agent, verifies URL and instance semantics, and adds app.tsx, tools, workflows, middleware, callable methods, or sessions only when needed.
---

# Add a new agent

## The minimum file

Every agent is one folder under `agents/` with an `agent.ts` that
default-exports a class extending `Agent`. The folder path becomes the
URL prefix; `agents/foo/bar/agent.ts` is reachable at `/foo/bar`.

```ts
// agents/<route>/agent.ts
import { Agent } from "ayjnt";

type State = { /* fields the agent persists */ };

export default class FooAgent extends Agent<State> {
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
2. **Class name** — PascalCase. It becomes the generated DO binding,
   but user code should address peer agents by class value rather than
   repeating that binding string.
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
- **`workflow.ts`** — durable multi-step work. Use
  [`ayjnt-workflows`](../ayjnt-workflows/SKILL.md).
- **`tools.ts` / `tools.host.ts`** — model tools in workerd or Bun.
  Use [`ayjnt-tools`](../ayjnt-tools/SKILL.md).
- **`extends McpAgent`** instead of `Agent` — when the agent is an MCP
  server (Claude Desktop, Codex, MCP clients). Use [`ayjnt-mcp`](../ayjnt-mcp/SKILL.md).
- **Sibling `middleware.ts`** — only when the user wants this agent's
  *subtree* gated. A middleware sitting next to a leaf agent doesn't
  scope anything additional. Use [`ayjnt-middleware`](../ayjnt-middleware/SKILL.md).

## Stable identity (rename-safe agents)

The default `agentId` derives from the folder path. Ayjnt recognizes a
plain folder move when the class name stays the same, and a class rename
when the id stays the same. Pin an explicit id before a refactor that
changes both, or whenever long-lived production identity should not
depend on file placement:

```ts
export const agentId = "chat_v1";
export default class ChatAgent extends Agent { /* … */ }
```

After that, folder and class renames become unambiguous
storage-preserving moves or rename migrations.

## After writing the file

Tell the user to run `bun run dev` (or build) so the migration entry
is generated. The next build will:

1. Detect the new agent.
2. Stage a `v<N>` migration in `.ayjnt/migrations.json`.
3. Regenerate `wrangler.jsonc` with the new DO binding.
4. Regenerate `env.d.ts` and the typed `useAgent()` hook (if there's
   a UI).

Ayjnt owns the generated environment. Do not import
`GeneratedEnv` just to extend `Agent`; use `Agent<State>`. If the
agent needs a custom binding, augment the ambient interface:

```ts
declare global {
  namespace Ayjnt {
    interface GeneratedEnv {
      OPENAI_API_KEY: string;
    }
  }
}
```

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
