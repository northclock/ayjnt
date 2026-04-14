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

**v0.4 — `ayjnt new` bootstrap and MCP agent support.** Scaffold a fresh project with one command (minimal or with-ui template), and agents extending `McpAgent` route through the Agents SDK's `.serve()` handler automatically so tool-calling LLM integrations work with zero extra wiring.

## Quickstart

```sh
bunx ayjnt new my-app          # minimal template (one agent, no UI)
bunx ayjnt new my-app --with-ui   # with a React UI bound to the agent

cd my-app
bun install
bun run dev
# POST http://localhost:8787/chat/<any-id>    (minimal)
# open http://localhost:8787/counter/demo     (with-ui)
```

See [`examples/basic`](./examples/basic) for the smallest hand-written project, or [`examples/with-ui`](./examples/with-ui) for the UI version.

## File conventions

- **`agents/<name>/agent.ts`** — default-export a class extending `Agent`. The folder is the agent. One class per folder.
- **`agents/.../agent.ts` export `const agentId`** — optional stable ID. If you rename the folder, the DO storage is preserved as long as the `agentId` is unchanged. If you don't set it, we derive from the folder path (rename-unsafe).
- **`agents/.../middleware.ts`** — applies to descendant agents. Nested `middleware.ts` files chain root → leaf like Next.js `layout.tsx`. Default-export a `Middleware` function.
- **`agents/(group)/...`** — route groups (parens). Stripped from the URL. Used to share middleware across a subset of agents without nesting them in the URL.
- **`agents/<name>/app.tsx`** — optional React UI for the agent. A typed `useAgent()` hook is generated for you. Bundled with Bun and served from the same URL as the agent.

## Commands

| Command | What it does |
|---|---|
| `ayjnt new <dir>` | Scaffold a new project. `--with-ui` includes a React starter. |
| `ayjnt dev` | Scan + codegen, then `wrangler dev` on the generated config. Unknown flags forward to wrangler (e.g. `ayjnt dev --port 8787`). |
| `ayjnt build` | Pure codegen. Writes `.ayjnt/dist/{wrangler.jsonc, entry.ts}`, `.ayjnt/tsconfig.json`, `.ayjnt/env.d.ts`, `.ayjnt/client/**`, and updates `.ayjnt/migrations.json` if the file tree diverged. |
| `ayjnt migrate` | Preview the pending migration without writing anything. |
| `ayjnt deploy` | Git-safety checks, rebuild (without staging new migrations), then `wrangler deploy`. Fails if uncommitted changes, unpushed commits, unpulled commits, or unstaged lockfile changes exist. `--force` bypasses. |

All commands accept `--cwd <path>` and forward everything else to `wrangler`.

## Middleware chain

Layer request-handling logic via files. Every `middleware.ts` from the project root down to an agent folder is collected and chained root → leaf, Hono-style:

```
agents/
  middleware.ts              ← always runs first (logging, timing)
  admin/
    middleware.ts            ← runs for everything under /admin (auth gate)
    users/
      agent.ts               → chain: [root, admin] then the agent
  (public)/
    status/
      agent.ts               → chain: [root] then the agent (route group stripped from URL)
```

A middleware is a plain function:

```ts
// agents/admin/middleware.ts
import type { Middleware } from "ayjnt/middleware";

export default (async (c, next) => {
  if (c.request.headers.get("authorization") !== "Bearer ...") {
    return c.text("forbidden", 403);
  }
  return next();
}) satisfies Middleware;
```

The `Context` (`c`) carries the request, url, env, params (`instanceId`, `pathSuffix`), plus response helpers (`c.json`, `c.text`, `c.html`, `c.redirect`) and a per-request stash (`c.set` / `c.get`). Call `next()` to continue the chain; return a `Response` to short-circuit; do anything after `await next()` to wrap the inner response (e.g. add headers).

### Key / env on the Context

The Context is generic over your env shape:

```ts
type MyEnv = {
  CHAT_AGENT: DurableObjectNamespace<ChatAgent>;
  KV: KVNamespace;
};

export default (async (c, next) => {
  const cached = await c.env.KV.get(c.params.instanceId);   // typed
  // ...
}) satisfies Middleware<MyEnv>;
```

Until v0.3 generates typed envs for you, declare the bindings you use on each middleware.

See [`examples/middleware`](./examples/middleware) for a working end-to-end demonstration including route groups and response wrapping.

## Inter-agent RPC

Call another agent's methods from inside an agent with full type safety:

```ts
import { getAgent } from "ayjnt/rpc";
import type InventoryAgent from "../inventory/agent.ts";

type Env = {
  INVENTORY_AGENT: DurableObjectNamespace<InventoryAgent>;
};

// inside OrdersAgent:
const inv = await getAgent<InventoryAgent>(this.env.INVENTORY_AGENT, "main");
const remaining = await inv.decrement("widget", 3);   // typed return
```

`getAgent<T>` is a thin wrapper over the SDK's `getAgentByName` — it does `idFromName → get → setName` so the target DO knows its identity, and returns a `DurableObjectStub<T>` with method autocomplete. No HTTP, no JSON serialization round-trip — this is native Workers RPC.

Gotchas to be aware of:

- **Async boundary.** Every method call is a trip to the target DO (possibly on another machine). `await` is required; don't call in tight loops.
- **RPC args must be Cloudflare-structured-cloneable** — plain data. No functions; serialize `Date`/`Map`/etc. yourself.
- **Errors propagate unchanged.** An exception thrown in the callee re-throws at the call site. If your `onRequest` doesn't catch, the worker returns a plain-text 500 stack trace (not JSON) — so client code doing `res.json()` crashes. Always wrap RPC calls at HTTP boundaries and translate to a structured response. See [`src/runtime/README.md`](./src/runtime/README.md#gotchas-1) for the pattern.
- **DO state persists across runs.** Storage survives worker restarts by design; re-running a demo script hits the DO with accumulated state unless you reset explicitly. In development, `rm -rf .wrangler` wipes local DO storage.
- **Env type is your responsibility** (until v0.3). Declare each binding you use on the caller's `Env` with `DurableObjectNamespace<TargetAgent>`.

See [`examples/inter-agent`](./examples/inter-agent) for a two-agent demonstration with oversell protection.

## Co-located UI

Drop an `app.tsx` next to your `agent.ts` and you get a React app bound to that agent:

```tsx
// agents/counter/app.tsx
import { createRoot } from "react-dom/client";
import { useAgent } from "@ayjnt/counter";     // ← generated, typed to CounterAgent

function Counter() {
  const agent = useAgent();                     // URL-derived instance, typed State
  const count = agent.state?.count ?? 0;
  return (
    <div>
      <h1>{count}</h1>
      <button onClick={() => agent.setState({ count: count + 1 })}>+</button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Counter />);
```

`ayjnt build` bundles this with Bun (target: browser), inlines it into an HTML shell, and the worker serves it at `GET /counter/:id` when the request has `Accept: text/html`. WebSocket upgrades and API calls to the same URL still route to the agent, so one URL serves both the UI and its data.

### The generated pieces

For each agent, `ayjnt build` produces:

| File | What it is |
|---|---|
| `.ayjnt/tsconfig.json` | Defines path aliases `@ayjnt/*` and `@ayjnt/env`. Extend this from your own tsconfig. |
| `.ayjnt/env.d.ts` | `GeneratedEnv` type with every DO binding typed against the correct agent class. |
| `.ayjnt/client/<route>/index.tsx` | Typed `useAgent()` hook bound to that agent's route and state type. |
| `.ayjnt/dist/entry.ts` | Worker entry with HTML shell inlined for every agent that has `app.tsx`. |

### Setup in your tsconfig

Two options:

**Extend the generated config** (one line, auto-updates as ayjnt evolves):

```json
{
  "extends": "./.ayjnt/tsconfig.json"
}
```

Run `ayjnt build` at least once first so the file exists.

**Inline the paths** (works before first build — note the `./` prefix, TS requires it when `baseUrl` isn't set):

```json
{
  "compilerOptions": {
    "paths": {
      "@ayjnt/env": ["./.ayjnt/env.d.ts"],
      "@ayjnt/*": ["./.ayjnt/client/*"]
    }
  }
}
```

### HTML vs agent on the same URL

`/counter/:id` serves two different things depending on how you ask for it:

| Request shape | Response |
|---|---|
| `GET` + `Accept: text/html`, no `Upgrade` | HTML shell (the UI) |
| `GET` + `Upgrade: websocket` | WebSocket handshake → agent |
| Anything else (POST, curl without `Accept: text/html`) | agent's `onRequest` |

The disambiguation is a few lines in the generated `entry.ts`. Middleware runs for both paths so admin auth gates the UI along with the API — consistent mental model.

See [`examples/with-ui`](./examples/with-ui) for a working demonstration (counter with live multi-tab state sync).

## MCP agents

Cloudflare's Agents SDK ships a `McpAgent` base class for Model Context Protocol servers — tool/prompt/resource endpoints an LLM can call. ayjnt detects the base class and routes requests through the SDK's `McpAgent.serve()` handler automatically:

```ts
// agents/tools/agent.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GeneratedEnv } from "@ayjnt/env";

export default class Tools extends McpAgent<GeneratedEnv> {
  server = new McpServer({ name: "my-tools", version: "1.0.0" });

  async init() {
    this.server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }));
  }
}
```

`ayjnt build` sees `extends McpAgent` and emits dispatch that calls `Tools.serve("/tools", { binding: "TOOLS" }).fetch(request, env, ctx)` instead of the normal agent stub fetch. The MCP transport layer (streamable-http, SSE, session management) is handled for you; middleware still runs before the dispatch.

### URL shape

MCP routes don't use the `/<prefix>/:instanceId` pattern — `McpAgent.serve()` takes `/tools` as the full prefix, and sessions live in the `Mcp-Session-Id` header (or the `sessionId` query param for SSE). One DO instance per session, created automatically.

### Detection limitation

Detection is source-level regex: the agent must literally say `extends McpAgent`. Import aliases (`import { McpAgent as M }`) aren't followed. Keep the import plain and you'll be fine.

See [`examples/mcp`](./examples/mcp) for a tool server with `echo` and `add`, plus a client that lists and calls them.

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
- [x] **v0.2** — middleware chain (Hono-style `c.next()`), typed `getAgent<T>()` RPC
- [x] **v0.3** — co-located `app.tsx` with generated typed `useAgent()` hook, `GeneratedEnv` type, path aliases
- [x] **v0.4** — `ayjnt new` bootstrap with two templates, MCP agent detection + dispatch
- [ ] **v0.5** — file-watch HMR in dev, docs site generator from READMEs, `create-ayjnt` npm package

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
