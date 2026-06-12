import { describe, expect, test } from "bun:test";
import type { Middleware } from "./middleware.ts";
import {
  buildCatalog,
  isHtmlRequest,
  matchRoute,
  type AgentRoute,
} from "./router.ts";

function route(overrides: Partial<AgentRoute>): AgentRoute {
  const prefix = overrides.prefix ?? "/chat";
  return {
    prefix,
    binding: "CHAT_AGENT",
    middleware: [],
    isMcp: false,
    assetFlat: null,
    docs: null,
    callables: [],
    meta: {
      agentId: prefix.slice(1).replace(/\//g, "_") || "chat",
      className: "ChatAgent",
      routePath: prefix,
      hasApp: false,
      hasDocs: false,
      isMcp: false,
    },
    ...overrides,
  };
}

const ctx = {} as ExecutionContext;

describe("matchRoute", () => {
  test("bare route falls back to the default instance", () => {
    const m = matchRoute([route({})], "/chat");
    expect(m).toMatchObject({ kind: "agent", instanceId: "default", rest: "/" });
  });

  test("trailing slash also resolves to the default instance", () => {
    const m = matchRoute([route({})], "/chat/");
    expect(m).toMatchObject({ kind: "agent", instanceId: "default" });
  });

  test("explicit instance and rest path", () => {
    const m = matchRoute([route({})], "/chat/room-42/messages/recent");
    expect(m).toMatchObject({
      kind: "agent",
      instanceId: "room-42",
      rest: "/messages/recent",
    });
  });

  test("longest prefix wins when the table is ordered longest-first", () => {
    const users = route({ prefix: "/admin/users", binding: "USERS" });
    const admin = route({ prefix: "/admin", binding: "ADMIN" });
    const m = matchRoute([users, admin], "/admin/users/bob");
    expect(m).toMatchObject({ kind: "agent", instanceId: "bob" });
    expect((m as { route: AgentRoute }).route.binding).toBe("USERS");
  });

  test("unknown path returns null", () => {
    expect(matchRoute([route({})], "/nope")).toBeNull();
  });

  test("prefix match cannot bleed across segment boundaries", () => {
    // /chatter must NOT match the /chat route.
    expect(matchRoute([route({})], "/chatter/x")).toBeNull();
  });

  test("percent-encoded segments match decoded route prefixes", () => {
    const cafe = route({ prefix: "/café", binding: "CAFE" });
    expect(matchRoute([cafe], "/caf%C3%A9/table-1")).toMatchObject({
      kind: "agent",
      instanceId: "table-1",
    });
    expect(matchRoute([route({})], "/chat/room%2042")).toMatchObject({
      instanceId: "room 42",
    });
  });

  test("an encoded slash cannot fabricate a deeper prefix match", () => {
    const users = route({ prefix: "/admin/users", binding: "USERS" });
    // "%2F" decodes to "/" inside ONE segment — it must not match the
    // two-segment prefix /admin/users.
    expect(matchRoute([users], "/admin%2Fusers/bob")).toBeNull();
  });

  test("malformed percent escapes are tolerated, not thrown", () => {
    expect(matchRoute([route({})], "/chat/%zz")).toMatchObject({
      instanceId: "%zz",
    });
  });

  test("docs segment is a docs match at exactly one depth", () => {
    const m = matchRoute([route({})], "/chat/docs");
    expect(m).toMatchObject({ kind: "docs" });
  });

  test("paths below the reserved docs segment are 404, not an instance named docs", () => {
    expect(matchRoute([route({})], "/chat/docs/anything")).toBeNull();
  });

  test("MCP routes match without an instance scheme, keeping the full pathSuffix", () => {
    const m = matchRoute([route({ isMcp: true })], "/chat/whatever/deep");
    // rest carries the real remaining path so middleware on MCP routes sees
    // the true pathSuffix (e.g. /sse vs /mcp), matching pre-extraction
    // behavior.
    expect(m).toMatchObject({
      kind: "agent",
      instanceId: "",
      rest: "/whatever/deep",
    });
    expect(matchRoute([route({ isMcp: true })], "/chat")).toMatchObject({
      rest: "/",
    });
  });

  test("root prefix matches everything as a catch-all", () => {
    const root = route({ prefix: "/", binding: "ROOT" });
    expect(matchRoute([root], "/")).toMatchObject({ instanceId: "default" });
    expect(matchRoute([root], "/room-1")).toMatchObject({ instanceId: "room-1" });
  });
});

describe("buildCatalog", () => {
  const get = (headers: Record<string, string> = {}) =>
    new Request("https://example.com/__ayjnt/catalog", { headers });

  test("routes without middleware are always visible", async () => {
    const out = await buildCatalog([route({})], get(), {}, ctx);
    expect(out.agents).toHaveLength(1);
    expect(out.agents[0]).toMatchObject({ routePath: "/chat" });
  });

  test("REGRESSION: a root middleware that calls next() must not hide agents", async () => {
    // This is the original bug: the probe sentinel used `new Response(null,
    // { status: 999 })`, which throws RangeError, so ANY route with
    // middleware vanished from the catalog the moment a root middleware.ts
    // existed.
    const passThrough: Middleware = async (_c, next) => next();
    const routes = [
      route({ middleware: [passThrough] }),
      route({ prefix: "/admin", binding: "ADMIN", middleware: [passThrough] }),
    ];
    const out = await buildCatalog(routes, get(), {}, ctx);
    expect(out.agents.map((a) => a.routePath)).toEqual(["/chat", "/admin"]);
  });

  test("Hono-style middleware (await next, no return) keeps agents visible", async () => {
    const hono: Middleware = async (_c, next) => {
      await next();
    };
    const out = await buildCatalog([route({ middleware: [hono] })], get(), {}, ctx);
    expect(out.agents).toHaveLength(1);
  });

  test("auth middleware hides gated agents from anonymous callers", async () => {
    const auth: Middleware = async (c, next) => {
      if (c.request.headers.get("authorization") !== "Bearer s3cret") {
        return c.text("forbidden", 403);
      }
      return next();
    };
    const routes = [
      route({}),
      route({ prefix: "/admin", binding: "ADMIN", middleware: [auth] }),
    ];

    const anon = await buildCatalog(routes, get(), {}, ctx);
    expect(anon.agents.map((a) => a.routePath)).toEqual(["/chat"]);

    const authed = await buildCatalog(
      routes,
      get({ authorization: "Bearer s3cret" }),
      {},
      ctx,
    );
    expect(authed.agents.map((a) => a.routePath)).toEqual(["/chat", "/admin"]);
  });

  test("middleware answering 2xx directly (without next) counts as accessible", async () => {
    const direct: Middleware = async (c) => c.text("ok");
    const out = await buildCatalog([route({ middleware: [direct] })], get(), {}, ctx);
    expect(out.agents).toHaveLength(1);
  });

  test("a non-2xx override AFTER next() hides the agent (post-next gate)", async () => {
    // The catalog contract: any non-2xx from middleware hides the agent.
    // A gate that inspects the inner response before denying must count —
    // judging "did the chain reach the end" instead would leak the gated
    // agent's callables and docs URL to every caller.
    const postGate: Middleware = async (c, next) => {
      await next();
      return c.text("forbidden", 403);
    };
    const out = await buildCatalog([route({ middleware: [postGate] })], get(), {}, ctx);
    expect(out.agents).toHaveLength(0);
  });

  test("wrapping middleware that preserves a 2xx status stays visible", async () => {
    const wrap: Middleware = async (_c, next) => {
      const res = await next();
      const headers = new Headers(res.headers);
      headers.set("x-wrapped", "1");
      return new Response(res.body, { status: res.status, headers });
    };
    const out = await buildCatalog([route({ middleware: [wrap] })], get(), {}, ctx);
    expect(out.agents).toHaveLength(1);
  });

  test("throwing middleware fails closed", async () => {
    const boom: Middleware = async () => {
      throw new Error("boom");
    };
    const out = await buildCatalog([route({ middleware: [boom] })], get(), {}, ctx);
    expect(out.agents).toHaveLength(0);
  });

  test("probes run against a body-less request marked with x-ayjnt-probe", async () => {
    let sawProbeHeader = false;
    let bodyWasNull = false;
    const inspect: Middleware = async (c, next) => {
      sawProbeHeader = c.request.headers.get("x-ayjnt-probe") === "catalog";
      bodyWasNull = c.request.body === null;
      return next();
    };
    // Even a POST with a body must not leak that one-shot body into the
    // parallel probes.
    const original = new Request("https://example.com/__ayjnt/catalog", {
      method: "POST",
      body: "secret-payload",
    });
    const out = await buildCatalog([route({ middleware: [inspect] })], original, {}, ctx);
    expect(out.agents).toHaveLength(1);
    expect(sawProbeHeader).toBe(true);
    expect(bodyWasNull).toBe(true);
    expect(original.bodyUsed).toBe(false);
  });

  test("docsUrl is exposed only when the agent has docs", async () => {
    const withDocs = route({
      prefix: "/inv",
      binding: "INV",
      docs: "# Inv",
      meta: {
        agentId: "inv",
        className: "Inv",
        routePath: "/inv",
        hasApp: false,
        hasDocs: true,
        isMcp: false,
      },
    });
    const out = await buildCatalog([withDocs, route({})], get(), {}, ctx);
    expect(out.agents[0]?.docsUrl).toBe("/inv/docs");
    expect(out.agents[1]?.docsUrl).toBeNull();
  });
});

describe("isHtmlRequest", () => {
  const req = (init: RequestInit & { accept?: string } = {}) =>
    new Request("https://example.com/chat", {
      method: init.method ?? "GET",
      headers: { ...(init.accept ? { accept: init.accept } : {}), ...((init.headers as Record<string, string>) ?? {}) },
    });

  test("GET with Accept: text/html is an HTML request", () => {
    expect(isHtmlRequest(req({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
  });

  test("POST is never an HTML request", () => {
    expect(isHtmlRequest(req({ method: "POST", accept: "text/html" }))).toBe(false);
  });

  test("WebSocket upgrade wins over Accept", () => {
    expect(
      isHtmlRequest(
        req({ accept: "text/html", headers: { upgrade: "WebSocket" } }),
      ),
    ).toBe(false);
  });

  test("curl-style request without Accept is not HTML", () => {
    expect(isHtmlRequest(req())).toBe(false);
  });
});
