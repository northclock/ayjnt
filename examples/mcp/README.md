# ayjnt example: mcp

An MCP (Model Context Protocol) agent — tools an LLM can call. ayjnt detects that the class extends `McpAgent` and routes the request through `McpAgent.serve()` instead of the normal Agent dispatch, so the MCP transport layer (streamable-http / SSE / session management) is handled for you.

## Layout

```
agents/
  tools/
    agent.ts        ← export default class Tools extends McpAgent
```

The class registers tools via `McpServer.tool(name, desc, schema, handler)`. ayjnt makes the endpoint available at `/tools`.

## Run it

```sh
bun install
bun run dev                                    # terminal 1
HOST=http://localhost:8787 bun run client      # terminal 2
```

> **Install note.** This example's install tree is heavy (MCP SDK + zod + transitive deps). If `bun install` stalls, hit Ctrl-C, run `rm -rf node_modules bun.lock`, and retry — the second attempt usually completes in seconds because the bun cache is warm. `bun install --ignore-scripts` also helps if a postinstall hook is the culprit.

Expected:

```
1) list tools
[
  { name: 'echo', description: 'Echo back whatever you send.' },
  { name: 'add',  description: 'Add two numbers and return the sum.' }
]

2) call echo
{ content: [ { type: 'text', text: 'hello from ayjnt' } ] }

3) call add (7 + 35)
{ content: [ { type: 'text', text: '42' } ] }
```

## Connecting from Claude desktop / other MCP clients

With the agent deployed, point any MCP client at your worker's URL:

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "ayjnt-tools": {
      "url": "https://your-worker.workers.dev/tools"
    }
  }
}
```

The transport is streamable-http by default; clients that only support SSE should use `/tools/sse` — McpAgent's `.serve()` handler serves both from the same path prefix.

## How ayjnt's MCP dispatch works

In the generated `.ayjnt/dist/entry.ts`:

```ts
const CLASSES = { TOOLS: Tools };   // binding → class reference

// in the route table:
{ prefix: "/tools", binding: "TOOLS", middleware: [], isMcp: true }

// in fetch, when match.isMcp is true:
const ClassRef = CLASSES[match.binding];
const handler = ClassRef.serve("/tools", { binding: match.binding });
return handler.fetch(request, env, executionCtx);
```

This is the pattern Cloudflare's own MCP examples use, just generated for you. You never have to wire `.serve()` calls or worry about getting the `binding` argument right.

Middleware still runs for MCP routes — if you put a `middleware.ts` in `agents/` or `agents/tools/`, it executes before the MCP handler. Useful for auth, logging, or rate limiting the tool calls.

## Gotcha: McpAgent detection is source-level

```ts
import { McpAgent } from "agents/mcp";
export default class Tools extends McpAgent { ... }   // ✓ detected

import { McpAgent as M } from "agents/mcp";
export default class Tools extends M { ... }           // ✗ NOT detected — treated as a regular Agent
```

The scanner is a regex, not a type-aware resolver, so the base class is matched by exact name. If you need to alias the import, dispatch will go to `stub.fetch` like a normal agent and MCP protocol messages won't be handled correctly.

To work around, don't alias. Or declare an intermediate class:

```ts
import { McpAgent as M } from "agents/mcp";
abstract class BaseTools extends M {}
export default class Tools extends BaseTools { ... }   // still ✗ — baseClass is "BaseTools"
```

Best to just write `import { McpAgent } from "agents/mcp"` plainly.

## Gotcha: no instanceId in the URL

Unlike normal agents (`/chat/:id` where `:id` becomes the DO instance), MCP routes are `/tools` with no instance segment. The MCP SDK manages sessions via the `Mcp-Session-Id` header (streamable-http) or the `sessionId` query param (SSE), and one DO instance is created per session.

This means:

- You can't hand-pick the DO instance by URL segment like you would for a chat agent.
- Different clients get different DO instances automatically — sessions are isolated.
- If you need a shared DO across sessions (e.g. a global counter across all tool calls), store it in KV or another DO and have the MCP tool handler fetch it.

## See also

- [Main README — MCP agents](../../README.md#mcp-agents)
- [Cloudflare's MCP docs](https://developers.cloudflare.com/agents/model-context-protocol/) for deeper protocol details
- [`examples/basic`](../basic) for the non-MCP agent pattern
