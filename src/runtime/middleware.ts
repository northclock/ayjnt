// Hono-style middleware chain — v0.2
//
//   // agents/admin/middleware.ts
//   import type { Middleware } from "ayjnt/middleware";
//   export default (async (c, next) => {
//     if (!c.request.headers.get("authorization")) return c.text("unauthorized", 401);
//     await next();
//   }) satisfies Middleware;
//
// Middleware files compose root → leaf: a request to /admin/users runs
// agents/middleware.ts, then agents/admin/middleware.ts, then the agent.
export {};
