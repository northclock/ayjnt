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
    expect(out).toContain(`{ prefix: "/chat", binding: "CHAT_AGENT" }`);
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
    // Union order follows agents array order (scan sorts alphabetically)
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
});
