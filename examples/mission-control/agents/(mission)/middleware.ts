// Shared middleware for all four crew agents. Route group (parens) keeps it
// out of the URL — requests still reach /commander/:id, /navigator/:id,
// /scout/:id, /engineer/:id, but every one of them runs through this.
//
// In a real system this would do auth — only the mission operator can talk
// to the crew. Here we demonstrate:
//   1. logging with a shared request id
//   2. a mission-id validation check (mission ids are the DO instance id)

import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  const missionId = c.params.instanceId;

  // Toy validation: mission ids must be a short alphanumeric string
  // (a-z, 0-9, dash). Keeps the demo easy to follow in logs.
  if (!/^[a-z0-9-]{1,40}$/.test(missionId)) {
    return c.json(
      { error: "invalid mission id", missionId },
      400,
    );
  }

  c.set("reqId", reqId);
  console.log(`[${reqId}] ${c.request.method} ${c.url.pathname}`);

  const res = await next();

  // Add the request id + mission id to every response so the UI can
  // correlate what it sees in the network tab to what the server logged.
  const headers = new Headers(res.headers);
  headers.set("x-mission-request-id", reqId);
  headers.set("x-mission-id", missionId);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};

export default middleware;
