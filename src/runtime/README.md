# `src/runtime/` — public runtime API

What the user imports when they write `import { ... } from "ayjnt"`.

Kept intentionally thin. Most "framework" work lives in codegen; this module is the small surface of helpers user code calls directly.

## Exports

| Module | Import path | Status |
|---|---|---|
| [`index.ts`](./index.ts) | `"ayjnt"` | v0.1 — version constant only. Will re-export `Agent` and type helpers in v0.2. |
| [`rpc.ts`](./rpc.ts) | `"ayjnt/rpc"` | v0.2 — typed `getAgent(env, name, id)` proxy. |
| [`middleware.ts`](./middleware.ts) | `"ayjnt/middleware"` | v0.2 — Hono-style `Middleware`, `Context` types. |

## Design principles

**Single import source.** Users shouldn't have to remember whether `Agent` comes from `"agents"` or `"ayjnt"`. Everything the user needs to write agents, middleware, or UI should be importable from `"ayjnt"` or a subpath. Re-exporting is cheap.

**No runtime overhead.** Anything we expose here runs inside a worker request hot path. Helpers must be allocation-light and do no unnecessary work. When in doubt, push logic into build-time codegen.

**Typed everything.** User code should get IntelliSense for agent names, method signatures, and state shapes without casts. The codegen layer produces declaration files that make this work; the runtime just honors those types.

## Preview: v0.2 shape

### Middleware

```ts
// agents/admin/middleware.ts
import type { Middleware } from "ayjnt/middleware";

export default (async (c, next) => {
  if (!c.request.headers.get("authorization")) {
    return c.text("unauthorized", 401);
  }
  await next();
}) satisfies Middleware;
```

The `Context` object carries `request`, `env`, `params`, and `c.agent()` — a typed proxy to the agent being dispatched to.

### Inter-agent RPC

```ts
// inside agents/orders/agent.ts
import { getAgent } from "ayjnt/rpc";

const chat = getAgent(this.env, "chat", userId);
await chat.notify("your order shipped");   // fully typed from ChatAgent's methods
```

No HTTP, no network — `getAgent` is a direct DO stub with a typed proxy. Types come from a generated `.d.ts` the codegen pass emits alongside `entry.ts`.

## Adding a new runtime helper

1. Add a module under `src/runtime/`
2. Add an entry in [`../../package.json`](../../package.json)'s `exports` map
3. Document the import path here and in the top-level [`README.md`](../../README.md)
4. If the helper needs generated types, that's a codegen concern — design the generated shape first in [`../codegen/`](../codegen/) and have the runtime consume it

Rule of thumb: if it's "magic" (behaves like a normal function but is wired to something Cloudflare-specific behind the scenes), that wiring happens at build time in codegen, and the runtime surface stays boring.
