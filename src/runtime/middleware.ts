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
 * to continue the chain. Any return value after `await next()` overrides
 * the response the inner chain produced.
 */
export type Middleware<Env = unknown> = (
  c: Context<Env>,
  next: Next,
) => Promise<Response> | Response;

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
    text: (body, init) => {
      const ri = toInit(init);
      return new Response(body, {
        ...ri,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...(ri?.headers as Record<string, string> | undefined),
        },
      });
    },
    html: (body, init) => {
      const ri = toInit(init);
      return new Response(body, {
        ...ri,
        headers: {
          "content-type": "text/html; charset=utf-8",
          ...(ri?.headers as Record<string, string> | undefined),
        },
      });
    },
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
 * Compose a middleware chain, Hono-style. Each layer receives the context
 * and a `next` callable that dispatches to layer i+1. When the last layer
 * (or a layer that doesn't return early) calls `next()`, `finalize` runs
 * and its response bubbles back up through any post-next logic.
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
    return await stack[i]!(ctx, () => dispatch(i + 1));
  };
  return dispatch(0);
}
