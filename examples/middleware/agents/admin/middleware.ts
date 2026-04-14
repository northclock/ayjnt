// Admin subtree middleware — runs AFTER the root middleware for any agent
// under agents/admin/. Gates the subtree on a bearer token.
//
// Root → leaf ordering means c.request has already been logged by the time
// this runs, and a 401 here still gets the root's x-response-time-ms header
// (since the root middleware wraps the response after next() returns).

import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  const auth = c.request.headers.get("authorization");
  if (auth !== "Bearer letmein") {
    return c.text("forbidden", 403);
  }
  // Stash a value for the agent or downstream middleware to read.
  c.set("authenticated", true);
  return next();
};

export default middleware;
