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

  test("await next() without return passes the inner response through (Hono semantics)", async () => {
    const mw: Middleware = async (_c, next) => {
      await next();
    };
    const res = await compose([mw], dummyCtx(), async () =>
      new Response("inner", { status: 201 }),
    );
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("inner");
  });

  test("pass-through works at every depth of the chain", async () => {
    const passThrough: Middleware = async (_c, next) => {
      await next();
    };
    const res = await compose(
      [passThrough, passThrough, passThrough],
      dummyCtx(),
      async () => new Response("deep"),
    );
    expect(await res.text()).toBe("deep");
  });

  test("returning a Response after next() still overrides the inner one", async () => {
    const mw: Middleware = async (_c, next) => {
      await next();
      return new Response("override");
    };
    const res = await compose([mw], dummyCtx(), async () =>
      new Response("inner"),
    );
    expect(await res.text()).toBe("override");
  });

  test("middleware that neither returns nor calls next() throws a descriptive error", async () => {
    const broken: Middleware = async () => {
      // forgot to return a Response or call next()
    };
    await expect(
      compose([broken], dummyCtx(), async () => new Response()),
    ).rejects.toThrow(/middleware\[0\] returned nothing and never called next\(\)/);
  });

  test("un-awaited next() gets its own diagnostic, not 'never called next()'", async () => {
    const dropped: Middleware = (_c, next) => {
      void next(); // fired but the promise is dropped
    };
    await expect(
      compose([dropped], dummyCtx(), async () => new Response()),
    ).rejects.toThrow(/called next\(\) without awaiting it/);
  });

  test("errors thrown by a middleware propagate to the caller", async () => {
    const thrower: Middleware = async () => {
      throw new Error("boom");
    };
    await expect(
      compose([thrower], dummyCtx(), async () => new Response()),
    ).rejects.toThrow("boom");
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

  test("custom headers survive in every HeadersInit form", () => {
    const c = dummyCtx();

    // plain record
    const a = c.text("x", { headers: { "x-custom": "1" } });
    expect(a.headers.get("x-custom")).toBe("1");
    expect(a.headers.get("content-type")).toMatch(/text\/plain/);

    // Headers instance — spread-merging would silently drop these
    const b = c.text("x", {
      status: 401,
      headers: new Headers({ "www-authenticate": "Bearer" }),
    });
    expect(b.status).toBe(401);
    expect(b.headers.get("www-authenticate")).toBe("Bearer");
    expect(b.headers.get("content-type")).toMatch(/text\/plain/);

    // tuple array
    const d = c.html("x", { headers: [["x-arr", "2"]] });
    expect(d.headers.get("x-arr")).toBe("2");
    expect(d.headers.get("0")).toBeNull();
    expect(d.headers.get("content-type")).toMatch(/text\/html/);
  });

  test("caller-supplied content-type overrides the default", () => {
    const c = dummyCtx();
    const r = c.text("x", { headers: { "content-type": "text/csv" } });
    expect(r.headers.get("content-type")).toBe("text/csv");
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
