// getAgent forwards to the SDK's getAgentByName through a double cast —
// exactly the construct where a dropped argument is invisible to tsc, so
// the passthrough (namespace, name, AND options) is pinned here.
//
// "agents" imports cloudflare:* built-ins that don't resolve outside
// workerd, so it's module-mocked and rpc.ts imported dynamically.

import { describe, expect, mock, test } from "bun:test";

const calls: unknown[][] = [];
mock.module("agents", () => ({
  getAgentByName: (...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({ __stub: true });
  },
}));

const { getAgent } = await import("./rpc.ts");

describe("getAgent", () => {
  test("forwards namespace, name, and options verbatim", async () => {
    const ns = { __namespace: true } as unknown as DurableObjectNamespace<undefined>;
    const options = { jurisdiction: "eu", locationHint: "weur" };

    const stub = await getAgent(ns, "room-42", options as never);
    expect(stub).toEqual({ __stub: true } as never);
    expect(calls.at(-1)).toEqual([ns, "room-42", options]);
  });

  test("options stays optional", async () => {
    const ns = {} as DurableObjectNamespace<undefined>;
    await getAgent(ns, "main");
    expect(calls.at(-1)).toEqual([ns, "main", undefined]);
  });
});
