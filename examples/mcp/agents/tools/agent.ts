import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { invocations: number };

/**
 * An MCP agent exposing two toy tools: `echo` (return the input) and `add`
 * (sum two numbers). Any MCP client — Claude desktop, the `@modelcontextprotocol/sdk`
 * TypeScript client, or `curl` with the right JSON-RPC envelope — can connect.
 *
 * ayjnt detects that this class extends McpAgent (by source-level name match)
 * and routes `/tools` to `Tools.serve("/tools", { binding: "TOOLS" }).fetch(...)`
 * instead of the normal Agent dispatch. The MCP handler takes care of
 * streamable-http / SSE transport, session management, and DO routing.
 */
export default class Tools extends McpAgent<GeneratedEnv, State> {
  override initialState: State = { invocations: 0 };

  server = new McpServer({
    name: "ayjnt-example-tools",
    version: "0.1.0",
  });

  async init() {
    this.server.tool(
      "echo",
      "Echo back whatever you send.",
      { text: z.string() },
      async ({ text }) => {
        this.setState({ invocations: this.state.invocations + 1 });
        return { content: [{ type: "text", text }] };
      },
    );

    this.server.tool(
      "add",
      "Add two numbers and return the sum.",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => {
        this.setState({ invocations: this.state.invocations + 1 });
        return {
          content: [{ type: "text", text: String(a + b) }],
        };
      },
    );
  }
}
