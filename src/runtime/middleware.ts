// Hono-style middleware chain.
//
// User code imports only the types:
//
//   // agents/admin/middleware.ts
//   import type { Middleware } from "ayjnt/middleware";
//   export default (async (c, next) => {
//     if (!c.request.headers.get("authorization")) {
//       return c.text("unauthorized", 401);
//     }
//     await next();
//   }) satisfies Middleware;
//
// Like Hono, a middleware that calls `next()` without returning anything
// passes the inner response through unchanged. Returning a Response —
// before or after `await next()` — overrides it.
//
// The generated worker entrypoint imports `compose` and `createContext` to
// actually run the chain for each request. Both live here so the generated
// code has a single import source: `from "ayjnt/middleware"`.

export type Next = () => Promise<Response>;

/**
 * What a middleware function sees on every request. Typed on `Env` — pass
 * your own env shape (DO bindings + anything else wrangler exposes) for
 * autocomplete on `c.env.*`.
 */
export type Context<Env = unknown> = {
  /** The original incoming request, as the client sent it. */
  readonly request: Request;
  /** Parsed URL of the original request. */
  readonly url: URL;
  /** Worker env — DO bindings plus whatever else you declared. */
  readonly env: Env;
  /** Cloudflare execution context (waitUntil, passThroughOnException). */
  readonly executionCtx: ExecutionContext;
  /** Path segments extracted by the route matcher. */
  readonly params: {
    /** The DO instance id — the first segment after the route prefix.
     *  `/chat/room-42` → `"room-42"`. */
    instanceId: string;
    /** Everything after the instance id. `/` for the common case. */
    pathSuffix: string;
  };

  /** JSON response. Second arg may be a status number (Hono parity) or a
   *  full ResponseInit. */
  json(body: unknown, init?: number | ResponseInit): Response;
  /** Plain text response (content-type set for you). */
  text(body: string, init?: number | ResponseInit): Response;
  /** HTML response (content-type set for you). */
  html(body: string, init?: number | ResponseInit): Response;
  /** Redirect response (default 302). */
  redirect(location: string, status?: number): Response;

  /** Stash a value for a later middleware or the agent handler to read.
   *  Keyspace is per-request; values don't leak across requests. */
  set(key: string, value: unknown): void;
  /** Read a value stashed by an earlier middleware. Untyped by default —
   *  narrow with the generic if you know what's there. */
  get<T = unknown>(key: string): T | undefined;
};

/**
 * Middleware signature. Return a Response to short-circuit; call `next()`
 * to continue the chain. Returning nothing after `await next()` passes the
 * inner response through (Hono semantics); returning a Response overrides it.
 */
export type Middleware<Env = unknown> = (
  c: Context<Env>,
  next: Next,
) => Promise<Response | void> | Response | void;

/** Build a Context. Called by generated entry.ts — user code won't call this directly. */
export function createContext<Env>(init: {
  request: Request;
  url: URL;
  env: Env;
  executionCtx: ExecutionContext;
  params: Context<Env>["params"];
}): Context<Env> {
  const store = new Map<string, unknown>();
  return {
    request: init.request,
    url: init.url,
    env: init.env,
    executionCtx: init.executionCtx,
    params: init.params,
    json: (body, init) => Response.json(body, toInit(init)),
    text: (body, init) =>
      new Response(body, withContentType("text/plain; charset=utf-8", init)),
    html: (body, init) =>
      new Response(body, withContentType("text/html; charset=utf-8", init)),
    redirect: (location, status = 302) =>
      new Response(null, { status, headers: { location } }),
    set: (key, value) => {
      store.set(key, value);
    },
    get: <T>(key: string) => store.get(key) as T | undefined,
  };
}

/** Normalize the Hono-style `status | ResponseInit` shorthand. */
function toInit(
  v: number | ResponseInit | undefined,
): ResponseInit | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return { status: v };
  return v;
}

/**
 * Merge a default content-type into a ResponseInit without losing the
 * caller's headers. `HeadersInit` can be a plain record, a Headers
 * instance, or a tuple array — the Headers constructor normalizes all
 * three, where an object spread would silently drop the latter two.
 * A caller-supplied content-type wins over the default.
 */
function withContentType(
  contentType: string,
  init: number | ResponseInit | undefined,
): ResponseInit {
  const ri = toInit(init);
  // The cast bridges the ambient lib mismatch (workers-types' HeadersInit
  // is wider than Bun's) — every runtime value ResponseInit permits is
  // accepted by the Headers constructor in both environments.
  const headers = new Headers(
    ri?.headers as ConstructorParameters<typeof Headers>[0],
  );
  if (!headers.has("content-type")) headers.set("content-type", contentType);
  return { ...ri, headers };
}

/**
 * Compose a middleware chain, Hono-style. Each layer receives the context
 * and a `next` callable that dispatches to layer i+1. When the last layer
 * calls `next()`, `finalize` runs and its response bubbles back up through
 * any post-next logic.
 *
 * A layer may return a Response (which wins), or call `next()` and return
 * nothing (the inner response passes through). A layer that does neither
 * is a bug — we throw a descriptive error instead of letting `undefined`
 * escape to the Workers runtime as an opaque "did not return a Response".
 *
 * Throws if a single middleware calls `next()` more than once — that's
 * always a bug.
 */
export async function compose<Env>(
  stack: Middleware<Env>[],
  ctx: Context<Env>,
  finalize: () => Promise<Response>,
): Promise<Response> {
  let index = -1;
  const dispatch = async (i: number): Promise<Response> => {
    if (i <= index) {
      throw new Error("next() called multiple times in a middleware");
    }
    index = i;
    if (i === stack.length) return finalize();

    // Remember the response produced by the inner chain so a middleware
    // that `await next()`s without returning still passes it through.
    let inner: Response | undefined;
    let nextCalled = false;
    const next: Next = async () => {
      nextCalled = true;
      inner = await dispatch(i + 1);
      return inner;
    };

    const out = await stack[i]!(ctx, next);
    if (out instanceof Response) return out;
    if (inner !== undefined) return inner;
    // Distinguish the two ways to land here so the error points at the
    // actual mistake: next() fired but its promise was dropped, vs next()
    // never invoked at all.
    throw new Error(
      nextCalled
        ? `ayjnt: middleware[${i}] called next() without awaiting it and returned ${
            out === undefined ? "nothing" : typeof out
          } — use \`await next()\` or \`return next()\``
        : `ayjnt: middleware[${i}] returned ${
            out === undefined ? "nothing" : typeof out
          } and never called next() — return a Response or call next()`,
    );
  };
  return dispatch(0);
}
