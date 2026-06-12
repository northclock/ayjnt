// browserTools binding validation. The whole point of the eager checks is
// error QUALITY: a missing binding must fail at construction with the fix
// in the message, not as an opaque fetch failure inside the first tool run.
//
// "agents/browser/ai" transitively imports cloudflare:* built-ins that
// don't resolve outside workerd, so it's module-mocked and browser.ts is
// imported dynamically afterwards.

import { describe, expect, mock, test } from "bun:test";

mock.module("agents/browser/ai", () => ({
  createBrowserTools: (opts: unknown) => ({ __tools: true, opts }),
}));

const { browserTools } = await import("./browser.ts");

describe("browserTools", () => {
  test("missing LOADER fails with the regenerate hint", () => {
    expect(() => browserTools({ env: {} } as object)).toThrow(
      /env\.LOADER is not bound/,
    );
  });

  test("missing BROWSER without a cdpUrl override fails at construction", () => {
    expect(() => browserTools({ env: { LOADER: {} } } as object)).toThrow(
      /env\.BROWSER is not bound/,
    );
  });

  test("cdpUrl override stands in for the BROWSER binding", () => {
    const tools = browserTools({ env: { LOADER: {} } } as object, {
      cdpUrl: "http://localhost:9222",
    });
    expect(tools).toMatchObject({ __tools: true });
  });

  test("both bindings present → tools created with them", () => {
    const tools = browserTools(
      { env: { LOADER: { l: 1 }, BROWSER: { b: 1 } } } as object,
    ) as unknown as { opts: Record<string, unknown> };
    expect(tools.opts["loader"]).toEqual({ l: 1 });
    expect(tools.opts["browser"]).toEqual({ b: 1 });
  });
});
