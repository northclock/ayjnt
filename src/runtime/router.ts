// Worker-side routing runtime, imported by the generated `.ayjnt/dist/entry.ts`.
//
// Everything here used to live inline in the generated entry's template
// string, where it could never be unit-tested — which is how the catalog
// probe shipped with a sentinel (`new Response(null, { status: 999 })`)
// that throws RangeError and silently hid every middleware-guarded agent.
// The generated entry is now a thin table of routes; the logic lives here,
// under tests.
//
// The generated entry imports ONLY from "ayjnt/router" (compose/createContext
// are re-exported below), so generated code has a single framework import.

import {
  compose,
  createContext,
  type Context,
  type Middleware,
} from "./middleware.ts";
import type { CallableMethod } from "../core/types.ts";

export { compose, createContext };
export type { CallableMethod, Context, Middleware };

/** Reserved path that returns the agent catalog as JSON, filtered by which
 *  agents the caller can pass each agent's middleware chain. Lives under the
 *  `/__ayjnt/` namespace so it can never collide with a user route. */
export const CATALOG_PATH = "/__ayjnt/catalog";

/** Reserved leaf segment served instead of an instance dispatch.
 *  `/<route>/docs` returns the agent's docs.md. The trade-off is that users
 *  can't name a DO instance `docs` — documented restriction. Anything
 *  *below* the docs segment (`/<route>/docs/x`) is a 404, so the
 *  reservation holds at every depth. */
export const DOCS_SEGMENT = "docs";

/** Instance name used when the URL has no instance segment — `/<route>` and
 *  `/<route>/` both resolve to this. Mirrors the client-side `useAgent`
 *  hook (see deriveInstance in src/codegen/client.ts), so the bundled UI
 *  ends up talking to the same Durable Object the worker dispatches to. */
export const DEFAULT_INSTANCE = "default";

/** Catalog record describing one agent. Echoed by /__ayjnt/catalog. */
export type CatalogMeta = {
  agentId: string;
  className: string;
  routePath: string;
  hasApp: boolean;
  hasDocs: boolean;
  isMcp: boolean;
};

/** One row of the generated route table. */
export type AgentRoute = {
  /** URL prefix, e.g. "/admin/users". */
  prefix: string;
  /** DO binding name on `env`, e.g. "ADMIN_USERS_AGENT". */
  binding: string;
  /** Middleware chain, root → leaf. */
  middleware: Middleware<any>[];
  /** True when the agent class extends McpAgent. MCP agents dispatch via
   *  the static `.serve()` handler instead of a direct DO fetch. */
  isMcp: boolean;
  /** Flat route segment for the assets tree, e.g. "admin_users". Null when
   *  the agent has no co-located app.tsx. */
  assetFlat: string | null;
  /** Inline contents of the agent's docs.md, or null when none exists.
   *  An empty docs.md is `""` — still served. */
  docs: string | null;
  /** Methods on the agent class flagged with `@callable`. Echoed in the catalog. */
  callables: CallableMethod[];
  /** Self-describing record returned by /__ayjnt/catalog. */
  meta: CatalogMeta;
};

export type RouteMatch =
  | {
      kind: "agent";
      route: AgentRoute;
      /** Percent-decoded instance id, ready for `getAgentByName`. */
      instanceId: string;
      /** Path after the instance segment, forwarded to the agent. Raw
       *  (still percent-encoded) so the agent sees what the client sent. */
      rest: string;
    }
  | { kind: "docs"; route: AgentRoute };

/**
 * Match a pathname against the route table. The table must be ordered
 * longest-prefix-first (the codegen sorts it) so `/admin/users` wins over
 * `/admin` when both exist.
 *
 * Matching is segment-wise on percent-DECODED segments, so an agent folder
 * named `café` matches both `/café` and `/caf%C3%A9`. Decoding happens per
 * segment — an encoded `%2F` can never fabricate a path separator and
 * spoof a longer prefix.
 */
export function matchRoute(
  routes: readonly AgentRoute[],
  pathname: string,
): RouteMatch | null {
  const rawSegments = pathname.split("/").filter(Boolean);
  const segments = rawSegments.map(decodeSegment);

  for (const route of routes) {
    const prefixSegments =
      route.prefix === "/" ? [] : route.prefix.slice(1).split("/");
    if (!startsWithSegments(segments, prefixSegments)) continue;

    const remainder = segments.slice(prefixSegments.length);
    const rawRemainder = rawSegments.slice(prefixSegments.length);

    // `<route>/docs` (exactly) → docs request. It runs the same middleware
    // chain as the agent, so auth gates docs too. Deeper paths under the
    // reserved segment are 404s, not an instance named "docs".
    if (remainder[0] === DOCS_SEGMENT) {
      return remainder.length === 1 ? { kind: "docs", route } : null;
    }

    // MCP agents don't use our instanceId scheme — the MCP transport
    // manages sessions internally via headers, and the dispatcher forwards
    // the original request verbatim. `rest` still carries the full path
    // after the prefix so middleware sees the real pathSuffix.
    if (route.isMcp) {
      return {
        kind: "agent",
        route,
        instanceId: "",
        rest: "/" + rawRemainder.join("/"),
      };
    }

    // No instance segment? Default to "default". `/counter` and
    // `/counter/` both resolve to the same DO as `/counter/default`,
    // matching what the bundled `useAgent()` hook derives client-side.
    return {
      kind: "agent",
      route,
      instanceId: remainder[0] ?? DEFAULT_INSTANCE,
      rest: "/" + rawRemainder.slice(1).join("/"),
    };
  }
  return null;
}

/**
 * Build the agent catalog by probing every route's middleware chain. A
 * route appears in the result when its middleware either calls `next()`
 * to completion OR returns a 2xx response — both indicate the caller has
 * access. Any 3xx/4xx/5xx short-circuit (or a thrown error) hides the
 * agent: fail closed.
 *
 * Probes share the caller's headers, so one `Authorization` header that
 * unlocks /admin/* unlocks every admin agent in a single round. They run
 * against a single body-less GET request — never the original request —
 * so parallel probes can't race over a one-shot body stream. Middleware
 * can recognize a probe (and skip rate-limiting / audit side effects) by
 * the `x-ayjnt-probe: catalog` header or by `c.url.pathname` being the
 * catalog path.
 */
export async function buildCatalog(
  routes: readonly AgentRoute[],
  request: Request,
  env: unknown,
  executionCtx: ExecutionContext,
): Promise<{
  version: 1;
  agents: (CatalogMeta & {
    callables: CallableMethod[];
    docsUrl: string | null;
  })[];
}> {
  const probeHeaders = new Headers(request.headers);
  probeHeaders.set("x-ayjnt-probe", "catalog");
  const probeRequest = new Request(request.url, {
    method: "GET",
    headers: probeHeaders,
  });
  const probeUrl = new URL(probeRequest.url);

  const visible = await Promise.all(
    routes.map(async (route) => {
      try {
        if (route.middleware.length > 0) {
          // The sentinel stands in for the agent: a 204 that survives the
          // chain (returned, passed through Hono-style, or wrapped while
          // keeping a 2xx status) marks the route accessible. Judging the
          // FINAL response — not "did the chain reach the end" — keeps
          // post-next gates honest: middleware that calls next() and then
          // overrides with a 403 hides the agent, exactly as the
          // documented catalog contract says.
          const sentinel = async (): Promise<Response> =>
            new Response(null, { status: 204 });
          const c = createContext({
            request: probeRequest,
            url: probeUrl,
            env,
            executionCtx,
            params: { instanceId: "", pathSuffix: "/" },
          });
          const res = await compose(route.middleware, c, sentinel);
          if (res.status < 200 || res.status >= 300) return null;
        }
        return {
          ...route.meta,
          callables: route.callables,
          docsUrl: route.meta.hasDocs
            ? `${route.meta.routePath}/${DOCS_SEGMENT}`
            : null,
        };
      } catch {
        // Middleware that throws is treated as inaccessible — fail closed.
        return null;
      }
    }),
  );

  return {
    version: 1,
    agents: visible.filter((a) => a !== null),
  };
}

/**
 * True when the client wants HTML (browser navigation), not a WebSocket
 * upgrade or HTTP API call. Used to pick HTML vs agent dispatch for the
 * same URL. Order of checks matters: `Upgrade: websocket` wins over
 * `Accept: text/html` even if both are set (some clients do).
 */
export function isHtmlRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return false;
  }
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

/** Percent-decode one path segment, tolerating malformed escapes (`%zz`
 *  stays raw rather than throwing). */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function startsWithSegments(
  segments: readonly string[],
  prefix: readonly string[],
): boolean {
  if (prefix.length > segments.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (segments[i] !== prefix[i]) return false;
  }
  return true;
}
