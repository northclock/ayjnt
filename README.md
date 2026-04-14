# ayjnt

**Agent-first framework for Cloudflare.** No worker boilerplate, no wrangler wrestling.

You write agents. `ayjnt` writes the worker entrypoint, the wrangler config, and the durable-object migrations — all from your folder structure.

```
agents/
  chat/
    agent.ts        ← export default class extends Agent
    app.tsx         ← optional React UI, typed to this agent  (v0.3)
  admin/
    middleware.ts   ← runs for all agents under admin/        (v0.2)
    users/
      agent.ts
```

```sh
ayjnt dev       # local worker
ayjnt deploy    # ship it
```

## Status

**v0.1 — pipeline works end-to-end.** You can scaffold agents, build, and deploy real Cloudflare workers. Middleware chains, typed inter-agent RPC, and co-located React UIs are designed but not yet implemented ([roadmap](#roadmap)).

## Quickstart

```sh
# create a project
mkdir my-agent-app && cd my-agent-app
bun init -y
bun add agents
bun add -d ayjnt wrangler @cloudflare/workers-types

# scaffold your first agent
mkdir -p agents/chat
cat > agents/chat/agent.ts <<'TS'
import { Agent } from "agents";

type Env = Record<string, never>;
type State = { count: number };

export default class ChatAgent extends Agent<Env, State> {
  initialState: State = { count: 0 };
  override async onRequest(): Promise<Response> {
    this.setState({ count: this.state.count + 1 });
    return Response.json(this.state);
  }
}
TS

# build + run
bunx ayjnt dev
# POST http://localhost:8787/chat/<any-id>
```

See [`examples/basic`](./examples/basic) for a working project.

## File conventions

- **`agents/<name>/agent.ts`** — default-export a class extending `Agent`. The folder is the agent. One class per folder.
- **`agents/.../agent.ts` export `const agentId`** — optional stable ID. If you rename the folder, the DO storage is preserved as long as the `agentId` is unchanged. If you don't set it, we derive from the folder path (rename-unsafe).
- **`agents/.../middleware.ts`** — applies to descendant agents. Nested `middleware.ts` chains root → leaf like Next.js `layout.tsx`. *(v0.2)*
- **`agents/(group)/...`** — route groups (parens). Stripped from the URL. Used to share middleware across a subset of agents without nesting them in the URL.
- **`agents/<name>/app.tsx`** — optional React UI for the agent. A typed `useAgent()` hook is generated for you. *(v0.3)*

## Commands

| Command | What it does |
|---|---|
| `ayjnt dev` | Scan + codegen, then `wrangler dev` on the generated config. Unknown flags forward to wrangler (e.g. `ayjnt dev --port 8787`). |
| `ayjnt build` | Pure codegen. Writes `.ayjnt/dist/{wrangler.jsonc, entry.ts}` and updates `.ayjnt/migrations.json` if the file tree diverged. |
| `ayjnt migrate` | Preview the pending migration without writing anything. |
| `ayjnt deploy` | Git-safety checks, rebuild (without staging new migrations), then `wrangler deploy`. Fails if uncommitted changes, unpushed commits, unpulled commits, or unstaged lockfile changes exist. `--force` bypasses. |

All commands accept `--cwd <path>` and forward everything else to `wrangler`.

## Client integration

ayjnt exposes agents at `/<route-path>/<instanceId>`, not at the Cloudflare Agents SDK's default `/agents/<kebab-class-name>/<instance>`. This means **every client connection must set `basePath`** — the option that bypasses the SDK's automatic URL construction.

```ts
import { useAgent } from "agents/react";
import { agentFetch } from "agents/client";

// WebSocket (React)
const agent = useAgent({
  agent: "ChatAgent",
  basePath: `chat/${roomId}`,   // full override; "agent" is ignored when basePath is set
});

// HTTP
await agentFetch(
  { agent: "ChatAgent", basePath: `chat/${roomId}`, host },
  { method: "POST", body: JSON.stringify({ text: "hi" }) },
);
```

### Why `path` doesn't work

The SDK builds URLs as `{host}/{basePath ?? prefix/party/room}{path}`. With the Agents client hardcoding `prefix: "agents"` and kebab-casing the class name:

| Client call | Resulting URL |
|---|---|
| `useAgent({ agent: "ChatAgent", name: "42" })` | `wss://host/agents/chat-agent/42` |
| `useAgent({ agent: "ChatAgent", name: "42", path: "/x" })` | `wss://host/agents/chat-agent/42/x` — `path` is an **append** |
| `useAgent({ agent: "ChatAgent", basePath: "chat/42" })` | `wss://host/chat/42` — **full override** |

The SDK's own docstring for `basePath`: *"Full URL path — bypasses agent/name URL construction. When set, the client connects to this path directly. Server must handle routing manually."* That "handle routing manually" is what ayjnt's generated worker does.

### Identity messages work because of `getAgentByName`

On connect, the agent broadcasts `CF_AGENT_IDENTITY` with `{ name: this.name, agent: kebab(ClassName) }`. For `this.name` to be populated, the server must call `stub.setName(name)` before the request reaches the agent. ayjnt's generated `entry.ts` uses `getAgentByName` from the `agents` package, which does this call internally. A hand-rolled dispatch using `namespace.idFromName + namespace.get` would skip `setName` and every identity message would carry a missing name — see [`src/codegen/README.md`](./src/codegen/README.md#why-getagentbyname-and-not-raw-idfromname--get) for the full explanation.

See [`examples/with-client`](./examples/with-client) for a working demonstration.

## Architecture

```
agents/**/agent.ts ──► scan() ──► Manifest
                                     │
                .ayjnt/migrations.json (committed)
                                     │
              diffMigrations ──► MigrationDiff
                                     │
                  applyDiff ──► updated lockfile
                                     │
            ┌────────────────────────┴────────────────────────┐
            ▼                                                  ▼
  generateWrangler                                   generateEntry
    ▲                                                          ▼
.ayjnt/dist/wrangler.jsonc                      .ayjnt/dist/entry.ts
    │                                                          │
    └──────────────► wrangler dev | wrangler deploy ◄──────────┘
```

See [`src/README.md`](./src/README.md) for how to extend the pipeline, [`src/codegen/README.md`](./src/codegen/README.md) for the contracts between stages.

## The migration contract

`.ayjnt/migrations.json` **is committed to git**. It's the source of truth for what's in production. `ayjnt deploy` refuses to run if:

- the working tree has uncommitted changes, or
- local HEAD is ahead of or behind `origin/<branch>`, or
- running `ayjnt build` would produce a new lockfile entry that hasn't been committed.

This means two developers cannot race and produce divergent migration histories. If you need to deploy a hotfix from an unsynced tree, `--force` exists but is loud about it.

**Migrations are append-only.** Never edit past entries. Renames are detected by a stable `agentId` (either derived from folder path, or explicit via `export const agentId = "..."`). If `agentId` matches an existing one in the lockfile with a different `className`, it's a rename (storage preserved). If the `agentId` is gone, it's a deletion (storage destroyed — irreversible).

## Roadmap

- [x] **v0.1** — scan, migrations, wrangler codegen, dev/deploy CLI
- [ ] **v0.2** — middleware chain (Hono-style `c.next()`), typed `getAgent(name, id)` RPC
- [ ] **v0.3** — co-located `app.tsx` with generated typed `useAgent()` hook
- [ ] **v0.4** — `create-ayjnt` bootstrap, MCP agent support, docs site

## Development

```sh
bun install
bun test          # run all tests
bunx tsc --noEmit # typecheck
bun run bin/ayjnt.ts build --cwd examples/basic
```

See [`src/README.md`](./src/README.md) for package architecture.

## License

TBD.
