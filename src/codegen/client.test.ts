import { describe, expect, test } from "bun:test";
import type { AgentEntry, Manifest } from "../core/types.ts";
import {
  clientDirFor,
  clientFileFor,
  generateClientHook,
  generateEnvTypes,
  generateHtmlShell,
  generateMountEntry,
  generateTsconfig,
  hasDefaultExport,
} from "./client.ts";

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

function mf(agents: AgentEntry[]): Manifest {
  return { root: "/fake", agents };
}

describe("generateTsconfig", () => {
  test("produces valid JSON with path aliases", () => {
    const out = generateTsconfig();
    const body = out.replace(/^\/\/[^\n]*\n/, "");
    const parsed = JSON.parse(body);
    expect(parsed.compilerOptions.paths["@ayjnt/*"]).toEqual(["./client/*"]);
    expect(parsed.compilerOptions.paths["@ayjnt/env"]).toEqual([
      "./env.d.ts",
    ]);
  });
});

describe("generateEnvTypes", () => {
  test("single agent emits binding with typed namespace", () => {
    const out = generateEnvTypes(
      mf([agent({})]),
      "/fake/.ayjnt/env.d.ts",
    );
    // Relative from /fake/.ayjnt to /fake/agents/chat/agent.ts
    expect(out).toContain(
      `import type ChatAgent from "../agents/chat/agent.ts";`,
    );
    expect(out).toContain(
      "CHAT_AGENT: DurableObjectNamespace<ChatAgent>",
    );
    expect(out).toContain("export type GeneratedEnv = {");
  });

  test("multiple agents", () => {
    const out = generateEnvTypes(
      mf([
        agent({}),
        agent({
          agentId: "orders",
          className: "OrdersAgent",
          routePath: "/orders",
          folderPath: "orders",
          binding: "ORDERS_AGENT",
          sourceFile: "/fake/agents/orders/agent.ts",
        }),
      ]),
      "/fake/.ayjnt/env.d.ts",
    );
    expect(out).toContain("CHAT_AGENT: DurableObjectNamespace<ChatAgent>");
    expect(out).toContain("ORDERS_AGENT: DurableObjectNamespace<OrdersAgent>");
  });

  test("empty manifest produces compilable output", () => {
    const out = generateEnvTypes(mf([]), "/fake/.ayjnt/env.d.ts");
    expect(out).toContain("// (no agents discovered)");
    expect(out).toContain("// no agents");
  });
});

describe("generateClientHook", () => {
  test("emits typed useAgent bound to route + class", () => {
    const out = generateClientHook(agent({}), "/fake/.ayjnt/client/chat/index.tsx");
    // Import from the generated location to the agent source
    expect(out).toContain(
      `import type ChatAgent from "../../../agents/chat/agent.ts";`,
    );
    // basePath = route without leading slash
    expect(out).toContain(`basePath: "chat" + "/" + instanceName`);
    // agent field = class name
    expect(out).toContain(`agent: "ChatAgent"`);
    // deriveInstance uses route prefix
    expect(out).toContain(`const prefix = "/chat";`);
  });

  test("nested route hook", () => {
    const out = generateClientHook(
      agent({
        routePath: "/admin/users",
        folderPath: "admin/users",
        className: "AdminUsersAgent",
        sourceFile: "/fake/agents/admin/users/agent.ts",
      }),
      "/fake/.ayjnt/client/admin/users/index.tsx",
    );
    expect(out).toContain(`basePath: "admin/users" + "/" + instanceName`);
    expect(out).toContain(`const prefix = "/admin/users";`);
    expect(out).toContain(
      `import type AdminUsersAgent from "../../../../agents/admin/users/agent.ts";`,
    );
  });

  test("state type inferred from agent class", () => {
    const out = generateClientHook(agent({}), "/fake/.ayjnt/client/chat/index.tsx");
    expect(out).toContain(
      "type DefaultState = Instance extends { state: infer S } ? S : unknown;",
    );
  });
});

describe("clientFileFor", () => {
  test("flat route", () => {
    expect(clientFileFor(agent({ routePath: "/chat" }))).toBe(
      "client/chat/index.tsx",
    );
  });

  test("nested route", () => {
    expect(
      clientFileFor(agent({ routePath: "/admin/users" })),
    ).toBe("client/admin/users/index.tsx");
  });
});

describe("generateHtmlShell", () => {
  test("references bundle via external script src (not inlined)", () => {
    const html = generateHtmlShell({
      title: "Chat",
      scriptSrc: "/__ayjnt/chat/app.js",
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Chat</title>");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain(
      `<script type="module" src="/__ayjnt/chat/app.js"></script>`,
    );
    // Guard against regression: no inlined bundle contents should ever
    // land in the HTML; that's what broke rendering in v0.3.
    expect(html).not.toMatch(/<script type="module">[^<]/);
  });

  test("escapes title + script src", () => {
    const html = generateHtmlShell({
      title: '<script>alert(1)</script>',
      scriptSrc: '/x"onerror="alert(1)"',
    });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<title><script>");
    expect(html).toContain(`&quot;onerror=&quot;alert(1)&quot;`);
  });
});

describe("flattenRoute", () => {
  test("flat route", () => {
    const { flattenRoute } = require("./client.ts");
    expect(flattenRoute("/chat")).toBe("chat");
  });
  test("nested route → underscore-joined", () => {
    const { flattenRoute } = require("./client.ts");
    expect(flattenRoute("/admin/users")).toBe("admin_users");
  });
  test("deeply nested", () => {
    const { flattenRoute } = require("./client.ts");
    expect(flattenRoute("/a/b/c/d")).toBe("a_b_c_d");
  });
});

describe("clientDirFor", () => {
  test("flat route", () => {
    expect(clientDirFor(agent({ routePath: "/chat" }))).toBe("client/chat");
  });
  test("nested route", () => {
    expect(clientDirFor(agent({ routePath: "/admin/users" }))).toBe(
      "client/admin/users",
    );
  });
});

describe("hasDefaultExport", () => {
  test("export default function", () => {
    expect(hasDefaultExport("export default function X() {}")).toBe(true);
  });
  test("export default async function", () => {
    expect(
      hasDefaultExport("export default async function X() {}"),
    ).toBe(true);
  });
  test("export default class", () => {
    expect(hasDefaultExport("export default class X {}")).toBe(true);
  });
  test("export default <identifier>", () => {
    expect(hasDefaultExport("const X = 1;\nexport default X;")).toBe(true);
  });
  test("export default (expression)", () => {
    expect(
      hasDefaultExport("export default (function() { return 1 })();"),
    ).toBe(true);
  });
  test("export { X as default }", () => {
    expect(hasDefaultExport("function X() {}\nexport { X as default };")).toBe(
      true,
    );
  });
  test("export { Y, X as default } — default in the middle", () => {
    expect(
      hasDefaultExport(
        "function X() {}\nconst Y = 1;\nexport { Y, X as default };",
      ),
    ).toBe(true);
  });
  test("indented export default on its own line", () => {
    expect(hasDefaultExport("\n  export default class C {}\n")).toBe(true);
  });
  test("no default export: only named", () => {
    expect(hasDefaultExport("export function Named() {}")).toBe(false);
  });
  test("no default export: const", () => {
    expect(hasDefaultExport("export const x = 1;")).toBe(false);
  });
  test("commented-out default is ignored", () => {
    expect(
      hasDefaultExport("// export default function X() {}"),
    ).toBe(false);
  });
  test("legacy manual-mount file (our v0.4 pattern) has no default", () => {
    const source = `import { createRoot } from "react-dom/client";
function Counter() { return null; }
const root = document.getElementById("root");
if (root) createRoot(root).render(<Counter />);
`;
    expect(hasDefaultExport(source)).toBe(false);
  });
  test("new-style file: export default function", () => {
    const source = `import { useAgent } from "@ayjnt/counter";
export default function Counter() {
  const agent = useAgent();
  return <div>{agent.state?.count ?? 0}</div>;
}
`;
    expect(hasDefaultExport(source)).toBe(true);
  });
});

describe("generateMountEntry", () => {
  test("imports from the supplied path and mounts to #root", () => {
    const out = generateMountEntry({
      appImportPath: "../../../agents/counter/app.tsx",
    });
    expect(out).toContain(`import App from "../../../agents/counter/app.tsx";`);
    expect(out).toContain(`import { createRoot } from "react-dom/client";`);
    expect(out).toContain("StrictMode");
    expect(out).toContain("AyjntErrorBoundary");
    expect(out).toContain(`document.getElementById("root")`);
    expect(out).toContain("<App />");
    expect(out).toContain("mount target #root missing");
    // Should start with the generated-file banner so humans aren't tempted
    // to edit it.
    expect(out.trimStart()).toStartWith("// GENERATED by ayjnt");
  });

  test("different import paths are inlined verbatim", () => {
    const out = generateMountEntry({
      appImportPath: "./app.tsx",
    });
    expect(out).toContain(`import App from "./app.tsx";`);
  });
});
