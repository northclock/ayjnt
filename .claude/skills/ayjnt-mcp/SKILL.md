---
name: ayjnt-mcp
description: Build an MCP (Model Context Protocol) agent — an agent that exposes tools, prompts, or resources for LLM clients like Claude Desktop, Codex, or the @modelcontextprotocol/sdk TypeScript client. Use when the user asks to "build an MCP server", "expose tools to an LLM", "extend McpAgent", "register MCP tools", or "connect Claude Desktop to my agent". Generates `agents/<route>/agent.ts` that extends `McpAgent`, instantiates `McpServer`, and registers tools/resources/prompts via the SDK's helpers. Skips the normal `/<route>/<instance>` URL dispatch — McpAgent.serve() owns the transport.
---

# Build an MCP agent

`extends McpAgent` flips the framework into MCP mode: the URL prefix
becomes the **MCP endpoint** (Streamable HTTP + SSE), session management
lives in the `Mcp-Session-Id` header, and there's no client-facing
instance segment. One DO instance per MCP session, created automatically.

## File shape

```ts
// agents/<route>/agent.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { /* per-session state, if any */ };

export default class MyServer extends McpAgent<GeneratedEnv, State> {
  override initialState: State = { /* … */ };

  server = new McpServer({
    name: "my-server",
    version: "0.1.0",
  });

  async init() {
    this.server.tool(
      "tool_name",
      "What this tool does.",
      { someArg: z.string() },
      async ({ someArg }) => ({
        content: [{ type: "text", text: `result for ${someArg}` }],
      }),
    );
  }
}
```

### Rules

- **Default-export the class.** Same convention as regular agents.
- **`extends McpAgent` from `agents/mcp`.** ayjnt detects the base
  class by source-level string match — `extends McpAgent`. Aliased
  imports (`import { McpAgent as M }`) aren't followed; keep the import
  plain.
- **`server = new McpServer({...})`** is a public field, instantiated
  at class-definition time. The MCP SDK uses this instance.
- **Register tools in `init()`**, not the constructor — `init()` is the
  framework's lifecycle hook that runs once per DO instance.
- **Tool args are validated with Zod schemas.** Pass the shape object
  directly; the SDK runs validation before your handler.

## Tool registration

```ts
this.server.tool(
  name: string,
  description: string,
  inputSchema: ZodRawShape,
  handler: (args, extra) => Promise<CallToolResult>,
);
```

The handler returns `{ content: ContentBlock[] }`. Content blocks can be:

- `{ type: "text", text: "..." }` — plain text the model sees.
- `{ type: "image", data: "base64...", mimeType: "image/png" }` — binary.
- `{ type: "resource", resource: { uri, mimeType, text } }` — inline resource.

Throw exceptions for tool-side failures — the SDK converts them to MCP
errors and the client sees a proper error response.

## Persisted state per session

`this.state` and `this.setState({...})` work the same as a regular
agent — each MCP session has its own DO instance with isolated state.
Useful for tracking invocation counts, cached fetches, or session
context across tool calls.

## URL shape (different from regular agents)

```
http://localhost:8787/<route>
```

That's it. No instance segment in the URL — sessions are tracked via
the `Mcp-Session-Id` header (Streamable HTTP) or the `sessionId` query
param (SSE).

When you connect Claude Desktop, paste this URL into your
`mcpServers` config:

```json
{
  "mcpServers": {
    "my-server": {
      "url": "http://localhost:8787/<route>"
    }
  }
}
```

For deployed agents, use the workers.dev URL or your custom domain.

## Resources and prompts (less common)

Beyond `tool`, the McpServer also supports:

```ts
this.server.resource(name, uri, metadata, async () => ({
  contents: [{ uri, mimeType: "text/plain", text: "..." }],
}));

this.server.prompt(name, description, schema, async (args) => ({
  messages: [{ role: "user", content: { type: "text", text: "..." } }],
}));
```

These are MCP primitives the host can list (`resources/list`,
`prompts/list`). Most servers only register tools; reach for resources
and prompts when your domain genuinely fits them.

## Curl-level inspection

```sh
# What tools does the server expose?
curl -X POST http://localhost:8787/<route> \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool directly
curl -X POST http://localhost:8787/<route> \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tool_name","arguments":{"someArg":"foo"}}}'
```

The `accept: application/json, text/event-stream` header is required —
Streamable HTTP transport.

## Middleware still runs

`agents/middleware.ts` and any subtree middleware run BEFORE the MCP
dispatch — auth, logging, rate-limiting all apply. The middleware
chain sees the raw HTTP request; `c.params.instanceId` is empty for
MCP agents (the MCP transport handles sessions itself).

## Reference

- [Model Context Protocol spec](https://modelcontextprotocol.io/).
