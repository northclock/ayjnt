---
name: ayjnt-middleware
description: Add middleware to gate, log, or wrap responses for an ayjnt agent or a subtree of agents. Use when the user asks to "add middleware", "add auth", "rate limit", "log every request", "gate the admin subtree", or "wrap responses". Drops `middleware.ts` at the right folder level (root for everything, a sub-folder for a subtree, a `(group)/` for a non-URL-scoped grouping), uses the Hono-style `Context` + `next()` pattern, and confirms the chain order matches what the user expects.
---

# Add middleware

Every `middleware.ts` from the project root down to an agent folder
forms a chain that runs in root → leaf order — like Next.js
`layout.tsx`. Each middleware can short-circuit (return early) or pass
through (call `next()` and optionally wrap the response).

## Where to put it

| Goal | Drop `middleware.ts` here |
|---|---|
| Run for every agent | `agents/middleware.ts` |
| Run for `/admin/*` only | `agents/admin/middleware.ts` |
| Share between agents that DON'T share a URL prefix | `agents/(group-name)/middleware.ts` |
| Run for one specific agent only | `agents/<route>/middleware.ts` |

Route groups (`(parens)`) are stripped from URLs but still contribute
to the chain — that's how you scope middleware to a logical group
without affecting URL shape.

## The shape

```ts
// agents/.../middleware.ts
import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  // 1. Before next() — early checks
  if (!c.request.headers.get("authorization")) {
    return c.text("unauthorized", 401);
  }

  // 2. Stash anything downstream code needs
  c.set("userId", "...");

  // 3. Pass control to the next middleware (or the agent)
  const response = await next();

  // 4. After next() — wrap / inspect the response
  response.headers.set("x-served-by", "agent");
  return response;
};

export default middleware;
```

### Rules

- **Default-export the function**, typed `satisfies Middleware` (or
  inferred from the variable's type). The framework picks it up by
  default export.
- **Call `next()` exactly once.** Calling it twice throws — the
  framework catches the double-dispatch.
- **Return a `Response` to short-circuit.** Any non-2xx response from
  middleware hides the agent from `/__ayjnt/catalog` for that caller
  — auth-gate middleware → invisible admin agents for anonymous users.
- **Catalog probes are marked.** `/__ayjnt/catalog` probes every agent's
  chain with a body-less GET carrying `x-ayjnt-probe: catalog`. Rate-limit
  or audit middleware that shouldn't count phantom requests can check that
  header (or `c.url.pathname === "/__ayjnt/catalog"`) and skip the side
  effect while still gating.
- **`await next()` without a return is fine** (Hono semantics — the inner
  response passes through). Returning a `Response` after `await next()`
  overrides it.
- **Mutate response headers AFTER `await next()`** if you need to
  observe the agent's response. Doing it before runs against an
  unborrowed Response.

## What's on `c` (the Context)

| Field | Type | What |
|---|---|---|
| `c.request` | `Request` | Original incoming request. |
| `c.url` | `URL` | Parsed `request.url`. |
| `c.env` | `Env` (generic) | Worker env — DO bindings plus whatever else. |
| `c.executionCtx` | `ExecutionContext` | `waitUntil`, `passThroughOnException`. |
| `c.params.instanceId` | `string` | First path segment after the agent route. `"default"` when omitted. |
| `c.params.pathSuffix` | `string` | Everything after the instance id. `/` for the common case. |
| `c.json(body, init?)` | helper | JSON response. |
| `c.text(body, init?)` | helper | `text/plain` response. |
| `c.html(body, init?)` | helper | `text/html` response. |
| `c.redirect(loc, status?)` | helper | 302 (default) redirect. |
| `c.set(key, value)` | helper | Stash for downstream middleware. |
| `c.get<T>(key)` | helper | Read a stash. Untyped without generic. |

## Typed `env` on the Context

The `Middleware` type is generic over `Env`. Plug in your own shape
when you need autocomplete on `c.env.*`:

```ts
import type { Middleware } from "ayjnt/middleware";
import type { GeneratedEnv } from "@ayjnt/env";

type Env = GeneratedEnv & { KV: KVNamespace; AUTH_SECRET: string };

const middleware = (async (c, next) => {
  const stored = await c.env.KV.get(c.params.instanceId);    // typed
  // ...
}) satisfies Middleware<Env>;

export default middleware;
```

## Common patterns

### Bearer-token gate

```ts
const middleware: Middleware = async (c, next) => {
  if (c.request.headers.get("authorization") !== "Bearer letmein") {
    return c.text("forbidden", 403);
  }
  return next();
};
```

### Request logging + timing (root middleware)

```ts
const middleware: Middleware = async (c, next) => {
  const t = Date.now();
  const res = await next();
  console.log(`${c.request.method} ${c.url.pathname} → ${res.status} (${Date.now() - t}ms)`);
  res.headers.set("x-response-time-ms", String(Date.now() - t));
  return res;
};
```

### Rate limit with KV

```ts
type Env = GeneratedEnv & { RATE_LIMIT: KVNamespace };

const middleware = (async (c, next) => {
  const key = `rate:${c.request.headers.get("cf-connecting-ip")}`;
  const count = Number(await c.env.RATE_LIMIT.get(key)) || 0;
  if (count > 60) return c.text("too many requests", 429);
  await c.env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 60 });
  return next();
}) satisfies Middleware<Env>;
```

## Chain ordering

`agents/admin/users/agent.ts` runs through:

```
agents/middleware.ts          # root — runs first
agents/admin/middleware.ts    # subtree — runs second
agents/admin/users/agent.ts   # the handler
```

If the root middleware returns early, the admin one never runs.
Order matters: place broad concerns (logging) at the root, narrow
concerns (auth) closer to the leaf.

## Interaction with `/<route>/docs` and `/__ayjnt/catalog`

- **Docs are gated.** `/<route>/docs` runs through the agent's full
  middleware chain. An admin gate hides the docs the same way it
  hides the agent.
- **Catalog filtering is fail-closed.** `/__ayjnt/catalog` runs each
  agent's middleware against the request and includes the agent only
  if the chain calls `next()` to completion (or returns 2xx).
  Anonymous callers see only the open agents; passing the bearer
  token unlocks the admin section.

## Reference

See the generated middleware tests in
[`src/codegen`](../../../src/codegen) for complete routing cases.
