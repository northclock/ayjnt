// Admin gate — anything under agents/admin requires a bearer token.
//
// The catalog endpoint at /__ayjnt/catalog hides routes whose middleware
// chain short-circuits with a non-2xx response. This middleware is the
// reason `/admin/reports` only appears in the catalog when the caller
// passes `Authorization: Bearer letmein`.

import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  if (c.request.headers.get("authorization") !== "Bearer letmein") {
    return c.text("forbidden", 403);
  }
  return next();
};

export default middleware;
