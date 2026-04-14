// Minimal client using the Cloudflare Agents SDK over HTTP.
//
// Key point: we pass `basePath` to bypass the SDK's default
// "/agents/<kebab-agent>/<name>" URL construction. Our worker exposes
// agents at "/<route>/<instanceId>" instead, and the SDK happily connects
// there when `basePath` is set.
//
// Run with the dev server up (bun run dev in another terminal):
//   HOST=http://localhost:8787 bun run client

import { agentFetch } from "agents/client";

const host = process.env.HOST ?? "http://localhost:8787";
const roomId = process.env.ROOM ?? "demo-room";

// Send a message to ChatAgent instance "demo-room".
const post = await agentFetch(
  {
    agent: "ChatAgent", // ignored when basePath is set, but the SDK still requires it
    basePath: `chat/${roomId}`,
    host,
  },
  {
    method: "POST",
    body: JSON.stringify({ text: "hello from the client" }),
  },
);
console.log("POST ->", post.status, await post.json());

// Read the agent's state back. The `name` field in the response comes from
// `this.name` on the DO, which getAgentByName set server-side — proof that
// the identity wiring works end-to-end.
const get = await agentFetch({
  agent: "ChatAgent",
  basePath: `chat/${roomId}`,
  host,
});
console.log("GET  ->", get.status, await get.json());
