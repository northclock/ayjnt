// MCP client demonstration — connects to our local worker and calls the
// `add` tool. Run `bun run dev` in another terminal first.
//
// Uses streamable-http transport (MCP's modern default). The URL is the
// same route ayjnt registered for the agent — /tools. The SDK handles the
// JSON-RPC envelope and session establishment.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const host = process.env.HOST ?? "http://localhost:8787";

const transport = new StreamableHTTPClientTransport(new URL(host + "/tools"));
const client = new Client({ name: "ayjnt-mcp-client", version: "0.1.0" });
await client.connect(transport);

console.log("1) list tools");
const tools = await client.listTools();
console.log(tools.tools.map((t) => ({ name: t.name, description: t.description })));

console.log("\n2) call echo");
const echoed = await client.callTool({
  name: "echo",
  arguments: { text: "hello from ayjnt" },
});
console.log(echoed);

console.log("\n3) call add (7 + 35)");
const summed = await client.callTool({
  name: "add",
  arguments: { a: 7, b: 35 },
});
console.log(summed);

await client.close();
