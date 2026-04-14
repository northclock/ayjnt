# `src/runtime/` — public runtime API

What the user imports when they write `import { ... } from "ayjnt"` or any of its subpaths. Kept intentionally thin — most "framework" work lives in codegen; this module is the small surface of helpers user code calls directly.

## Import paths

| Import | From | What you get |
|---|---|---|
| `Agent`, `getAgent` | `"ayjnt"` | Main entry. Re-exports `Agent` from the Cloudflare SDK plus the `getAgent` helper. |
| `Middleware`, `Context`, `Next` | `"ayjnt/middleware"` | Types for user-authored `middleware.ts` files. |
| `getAgent` | `"ayjnt/rpc"` | The same typed inter-agent stub, available separately for when you only need RPC. |

The generated worker entry imports `compose` and `createContext` from `"ayjnt/middleware"` too — those are framework-internal but live in the same module so generated code has a single import source.

## Middleware

```ts
// agents/admin/middleware.ts
import type { Middleware } from "ayjnt/middleware";

type MyEnv = {
  CHAT_AGENT: DurableObjectNamespace<ChatAgent>;
  KV: KVNamespace;
};

export default (async (c, next) => {
  if (!c.request.headers.get("authorization")) {
    return c.text("unauthorized", 401);
  }
  c.set("user", { id: 7 });               // stash for downstream middleware
  const res = await next();
  res.headers.set("x-custom", "value");   // wrap the inner response
  return res;
}) satisfies Middleware<MyEnv>;
```

### `Context<Env>`

| Field | Description |
|---|---|
| `request` | The original incoming `Request`. Don't mutate — create a new one if you need to. |
| `url` | Parsed `URL` of `request`. |
| `env` | The worker's env bindings. Typed to `Env` via the generic. |
| `executionCtx` | Cloudflare's `ExecutionContext` (`waitUntil`, `passThroughOnException`). |
| `params.instanceId` | First path segment after the route prefix. For `/chat/room-42` → `"room-42"`. |
| `params.pathSuffix` | Remaining path after the instance id. `"/"` when the URL was just `/chat/:id`. |
| `json(body, status?)` | JSON response. Second arg may be a status number (Hono parity) or a full `ResponseInit`. |
| `text(body, status?)` | Plain text. `content-type` set for you. |
| `html(body, status?)` | HTML. `content-type` set for you. |
| `redirect(location, status?)` | Default 302. |
| `set(key, value)` | Per-request stash, visible only to downstream middleware in the same request. |
| `get<T>(key)` | Read a stashed value. Narrow with the generic if you know the type. |

### `Middleware<Env>`

```ts
type Middleware<Env = unknown> = (
  c: Context<Env>,
  next: () => Promise<Response>,
) => Promise<Response> | Response;
```

Return a `Response` to short-circuit. Call `next()` to continue. Any code after `await next()` runs on the way back out — that's how you wrap the inner response (add headers, trim body, etc).

### Gotchas

- **Wrapping the body.** If you want to modify the inner response without replacing the body, pass `res.body` through unread:

  ```ts
  const res = await next();
  const headers = new Headers(res.headers);
  headers.set("x-response-time-ms", "5");
  return new Response(res.body, { status: res.status, headers });
  ```

  `await res.text()` consumes the stream — doing that and then returning a new Response leaves the client with an empty body.

- **Middleware doesn't see the agent.** `c.set("user", ...)` is visible to *other middleware in the same request*, not to the agent itself. Agents run inside a Durable Object, which is a separate context from the worker entry where middleware runs. To pass data into the agent, either set a request header before `next()` or include it in the request body.

- **Calling `next()` twice throws.** That's always a bug — either you meant to short-circuit (don't call next) or you meant to wrap (call once, do work with the result).

## Inter-agent RPC

```ts
import { getAgent } from "ayjnt/rpc";

const chat = await getAgent<ChatAgent>(this.env.CHAT_AGENT, userId);
await chat.sendMessage("hello");   // fully typed from ChatAgent's methods
```

### `getAgent<T>(namespace, name)`

```ts
function getAgent<T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
  name: string,
): Promise<DurableObjectStub<T>>;
```

Wraps Cloudflare's `getAgentByName`. The generic parameter is the target agent class; inference flows through the namespace and the returned stub exposes every public method on `T`, plus `.fetch(request)` for HTTP-over-DO calls.

### Why the generic is first (not `Env`)

The SDK's own `getAgentByName` has this signature:

```ts
function getAgentByName<Env, T extends Agent<Env>, Props>(
  namespace: DurableObjectNamespace<T>,
  name: string,
  options?: { props?: Props; ... },
): DurableObjectStub<T>;
```

Explicit type args force you to thread `Env` through:

```ts
// awkward — have to specify or default Env even though the namespace already knows it
await getAgentByName<any, ChatAgent>(env.CHAT_AGENT, id);
```

`ayjnt/rpc` flips that so the common case reads cleanly:

```ts
await getAgent<ChatAgent>(env.CHAT_AGENT, id);
```

### Gotchas

- **Method call = network trip.** Every `await stub.method(...)` round-trips to the target DO. Cheap but not free. Don't tight-loop; batch where you can.
- **Args must survive structured clone.** Plain data only. No functions. Serialize `Date`, `Map`, `Set`, `Error` subclasses yourself. See [Cloudflare's RPC lifecycle docs](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/).
- **Errors cross the RPC boundary unchanged** — and that's the thing that bites. If `InventoryAgent.decrement` throws `insufficient stock`, `await inv.decrement(...)` re-throws the same error in the caller. If the caller's `onRequest` doesn't catch it, the worker returns a plain-text 500 stack trace, *not* a JSON response. An external client doing `res.json()` on that response crashes with "Failed to parse JSON" — and the original error message is now invisible upstream.

  The fix is routine but easy to forget:

  ```ts
  try {
    const remaining = await inv.decrement(sku, qty);
    // happy path
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 409 });
  }
  ```

  Translate domain exceptions to structured responses at every HTTP boundary you cross. The same discipline you'd apply to an HTTP client applies to an RPC caller.

- **Declare the binding type.** The caller agent's `Env` needs `INVENTORY_AGENT: DurableObjectNamespace<InventoryAgent>` or you lose inference. v0.3 will generate this; for now it's a one-liner per agent.
- **`getAgent` sets `this.name` on the callee.** Same reason as `routeAgentRequest` / our worker entry — so the DO's identity is correct for any code (including client-facing identity messages) that keys off it.
- **DO state is persistent across runs.** Re-running a test script doesn't reset storage; that's a feature in production and a trap in development. For reproducible demos, expose a reset endpoint on the callee and call it from your client. To nuke all local state, `rm -rf .wrangler` and restart `ayjnt dev`.

## Version pin

```ts
export const VERSION = "0.1.0";   // re-exported from runtime/index.ts
```

Bumped alongside the package version. Useful for client code that wants to sanity-check which runtime it's linked against.

## Adding a new runtime helper

1. Add a module under `src/runtime/`.
2. Add an entry in [`../../package.json`](../../package.json)'s `exports` map if it should be importable as a subpath.
3. Re-export from [`./index.ts`](./index.ts) if it belongs in the default `"ayjnt"` surface.
4. Document the import path and signature in this README. Include gotchas — the kind of thing that would surprise a fresh reader.
5. If the helper needs generated types (like v0.3's typed `useAgent`), design the generated shape in [`../codegen/`](../codegen/) first, then have the runtime consume what codegen produces.

Rule of thumb: if the helper is "magic" (behaves like a normal function but wires through Cloudflare-specific plumbing), that wiring happens in codegen at build time and the runtime stays boring.
