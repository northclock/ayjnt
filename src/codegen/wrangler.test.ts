import { describe, expect, test } from "bun:test";
import type { AgentEntry, Manifest, MigrationLockfile } from "../core/types.ts";
import {
  DEFAULT_COMPATIBILITY_DATE,
  deriveWorkerName,
  generateWrangler,
} from "./wrangler.ts";

function mf(agents: AgentEntry[]): Manifest {
  return { root: "/fake", agents };
}

function agent(overrides: Partial<AgentEntry>): AgentEntry {
  return {
    agentId: "chat",
    className: "ChatAgent",
    baseClass: "Agent",
    folderPath: "chat",
    routePath: "/chat",
    binding: "CHAT_AGENT",
    sourceFile: "/fake/agents/chat/agent.ts",
    hasApp: false,
    hasDocs: false,
    callables: [],
    middlewareChain: [],
    ...overrides,
  };
}

function parse(s: string): Record<string, unknown> {
  // strip leading comment line
  const body = s.replace(/^\/\/[^\n]*\n/, "");
  return JSON.parse(body);
}

describe("generateWrangler", () => {
  const lockfile: MigrationLockfile = {
    version: 1,
    migrations: [
      {
        tag: "v1",
        timestamp: "2026-04-14T00:00:00Z",
        new_sqlite_classes: ["ChatAgent"],
      },
    ],
    classes: { chat: { agentId: "chat", className: "ChatAgent", firstTag: "v1" } },
  };

  test("single agent emits binding + migration", () => {
    const out = generateWrangler(mf([agent({})]), lockfile, {
      name: "my-app",
      compatibilityDate: "2026-04-14",
    });
    const cfg = parse(out);
    expect(cfg["name"]).toBe("my-app");
    expect(cfg["main"]).toBe("./entry.ts");
    expect(cfg["compatibility_date"]).toBe("2026-04-14");
    expect(cfg["compatibility_flags"]).toEqual(["nodejs_compat"]);
    expect(cfg["durable_objects"]).toEqual({
      bindings: [{ name: "CHAT_AGENT", class_name: "ChatAgent" }],
    });
    expect(cfg["migrations"]).toEqual([
      {
        tag: "v1",
        timestamp: "2026-04-14T00:00:00Z",
        new_sqlite_classes: ["ChatAgent"],
      },
    ]);
  });

  test("no duplicate nodejs_compat when user adds it", () => {
    const out = generateWrangler(mf([agent({})]), lockfile, {
      name: "x",
      compatibilityFlags: ["nodejs_compat", "streams_enable_constructors"],
    });
    const cfg = parse(out);
    expect(cfg["compatibility_flags"]).toEqual([
      "nodejs_compat",
      "streams_enable_constructors",
    ]);
  });

  test("compatibility_date defaults to the pinned constant, not today's date", () => {
    // Pinned (not clock-derived) so identical sources always produce
    // identical wrangler.jsonc, and so generated dates never outrun
    // the workerd binary that ships with the framework's wrangler dep.
    const out = generateWrangler(mf([agent({})]), lockfile, { name: "app" });
    const cfg = parse(out);
    expect(cfg["compatibility_date"]).toBe(DEFAULT_COMPATIBILITY_DATE);
    // Sanity: the constant itself looks like a YYYY-MM-DD.
    expect(DEFAULT_COMPATIBILITY_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("rejects invalid worker name", () => {
    expect(() =>
      generateWrangler(mf([]), lockfile, { name: "Not Valid!" }),
    ).toThrow(/Invalid worker name/);
  });

  test("extras fields do not clobber generated fields", () => {
    const out = generateWrangler(mf([agent({})]), lockfile, {
      name: "app",
      extras: { vars: { FOO: "bar" }, name: "should-be-ignored" },
    });
    const cfg = parse(out);
    expect(cfg["vars"]).toEqual({ FOO: "bar" });
    expect(cfg["name"]).toBe("app"); // generated fields override extras
  });

  test("empty manifest still produces valid config", () => {
    const out = generateWrangler(mf([]), lockfile, { name: "app" });
    const cfg = parse(out);
    expect((cfg["durable_objects"] as any).bindings).toEqual([]);
  });

  test("hasApps false: no assets config emitted", () => {
    const out = generateWrangler(mf([agent({})]), lockfile, {
      name: "app",
      hasApps: false,
    });
    const cfg = parse(out);
    expect(cfg["assets"]).toBeUndefined();
  });

  test("hasApps true: assets config emitted pointing at ../assets", () => {
    const out = generateWrangler(mf([agent({})]), lockfile, {
      name: "app",
      hasApps: true,
    });
    const cfg = parse(out);
    expect(cfg["assets"]).toEqual({
      directory: "../assets",
      binding: "ASSETS",
      not_found_handling: "none",
      // The explicit "none" is load-bearing: the default auto-trailing-slash
      // behavior redirects /foo/index.html → /foo/ which leaks into the
      // browser URL and breaks useAgent's URL-derived instance lookup.
      html_handling: "none",
    });
  });
});

describe("deriveWorkerName", () => {
  test("strips scope", () => {
    expect(deriveWorkerName("@acme/chat")).toBe("chat");
  });
  test("lowercases and hyphenates", () => {
    expect(deriveWorkerName("My Cool App")).toBe("my-cool-app");
  });
  test("trims leading/trailing hyphens", () => {
    expect(deriveWorkerName("!!foo!!")).toBe("foo");
  });
  test("already-valid passthrough", () => {
    expect(deriveWorkerName("plain-app")).toBe("plain-app");
  });
});
