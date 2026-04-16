# examples

Reference projects that exercise the framework end-to-end. Each is a standalone Bun project with `ayjnt` linked via `file:../..`, so local changes to the framework are immediately reflected.

Every example assumes you start from the blank scaffold:

```sh
bunx ayjnt new my-app          # blank starter — one "I'm alive" agent
bunx ayjnt new my-app --with-ui  # same, plus React preinstalled
```

You then delete the starter agent (`agents/alive` or `agents/counter`) and drop in the example's agents.

## Gallery

| Example | Status | What it demonstrates |
|---|---|---|
| [`basic`](./basic) | v0.1 | One `ChatAgent` with state, no UI, no middleware. Smallest useful project beyond the blank scaffold. |
| [`with-client`](./with-client) | v0.1 | Connecting from the Agents client SDK using `basePath`. Explains the `path` vs `basePath` gotcha and the server-side `getAgentByName` requirement. |
| [`middleware`](./middleware) | v0.2 | Layered `middleware.ts` chain, route groups, short-circuiting vs wrapping, `c.set` / `c.get` per-request stash. |
| [`inter-agent`](./inter-agent) | v0.2 | Two agents calling each other via `getAgent<T>()` typed RPC, with oversell protection showing exception propagation. |
| [`with-ui`](./with-ui) | v0.3 | Co-located `app.tsx`, generated typed `useAgent()` hook, multi-tab live state sync. |
| [`mcp`](./mcp) | v0.4 | Tool server extending `McpAgent`, auto-routed through `McpAgent.serve()`. Client demo calls `echo` and `add`. |
| [`scheduled-tasks`](./scheduled-tasks) | v0.4 | `this.schedule()` for one-shot deferred work — relative delays, absolute times, persistent state across restarts. |
| [`recurring-tasks`](./recurring-tasks) | v0.4 | `this.scheduleEvery()` heartbeat with a live bar-chart UI. Proper cleanup pattern (cancel before re-scheduling). |
| [`chat-rooms`](./chat-rooms) | v0.4 | Multi-user realtime chat with presence + typing indicators. Demonstrates state sync vs `broadcast()` trade-off. |
| [`ai-chatbot`](./ai-chatbot) | v0.4 | Streaming chatbot backed by Gemini. `ctx.waitUntil` + `setState` per chunk gives realtime UI without SSE plumbing. |
| [`agentic-rag`](./agentic-rag) | v0.4 | Two-agent RAG pipeline. Planner → retriever (via typed RPC) → composer. Workers AI embeddings + llama via HTTP. |
| [`space-game`](./space-game) | v0.4 | Multiplayer asteroid shooter. 30Hz physics loop on a DO, authoritative server + dumb clients, canvas render. |
| [`chess`](./chess) | v0.4 | Two-player chess with server-side move validation + turn enforcement. Spectators welcome. |
| [`mission-control`](./mission-control) | v0.4 | Four-agent collaborative system. Commander orchestrates navigator / scout / engineer via typed RPC every 2s; each crew role has its own UI. |

## Running an example

```sh
cd examples/<name>
bun install
bun run dev          # requires `wrangler login`
```

Some examples need extra setup (`.dev.vars` for API keys, or a second terminal for `bun run client`) — see each example's README.

## Adding a new example

1. `mkdir examples/<name>` and `cd examples/<name>`
2. `bun init -y`
3. In `package.json`:
   - `"dependencies"`: `"agents": "*"` (plus anything domain-specific)
   - `"devDependencies"`: `"ayjnt": "file:../.."`, `"wrangler": "^4"`, `"@cloudflare/workers-types": "latest"`
   - `"scripts"`: `"dev"`, `"build"`, `"deploy"`, `"migrate"` each calling `ayjnt`
4. `bun install`
5. Write `agents/<name>/agent.ts`
6. Add a `README.md` that starts from the blank scaffold (`bunx ayjnt new my-app`), explains what files to add/replace, walks through the code, and ends with a "what it looks like" section
7. Add a `.gitignore` covering `node_modules`, `.ayjnt/dist`, `.ayjnt/manifest.json`, `.wrangler`, `.env*`, `.dev.vars`
8. Add an entry to the table above
9. Add a matching entry to `docs/src/content/examples.ts` with `steps: [SCAFFOLD_BLANK|SCAFFOLD_WITH_UI, …, { screenshot: { content: "…" }}, deployStep(…)]`
