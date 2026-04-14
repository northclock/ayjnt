# ayjnt example: middleware

Demonstrates the file-based middleware chain — root → leaf composition, route groups, and short-circuiting.

## Layout

```
agents/
  middleware.ts                  ← root: log + x-response-time-ms header
  public/
    status/
      agent.ts                   → /public/status/:id  (no auth)
  admin/
    middleware.ts                ← gate: require Bearer token
    users/
      agent.ts                   → /admin/users/:id    (auth required)
```

## How the chain resolves

For each incoming request, ayjnt walks from the project root down to the agent folder, collecting every `middleware.ts` it encounters. They run in outer → inner order, Hono-style:

| Request | Chain order |
|---|---|
| `/public/status/:id` | `agents/middleware.ts` → agent |
| `/admin/users/:id` | `agents/middleware.ts` → `agents/admin/middleware.ts` → agent |

Each middleware receives a typed `Context` (request, url, env, params) plus a `next` callable. Call `next()` to continue; return a `Response` early to short-circuit. Any logic after `await next()` runs on the way back out — good for wrapping the inner response (as the root middleware does here to add the timing header).

## Run it

```sh
bun install
bun run dev               # terminal 1
HOST=http://localhost:8787 bun run client   # terminal 2
```

Expected output shape:

```
1) public route, no auth:
{ status: 200, timeMs: "3", body: '{"instance":"demo","pings":1,...}' }

2) admin route, no auth → 403:
{ status: 403, timeMs: "1", body: "forbidden" }

3) admin route, bearer auth → 200:
{ status: 200, timeMs: "5", body: '{"instance":"bob","visits":1,...}' }
```

The `x-response-time-ms` header on the 403 response proves the root middleware still ran (the admin gate short-circuits without reaching the agent, but the root wraps both cases).

## Gotcha: writing middleware that wraps responses

A middleware that transforms the inner response needs to read `res.body` as a stream — it can't be consumed twice. The pattern here:

```ts
const res = await next();
const headers = new Headers(res.headers);
headers.set("x-custom", value);
return new Response(res.body, {    // ← stream passes through
  status: res.status,
  statusText: res.statusText,
  headers,
});
```

Don't `await res.text()` unless you intend to replace the body — doing so consumes the stream and the client sees an empty response.

## Gotcha: route groups for shared middleware without shared URL prefix

If you want a middleware to apply to a set of agents without nesting them under a shared URL segment, use a route group:

```
agents/
  (authenticated)/
    middleware.ts
    account/
      agent.ts         → /account/:id   (route group stripped from URL)
    billing/
      agent.ts         → /billing/:id
```

Folders wrapped in parens disappear from the route path but still contribute to the middleware chain.

## Stashing data between middleware and agents

`c.set(key, value)` and `c.get<T>(key)` share state within a single request. The admin middleware in this example sets `authenticated: true`, but note that agents (running inside a Durable Object) don't see the context — the stash only flows between middleware running in the worker entry. To pass data into the agent, set a request header before calling `next()` or put it in the request body.

## See also

- [Main README — Middleware chain](../../README.md#middleware-chain) for the framework-wide story
- [`src/runtime/README.md`](../../src/runtime/README.md) for the `Context` / `Middleware` type reference
- [`examples/basic`](../basic), [`examples/with-client`](../with-client) for simpler setups
