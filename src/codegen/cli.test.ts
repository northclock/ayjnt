import { describe, expect, test } from "bun:test";
import type { AgentEntry, Manifest, WorkflowEntry } from "../core/types.ts";
import {
  accessorKeyPath,
  assertNoReservedClientRoutes,
  camelizeSegment,
  generateCliTypes,
} from "./cli.ts";

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
    hasOnEmail: false,
    isVoice: false,
    middlewareChain: [],
    tools: [],
    ...overrides,
  };
}

function workflow(overrides: Partial<WorkflowEntry> = {}): WorkflowEntry {
  return {
    className: "DataImporter",
    binding: "DATA_IMPORTER",
    name: "data-importer",
    sourceFile: "/fake/workflows/import/workflow.ts",
    baseClass: "WorkflowEntrypoint",
    ...overrides,
  };
}

function mf(
  agents: AgentEntry[],
  workflows: WorkflowEntry[] = [],
): Manifest {
  return {
    root: "/fake",
    agents,
    workflows,
    wasmModules: [],
    features: {
      browser: false,
      email: false,
      emailResolverFile: null,
      voice: false,
    },
    rootApp: null,
    cliFile: null,
  };
}

const OUT = "/fake/.ayjnt/client/cli.ts";

describe("camelizeSegment", () => {
  test("leaves a plain segment alone", () => {
    expect(camelizeSegment("counter")).toBe("counter");
  });

  test("camelizes hyphens, underscores and dots", () => {
    expect(camelizeSegment("my-notes")).toBe("myNotes");
    expect(camelizeSegment("my_notes")).toBe("myNotes");
    expect(camelizeSegment("my.notes")).toBe("myNotes");
    expect(camelizeSegment("a-b-c")).toBe("aBC");
  });

  test("lowercases the leading part so the key is a valid identifier start", () => {
    expect(camelizeSegment("Counter")).toBe("counter");
    expect(camelizeSegment("My-Notes")).toBe("myNotes");
  });
});

describe("accessorKeyPath", () => {
  test("splits nested routes and camelizes each segment", () => {
    expect(accessorKeyPath("/admin/users")).toEqual(["admin", "users"]);
    expect(accessorKeyPath("/my-notes")).toEqual(["myNotes"]);
    expect(accessorKeyPath("/a/b-c/d")).toEqual(["a", "bC", "d"]);
  });
});

describe("assertNoReservedClientRoutes", () => {
  test("rejects a route that would shadow the generated @ayjnt/cli module", () => {
    // `@ayjnt/cli` resolves to client/cli.ts, which TypeScript prefers over
    // client/cli/index.tsx — so an agent at agents/cli/ silently wins.
    expect(() =>
      assertNoReservedClientRoutes(
        mf([agent({ routePath: "/cli", folderPath: "cli" })]),
      ),
    ).toThrow(/reserved name "cli"/);
  });

  test("rejects a route that would shadow @ayjnt/modules", () => {
    expect(() =>
      assertNoReservedClientRoutes(
        mf([agent({ routePath: "/modules/math", folderPath: "modules/math" })]),
      ),
    ).toThrow(/reserved name "modules"/);
  });

  test("allows a route that merely starts with the reserved word", () => {
    expect(() =>
      assertNoReservedClientRoutes(
        mf([agent({ routePath: "/client", folderPath: "client" })]),
      ),
    ).not.toThrow();
  });

  test("allows the reserved word in a non-leading segment", () => {
    expect(() =>
      assertNoReservedClientRoutes(
        mf([agent({ routePath: "/admin/cli", folderPath: "admin/cli" })]),
      ),
    ).not.toThrow();
  });
});

describe("generateCliTypes", () => {
  test("emits a flat accessor for a top-level route", () => {
    const out = generateCliTypes(mf([agent({})]), { outPath: OUT });
    expect(out).toContain("chat: (instance?: string) => AgentHandle<__Agent0>");
    expect(out).toContain(
      'import type __Agent0 from "../../agents/chat/agent.ts"',
    );
  });

  test("nests accessors to mirror the file tree", () => {
    const out = generateCliTypes(
      mf([
        agent({
          routePath: "/admin/users",
          folderPath: "admin/users",
          className: "UsersAgent",
          sourceFile: "/fake/agents/admin/users/agent.ts",
        }),
      ]),
      { outPath: OUT },
    );
    expect(out).toMatch(/admin: \{\s*users: \(instance\?: string\)/);
  });

  test("camelizes hyphenated route segments into valid keys", () => {
    const out = generateCliTypes(
      mf([
        agent({
          routePath: "/my-notes",
          folderPath: "my-notes",
          sourceFile: "/fake/agents/my-notes/agent.ts",
        }),
      ]),
      { outPath: OUT },
    );
    expect(out).toContain("myNotes: (instance?: string)");
    expect(out).not.toContain("my-notes:");
  });

  test("a route that is both leaf and parent becomes a callable object", () => {
    // /admin serves an agent AND /admin/users nests under it. The accessor has
    // to be callable and carry properties, which is an intersection in TS.
    const out = generateCliTypes(
      mf([
        agent({
          routePath: "/admin",
          folderPath: "admin",
          className: "AdminAgent",
          sourceFile: "/fake/agents/admin/agent.ts",
        }),
        agent({
          routePath: "/admin/users",
          folderPath: "admin/users",
          className: "UsersAgent",
          sourceFile: "/fake/agents/admin/users/agent.ts",
        }),
      ]),
      { outPath: OUT },
    );
    expect(out).toMatch(/admin: \(instance\?: string\) => AgentHandle<\w+> & \{/);
    expect(out).toContain("users:");
  });

  test("gives each agent a distinct local alias so duplicate class names can't collide", () => {
    const out = generateCliTypes(
      mf([
        agent({ routePath: "/a", folderPath: "a", sourceFile: "/fake/agents/a/agent.ts" }),
        agent({ routePath: "/b", folderPath: "b", sourceFile: "/fake/agents/b/agent.ts" }),
      ]),
      { outPath: OUT },
    );
    expect(out).toContain("__Agent0");
    expect(out).toContain("__Agent1");
  });

  test("emits workflow handles keyed by camelized workflow name", () => {
    const out = generateCliTypes(mf([agent({})], [workflow()]), {
      outPath: OUT,
    });
    expect(out).toContain(
      "dataImporter: WorkflowHandle<WorkflowParams<typeof __Workflow0>>",
    );
    expect(out).toContain('import type { WorkflowParams } from "ayjnt/workflow"');
  });

  test("omits the workflow import when there are no workflows", () => {
    const out = generateCliTypes(mf([agent({})]), { outPath: OUT });
    expect(out).not.toContain("ayjnt/workflow");
    expect(out).toContain("AyjntWorkflows = Record<string, never>");
  });

  test("handles a project with no agents at all", () => {
    const out = generateCliTypes(mf([]), { outPath: OUT });
    expect(out).toContain("AyjntAgents = Record<string, never>");
  });

  test("every emitted import is type-only, so cli.ts never pulls worker code", () => {
    // cli.ts runs in Bun. A value import of an agent module would drag
    // workerd-targeted code into the host process.
    const out = generateCliTypes(mf([agent({})], [workflow()]), {
      outPath: OUT,
    });
    for (const line of out.split("\n")) {
      if (line.startsWith("import")) {
        expect(line).toStartWith("import type");
      }
    }
  });
});
