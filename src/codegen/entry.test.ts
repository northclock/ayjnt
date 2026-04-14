import { describe, expect, test } from "bun:test";
import type { AgentEntry, Manifest } from "../core/types.ts";
import { generateEntry } from "./entry.ts";

function mf(agents: AgentEntry[], root = "/fake"): Manifest {
  return { root, agents };
}

function agent(overrides: Partial<AgentEntry>): AgentEntry {
  return {
    agentId: "chat",
    className: "ChatAgent",
    folderPath: "chat",
    routePath: "/chat",
    binding: "CHAT_AGENT",
    sourceFile: "/fake/agents/chat/agent.ts",
    hasApp: false,
    middlewareChain: [],
    ...overrides,
  };
}

describe("generateEntry", () => {
  test("single agent: re-exports class, builds route table, dispatches", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    // Relative import from /fake/.ayjnt/dist to /fake/agents/chat/agent.ts
    expect(out).toContain(
      `export { default as ChatAgent } from "../../agents/chat/agent.ts";`,
    );
    expect(out).toContain(`prefix: "/chat"`);
    expect(out).toContain(`binding: "CHAT_AGENT"`);
    expect(out).toContain("type Binding = \"CHAT_AGENT\"");
  });

  test("uses getAgentByName so DO learns its identity", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    // Must import + call getAgentByName, not raw idFromName + get. Without
    // setName under the hood, CF_AGENT_IDENTITY messages to the client
    // carry no name.
    expect(out).toContain(`import { getAgentByName } from "agents"`);
    expect(out).toContain("await getAgentByName(env[match.binding]");
    expect(out).not.toContain(".idFromName(");
  });

  test("longest prefix first", () => {
    const out = generateEntry(
      mf([
        agent({
          agentId: "admin",
          className: "AdminAgent",
          routePath: "/admin",
          binding: "ADMIN_AGENT",
          sourceFile: "/fake/agents/admin/agent.ts",
          folderPath: "admin",
        }),
        agent({
          agentId: "admin_users",
          className: "AdminUsersAgent",
          routePath: "/admin/users",
          binding: "ADMIN_USERS_AGENT",
          sourceFile: "/fake/agents/admin/users/agent.ts",
          folderPath: "admin/users",
        }),
      ]),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    const adminIdx = out.indexOf(`prefix: "/admin"`);
    const adminUsersIdx = out.indexOf(`prefix: "/admin/users"`);
    expect(adminUsersIdx).toBeLessThan(adminIdx);
  });

  test("binding union type includes every binding", () => {
    const out = generateEntry(
      mf([
        agent({
          agentId: "a",
          className: "A",
          binding: "A",
          routePath: "/a",
          folderPath: "a",
        }),
        agent({
          agentId: "b",
          className: "B",
          binding: "B",
          routePath: "/b",
          folderPath: "b",
        }),
      ]),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).toContain(`type Binding = "A" | "B"`);
  });

  test("empty manifest produces compilable stub", () => {
    const out = generateEntry(mf([]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toContain("type Binding = never");
    expect(out).toContain("// (no agents discovered)");
    expect(out).toContain("export default");
  });

  test("no middleware: route table has empty middleware array", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toContain("middleware: []");
    // compose is still imported — we always emit the same shape so the
    // generated code stays predictable.
    expect(out).toContain(`import { compose, createContext`);
  });

  test("middleware: imports deduped across agents, chained per route", () => {
    const rootMw = "/fake/agents/middleware.ts";
    const adminMw = "/fake/agents/admin/middleware.ts";
    const out = generateEntry(
      mf([
        agent({
          agentId: "chat",
          className: "ChatAgent",
          routePath: "/chat",
          binding: "CHAT_AGENT",
          folderPath: "chat",
          sourceFile: "/fake/agents/chat/agent.ts",
          middlewareChain: [rootMw],
        }),
        agent({
          agentId: "admin_users",
          className: "AdminUsersAgent",
          routePath: "/admin/users",
          binding: "ADMIN_USERS_AGENT",
          folderPath: "admin/users",
          sourceFile: "/fake/agents/admin/users/agent.ts",
          middlewareChain: [rootMw, adminMw], // root + admin
        }),
      ]),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );

    // Each unique middleware file imported exactly once, with stable index.
    expect(out).toContain(`import mw_0 from "../../agents/middleware.ts"`);
    expect(out).toContain(
      `import mw_1 from "../../agents/admin/middleware.ts"`,
    );

    // /chat uses just the root
    expect(out).toMatch(
      /prefix: "\/chat", binding: "CHAT_AGENT", middleware: \[mw_0\]/,
    );
    // /admin/users chains root → admin
    expect(out).toMatch(
      /prefix: "\/admin\/users", binding: "ADMIN_USERS_AGENT", middleware: \[mw_0, mw_1\]/,
    );
  });

  test("dispatch runs middleware via compose before calling finalize", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toContain("if (match.middleware.length === 0) return finalize();");
    expect(out).toContain("return compose(match.middleware, c, finalize);");
    expect(out).toContain("createContext({");
  });
});
