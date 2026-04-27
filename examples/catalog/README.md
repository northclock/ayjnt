# ayjnt example: catalog

Demonstrates two related v0.6 features:

1. **`/__ayjnt/catalog`** — a built-in JSON endpoint the framework
   exposes that lists every agent the caller has access to (filtered
   by middleware), along with each agent's `@callable` RPC surface and
   docs URL.
2. **`docs.md`** — drop a markdown file next to `agent.ts` and it gets
   served at `/<route>/docs`.

The `catalog` agent ships a React UI that reads the catalog endpoint
live and renders it as a tree.

## Layout

```
agents/
  users/
    agent.ts       ← UsersAgent with 3 @callable methods
    docs.md        ← served at /users/docs
  orders/
    agent.ts       ← OrdersAgent with 2 @callable methods (no docs.md)
  admin/
    middleware.ts  ← bearer-token gate
    reports/
      agent.ts     ← ReportsAgent — hidden from catalog without auth
      docs.md      ← /admin/reports/docs (also gated)
  catalog/
    agent.ts       ← bare host
    app.tsx        ← React UI fetching /__ayjnt/catalog
    docs.md        ← /catalog/docs
```

## Run it

```sh
bun install
bun run dev
# open http://localhost:8787/catalog/me
```

You'll see a tree of every accessible agent — `users`, `orders`,
`catalog` itself. Type `letmein` into the bearer-token field and
`admin/reports` appears too.

## Try it from curl

```sh
# anonymous — admin/reports hidden
curl http://localhost:8787/__ayjnt/catalog | jq

# with bearer token — admin/reports included
curl -H 'authorization: Bearer letmein' \
  http://localhost:8787/__ayjnt/catalog | jq

# fetch the markdown docs for an agent
curl http://localhost:8787/users/docs

# admin-gated docs
curl -H 'authorization: Bearer letmein' \
  http://localhost:8787/admin/reports/docs
```

## How the catalog filters by access

`/__ayjnt/catalog` runs every agent's middleware chain against the
incoming request and includes the agent only if the chain calls
`next()` to completion (or returns a 2xx). A 4xx/5xx short-circuit
hides the agent.

That's why pasting the bearer token unlocks `/admin/reports`:
`agents/admin/middleware.ts` returns `403` on missing auth, so the
catalog drops every agent under `/admin` for unauthenticated callers.

## How docs.md works

`ayjnt build` reads each `docs.md` and embeds the markdown as a string
literal inside the generated worker. Requests to `<routePath>/docs`
return `text/markdown` with the contents. The same middleware chain
that gates the agent gates the docs — `GET /admin/reports/docs`
without auth is `403`, same as the agent itself.

## Restrictions

- `docs` is a reserved instance name. You cannot create a Durable
  Object instance named `docs` — `/<route>/docs` is always the docs
  route. Names like `docs-prod` or `docs1` are fine.
- `@callable` is opt-in. Methods without the JSDoc tag remain private
  to the class; they don't appear in the catalog.
- `@callable` is parsed source-level: the JSDoc must immediately
  precede the method, the parameter list must fit on one line, and
  the return-type annotation must not contain a top-level `{`. These
  match the line-based extractor in `src/codegen/scan.ts`.

## See also

- [`examples/inter-agent`](../inter-agent) — typed RPC between two
  agents (the consumer side of `@callable`).
- [Main README — Agent catalog & docs.md](../../README.md#agent-catalog-and-docsmd).
