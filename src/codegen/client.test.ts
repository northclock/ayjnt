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
    hasOnEmail: false,
    isVoice: false,
    middlewareChain: [],
    ...overrides,
  };
}

function mf(
  agents: AgentEntry[],
  features: Partial<Manifest["features"]> = {},
  workflows: Manifest["workflows"] = [],
): Manifest {
  return {
    root: "/fake",
    agents,
    workflows,
    features: {
      browser: false,
      email: false,
      emailResolverFile: null,
      voice: false,
      ...features,
    },
  };
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
      `import type __AyjntAgentClass from "../../../agents/chat/agent.ts";`,
    );
    // The class is still re-exported under its REAL name for consumers.
    expect(out).toContain(
      `export type { default as ChatAgent } from "../../../agents/chat/agent.ts";`,
    );
    // basePath = route without leading slash; the derived (DECODED)
    // instance name is re-encoded so "/", "?", "#" can't be re-parsed as
    // URL structure and bind the UI to the wrong DO.
    expect(out).toContain(`basePath: "chat" + "/" + encodeURIComponent(instanceName)`);
    // agent field = class name
    expect(out).toContain(`agent: "ChatAgent"`);
    // deriveInstance matches decoded segments against the route prefix
    expect(out).toContain(`const prefix: string[] = ["chat"];`);
    expect(out).toContain("decodeURIComponent");
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
    expect(out).toContain(`basePath: "admin/users" + "/" + encodeURIComponent(instanceName)`);
    expect(out).toContain(`const prefix: string[] = ["admin","users"];`);
    expect(out).toContain(
      `import type __AyjntAgentClass from "../../../../agents/admin/users/agent.ts";`,
    );
  });

  test("state type inferred from agent class", () => {
    const out = generateClientHook(agent({}), "/fake/.ayjnt/client/chat/index.tsx");
    expect(out).toContain(
      "type __AyjntState = __AyjntInstance extends { state: infer S } ? S : unknown;",
    );
  });

  test("forwards Instance to upstream so .stub.method() is typed", () => {
    // Cloudflare's useAgent has two overloads — the typed one is
    //   useAgent<AgentT extends { get state(): State }, State>(options) → { stub: AgentStub<AgentT>, … }
    // Our wrapper hardcodes BOTH generics — AgentT = Instance (the agent
    // class) and State = AgentState (the inferred state shape). Without
    // this, `agent.stub` falls back to UntypedAgentStub and @callable
    // methods lose their signatures on the client.
    //
    // We deliberately don't expose State as a generic on the wrapper.
    // Threading a user-provided State through the upstream constraint
    // (`AgentT extends { get state(): State }`) ran into TS's "two
    // different State types" diagnostic — concrete types resolve cleanly,
    // open generics don't.
    const out = generateClientHook(agent({}), "/fake/.ayjnt/client/chat/index.tsx");
    expect(out).toContain("__ayjntUseAgentUpstream<__AyjntInstance, __AyjntState>");
    expect(out).toContain(
      "ReturnType<typeof __ayjntUseAgentUpstream<__AyjntInstance, __AyjntState>>",
    );
    // No State generic on the wrapper itself — bare useAgent() call.
    expect(out).toMatch(/export function useAgent\(\s*options/);
  });

  test("isVoice agent emits useVoiceAgent (not useAgent) via ayjnt/voice/client", () => {
    // Voice agents need a different hook entirely: useVoiceAgent from
    // @cloudflare/voice/react with ayjnt's custom transport. The
    // generated wrapper hides that switch from the user — they always
    // call useVoiceAgent() in their app.tsx regardless of how it's
    // wired underneath.
    const out = generateClientHook(
      agent({
        isVoice: true,
        className: "ChatVoice",
        routePath: "/voice-chat",
      }),
      "/fake/.ayjnt/client/voice-chat/index.tsx",
    );
    // Imports the wrapper hook + transport class from ayjnt/voice/client,
    // NOT useAgent from agents/react. AyjntVoiceTransport is a class
    // (value import), so re-exporting it works under verbatimModuleSyntax.
    expect(out).toContain(`from "ayjnt/voice/client"`);
    expect(out).toContain(`useAyjntVoiceAgent`);
    expect(out).toContain(`AyjntVoiceTransport`);
    expect(out).not.toContain(`from "agents/react"`);
    // Pre-binds class name + routePath so the user call is bare.
    expect(out).toContain(`agent: "ChatVoice"`);
    expect(out).toContain(`routePath: "/voice-chat"`);
    // Re-exports the transport so users who need framework-agnostic
    // voice clients can import it from `@ayjnt/<route>`.
    expect(out).toContain(`export { AyjntVoiceTransport }`);
    // The exported hook is named `useVoiceAgent` (not `useAgent`) so
    // there's no ambiguity at the call site.
    expect(out).toContain(`export function useVoiceAgent(`);
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

describe("generateHtmlShell styleSrcs", () => {
  test("emits a <link rel=stylesheet> per style, before </head>", () => {
    const out = generateHtmlShell({
      title: "Chat",
      scriptSrc: "/__ayjnt/chat/app.js",
      styleSrcs: ["/__ayjnt/chat/mount-abc123.css"],
    });
    const link = '<link rel="stylesheet" href="/__ayjnt/chat/mount-abc123.css">';
    expect(out).toContain(link);
    expect(out.indexOf(link)).toBeLessThan(out.indexOf("</head>"));
  });

  test("style hrefs are HTML-escaped", () => {
    const out = generateHtmlShell({
      title: "x",
      scriptSrc: "/app.js",
      styleSrcs: ['/__ayjnt/x/a"b.css'],
    });
    expect(out).toContain('href="/__ayjnt/x/a&quot;b.css"');
  });

  test("no styleSrcs → no link tags (back-compat)", () => {
    const out = generateHtmlShell({ title: "x", scriptSrc: "/app.js" });
    expect(out).not.toContain("<link");
  });
});

// bundleApp integration — the original bug: `import "./styles.css"` produced
// a second build output that was silently dropped (page rendered unstyled),
// and asset imports referenced files that were never written.
import { mkdtempSync as mkdtemp2, rmSync as rm2, mkdirSync as mkdir2 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import * as path from "node:path";
import { bundleApp } from "./client.ts";

describe("bundleApp outputs", () => {
  test("returns CSS and asset outputs alongside the entry, flat-named", async () => {
    const proj = mkdtemp2(path.join(tmpdir2(), "ayjnt-bundle-"));
    mkdir2(path.join(proj, "app"), { recursive: true });
    await Bun.write(path.join(proj, "app/styles.css"), "body { margin: 0; }");
    // a tiny binary "image" exercised through Bun's file loader
    await Bun.write(path.join(proj, "app/logo.png"), new Uint8Array([137, 80, 78, 71]));
    await Bun.write(
      path.join(proj, "app/entry.ts"),
      `import "./styles.css";
import logo from "./logo.png";
console.log(logo);
export default function App() { return null; }
`,
    );

    const bundle = await bundleApp({
      appEntry: path.join(proj, "app/entry.ts"),
      projectRoot: proj,
    });

    expect(bundle.entryJs.length).toBeGreaterThan(0);
    expect(bundle.styles).toHaveLength(1);
    expect(bundle.styles[0]).toMatch(/\.css$/);
    const names = bundle.extras.map((e) => e.fileName);
    expect(names).toContain(bundle.styles[0]!);
    expect(names.some((n) => n.endsWith(".png"))).toBe(true);
    // Flat naming: no path separators — every output sits beside app.js so
    // the JS's "./<name>" references resolve under /__ayjnt/<flat>/.
    for (const n of names) expect(n).not.toContain("/");
    const pngName = names.find((n) => n.endsWith(".png"))!;
    expect(bundle.entryJs).toContain(pngName);

    rm2(proj, { recursive: true, force: true });
  });

  test("a resolve failure surfaces the failing import, not an opaque AggregateError", async () => {
    const proj = mkdtemp2(path.join(tmpdir2(), "ayjnt-bundlefail-"));
    await Bun.write(
      path.join(proj, "entry.ts"),
      `import "this-package-does-not-exist";`,
    );
    expect(
      bundleApp({ appEntry: path.join(proj, "entry.ts"), projectRoot: proj }),
    ).rejects.toThrow(/this-package-does-not-exist/);
    rm2(proj, { recursive: true, force: true });
  });
});
