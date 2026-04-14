import { describe, expect, test } from "bun:test";
import {
  compose,
  createContext,
  type Context,
  type Middleware,
} from "./middleware.ts";

function dummyCtx(): Context<unknown> {
  return createContext({
    request: new Request("https://example.com/"),
    url: new URL("https://example.com/"),
    env: {},
    executionCtx: {} as ExecutionContext,
    params: { instanceId: "x", pathSuffix: "/" },
  });
}

describe("compose", () => {
  test("no middleware → finalize runs directly", async () => {
    const res = await compose([], dummyCtx(), async () =>
      new Response("final"),
    );
    expect(await res.text()).toBe("final");
  });

  test("single middleware calling next → finalize runs", async () => {
    const order: string[] = [];
    const mw: Middleware = async (_c, next) => {
      order.push("before");
      const r = await next();
      order.push("after");
      return r;
    };
    const res = await compose([mw], dummyCtx(), async () => {
      order.push("finalize");
      return new Response("ok");
    });
    expect(order).toEqual(["before", "finalize", "after"]);
    expect(await res.text()).toBe("ok");
  });

  test("chain runs outer → inner → outer", async () => {
    const order: string[] = [];
    const outer: Middleware = async (_c, next) => {
      order.push("outer-before");
      const r = await next();
      order.push("outer-after");
      return r;
    };
    const inner: Middleware = async (_c, next) => {
      order.push("inner-before");
      const r = await next();
      order.push("inner-after");
      return r;
    };
    await compose([outer, inner], dummyCtx(), async () => {
      order.push("final");
      return new Response();
    });
    expect(order).toEqual([
      "outer-before",
      "inner-before",
      "final",
      "inner-after",
      "outer-after",
    ]);
  });

  test("middleware short-circuits without calling next", async () => {
    const reached = { inner: false, final: false };
    const gate: Middleware = async () =>
      new Response("blocked", { status: 401 });
    const inner: Middleware = async (_c, next) => {
      reached.inner = true;
      return next();
    };
    const res = await compose([gate, inner], dummyCtx(), async () => {
      reached.final = true;
      return new Response("final");
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("blocked");
    expect(reached.inner).toBe(false);
    expect(reached.final).toBe(false);
  });

  test("middleware may rewrite the inner response", async () => {
    const mw: Middleware = async (_c, next) => {
      const r = await next();
      return new Response(await r.text() + "-wrapped", { status: r.status });
    };
    const res = await compose([mw], dummyCtx(), async () =>
      new Response("inner"),
    );
    expect(await res.text()).toBe("inner-wrapped");
  });

  test("calling next() twice throws", async () => {
    const mw: Middleware = async (_c, next) => {
      await next();
      await next();
      return new Response();
    };
    await expect(
      compose([mw], dummyCtx(), async () => new Response()),
    ).rejects.toThrow(/next\(\) called multiple times/);
  });
});

describe("createContext", () => {
  test("response helpers set correct content types", () => {
    const c = dummyCtx();
    const json = c.json({ a: 1 });
    expect(json.headers.get("content-type")).toMatch(/application\/json/);

    const text = c.text("hello");
    expect(text.headers.get("content-type")).toMatch(/text\/plain/);

    const html = c.html("<h1>hi</h1>");
    expect(html.headers.get("content-type")).toMatch(/text\/html/);
  });

  test("redirect defaults to 302 with location header", () => {
    const c = dummyCtx();
    const r = c.redirect("/login");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/login");
  });

  test("get/set shares state within a single context", () => {
    const c = dummyCtx();
    c.set("user", { id: 7 });
    expect(c.get<{ id: number }>("user")).toEqual({ id: 7 });
    expect(c.get("missing")).toBeUndefined();
  });

  test("get/set state is isolated between contexts", () => {
    const c1 = dummyCtx();
    const c2 = dummyCtx();
    c1.set("x", 1);
    expect(c2.get("x")).toBeUndefined();
  });
});
