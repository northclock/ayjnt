import { describe, expect, test } from "bun:test";
import type { AgentEntry, Manifest } from "../core/types.ts";
import { generateEntry } from "./entry.ts";

function mf(
  agents: AgentEntry[],
  root = "/fake",
  features: Partial<Manifest["features"]> = {},
  workflows: Manifest["workflows"] = [],
): Manifest {
  return {
    root,
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

describe("generateEntry", () => {
  test("single agent: re-exports class, builds route table, dispatches", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    // Local import + re-export so we can both call static methods
    // (ChatAgent.serve for MCP) AND have the class registered at the
    // module boundary for DO class lookup.
    expect(out).toContain(
      `import ChatAgent from "../../agents/chat/agent.ts";`,
    );
    expect(out).toContain(`export { ChatAgent };`);
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

  test("no assetRoutes: every route has assetFlat: null and no ASSETS binding", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toContain("assetFlat: null");
    expect(out).toContain("type Env = Record<Binding, DurableObjectNamespace>;");
    expect(out).not.toContain("ASSETS: Fetcher");
    // isHtmlRequest helper is always emitted so the code shape is stable
    expect(out).toContain("function isHtmlRequest");
  });

  test("with assetRoutes: ASSETS added to Env, dispatch fetches index.html", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
      assetRoutes: { CHAT_AGENT: "chat" },
    });
    expect(out).toContain(`assetFlat: "chat"`);
    expect(out).toContain("ASSETS: Fetcher");
    expect(out).toContain("match.assetFlat && isHtmlRequest(request)");
    expect(out).toContain("`/__ayjnt/${match.assetFlat}/index.html`");
    expect(out).toContain("(env as any).ASSETS.fetch");
  });

  test("HTML detection checks method + upgrade + accept", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toContain(`if (request.method !== "GET") return false;`);
    expect(out).toContain(`"upgrade"`);
    expect(out).toContain(`accept.includes("text/html")`);
  });

  test("MCP agent: isMcp flag + McpAgent.serve dispatch", () => {
    const out = generateEntry(
      mf([agent({ className: "Tools", binding: "TOOLS", baseClass: "McpAgent" })]),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).toMatch(/binding: "TOOLS".*isMcp: true/);
    expect(out).toContain("if (match.isMcp)");
    expect(out).toContain("ClassRef.serve(");
    expect(out).toContain('"TOOLS": "/chat"'); // route prefix map
  });

  test("non-MCP agent: isMcp false in route table", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toMatch(/binding: "CHAT_AGENT".*isMcp: false/);
  });

  test("CLASSES map is emitted for MCP dispatch", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toContain('const CLASSES: Record<Binding, any>');
    expect(out).toContain('"CHAT_AGENT": ChatAgent');
  });

  test("no docs.md: route entry has docs: null and no embed", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toMatch(/binding: "CHAT_AGENT".*docs: null/);
  });

  test("with docs option: markdown embedded as JSON-encoded literal", () => {
    const md = "# Chat\n\n`back`tick and ${interp} survive escaping.";
    const out = generateEntry(mf([agent({ hasDocs: true })]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
      docs: { CHAT_AGENT: md },
    });
    // JSON.stringify ensures backticks and ${} can't break the literal —
    // unlike template strings, which would corrupt at the first ${.
    expect(out).toContain(JSON.stringify(md));
    expect(out).toContain('"hasDocs":true');
  });

  test("docs request: matchRoute recognizes <route>/docs as a docs match", () => {
    const out = generateEntry(mf([agent({ hasDocs: true })]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
      docs: { CHAT_AGENT: "# Chat\n" },
    });
    // The generated matcher must special-case the literal "docs" segment
    // BEFORE consuming it as an instanceId, otherwise an instance named
    // "docs" would shadow the docs route.
    expect(out).toContain('parts[0] === DOCS_SEGMENT');
    expect(out).toContain('kind: "docs"');
    // Dispatch path returns text/markdown for docs, not application/json.
    expect(out).toContain('text/markdown');
  });

  test("callable methods are echoed verbatim into the route table", () => {
    const out = generateEntry(
      mf([
        agent({
          callables: [
            {
              name: "decrement",
              params: "sku: string, qty: number",
              returnType: "Promise<number>",
              description: "Decrement stock for a SKU.",
            },
          ],
        }),
      ]),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).toContain('"name":"decrement"');
    expect(out).toContain('"params":"sku: string, qty: number"');
    expect(out).toContain('"returnType":"Promise<number>"');
  });

  test("bare route falls back to instance \"default\"", () => {
    // /counter (no instance) and /counter/ (trailing slash) must resolve to
    // the same DO as /counter/default. Mirrors the client-side useAgent()
    // hook's deriveInstance() so the bundled UI talks to the same instance
    // the worker dispatches to.
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toContain('DEFAULT_INSTANCE = "default"');
    expect(out).toContain("parts[0] ?? DEFAULT_INSTANCE");
    // The historic null-return path that produced 404 for missing instance
    // is gone — there should be no remaining `if (!instanceId) return null`
    // construction in the generated matcher.
    expect(out).not.toContain("if (!instanceId) return null;");
  });

  test("catalog: reserved path + middleware probe", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).toContain('CATALOG_PATH = "/__ayjnt/catalog"');
    expect(out).toContain('url.pathname === CATALOG_PATH');
    // Probe runs every route's middleware against the original request and
    // hides routes whose chain short-circuits with a non-2xx response.
    expect(out).toContain('async function buildCatalog');
    expect(out).toContain('PROBE_OK');
    // Each catalog entry exposes hasDocs + a docsUrl when docs exist.
    expect(out).toContain('docsUrl');
  });

  // ---- Email handler emission ---------------------------------------------

  test("features.email=false: no email handler in default export", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).not.toContain("routeAgentEmail");
    expect(out).not.toContain("async email(");
    expect(out).not.toContain("EMAIL_ROUTES");
    // Env type still pure DO bindings.
    expect(out).not.toContain("EMAIL: SendEmail");
  });

  test("features.email=true: imports routeAgentEmail and emits an email() handler", () => {
    const out = generateEntry(
      mf(
        [agent({ hasOnEmail: true })],
        "/fake",
        { email: true },
      ),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).toContain('import { routeAgentEmail } from "agents"');
    expect(out).toContain("async email(");
    expect(out).toContain("ForwardableEmailMessage");
    // The handler dispatches via routeAgentEmail with the resolver.
    expect(out).toContain("await routeAgentEmail(message, env,");
    // Env gains the EMAIL binding so this.env.EMAIL inside agents works.
    expect(out).toContain("EMAIL: SendEmail");
  });

  test("email default resolver maps routePath → kebab class name, with +suffix instance", () => {
    const out = generateEntry(
      mf(
        [
          agent({
            className: "SupportAgent",
            routePath: "/support",
            binding: "SUPPORT_AGENT",
            sourceFile: "/fake/agents/support/agent.ts",
            folderPath: "support",
            hasOnEmail: true,
          }),
        ],
        "/fake",
        { email: true },
      ),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).toContain('defaultEmailResolver');
    expect(out).toContain("EMAIL_ROUTES");
    // Map keys are the routePath without leading slash, lowercased.
    expect(out).toContain('"support": { agentName: "support-agent" }');
    // Sub-addressing logic for +instance must be in the resolver.
    expect(out).toContain('local.indexOf("+")');
    expect(out).toContain('"default"'); // fallback instance id
  });

  test("only agents with hasOnEmail appear in EMAIL_ROUTES", () => {
    // Two agents, only one handles email. The non-email one must not
    // appear in the routes map (an inbound email to its local-part
    // should resolve to null and be rejected).
    const out = generateEntry(
      mf(
        [
          agent({
            className: "SupportAgent",
            routePath: "/support",
            binding: "SUPPORT_AGENT",
            sourceFile: "/fake/agents/support/agent.ts",
            folderPath: "support",
            hasOnEmail: true,
          }),
          agent({
            className: "ChatAgent",
            routePath: "/chat",
            binding: "CHAT_AGENT",
            sourceFile: "/fake/agents/chat/agent.ts",
            folderPath: "chat",
            hasOnEmail: false,
    isVoice: false,
          }),
        ],
        "/fake",
        { email: true },
      ),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).toContain('"support": { agentName: "support-agent" }');
    expect(out).not.toContain('"chat": { agentName: "chat-agent" }');
  });

  test("workflows: imports + re-exports each workflow class", () => {
    // Workflows need to land on the module boundary so wrangler's
    // `workflows: [{ class_name }]` lookup finds them.
    const out = generateEntry(
      mf(
        [agent({})],
        "/fake",
        {},
        [
          {
            className: "OrdersProcessing",
            binding: "ORDERS_PROCESSING",
            name: "orders-processing",
            sourceFile: "/fake/agents/orders/workflow.ts",
            baseClass: "AgentWorkflow",
          },
        ],
      ),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).toContain(
      `import OrdersProcessing from "../../agents/orders/workflow.ts";`,
    );
    expect(out).toContain(`export { OrdersProcessing };`);
  });

  test("no workflows: no workflow import / reexport", () => {
    const out = generateEntry(mf([agent({})]), {
      outPath: "/fake/.ayjnt/dist/entry.ts",
    });
    expect(out).not.toContain("AgentWorkflow");
    expect(out).not.toMatch(/import \w+ from "[^"]*workflow\.ts/);
  });

  test("co-located workflow: emits prototype patch pairing agent to binding", () => {
    // The `withWorkflow` mixin reads `__ayjntWorkflowBinding` off the
    // agent prototype to know which workflow this.workflow(...) should
    // trigger. The codegen pairs by folder: agent.ts + workflow.ts in
    // the same directory → patch the prototype with the workflow's
    // binding name.
    const out = generateEntry(
      mf(
        [
          agent({
            agentId: "orders",
            className: "OrdersAgent",
            binding: "ORDERS_AGENT",
            sourceFile: "/fake/agents/orders/agent.ts",
          }),
        ],
        "/fake",
        {},
        [
          {
            className: "OrdersProcessing",
            binding: "ORDERS_PROCESSING",
            name: "orders-processing",
            sourceFile: "/fake/agents/orders/workflow.ts",
            baseClass: "AgentWorkflow",
          },
        ],
      ),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).toContain(
      `Object.defineProperty(OrdersAgent.prototype, "__ayjntWorkflowBinding", { value: "ORDERS_PROCESSING", enumerable: false });`,
    );
  });

  test("non-co-located workflow: no prototype patch emitted", () => {
    // A workflow whose folder doesn't match any agent's folder is
    // treated as standalone (fire-and-forget batch under a separate
    // tree, etc.). No prototype patch — the user falls back to the
    // SDK's `this.runWorkflow("BINDING", params)` directly.
    const out = generateEntry(
      mf(
        [
          agent({
            agentId: "chat",
            className: "ChatAgent",
            sourceFile: "/fake/agents/chat/agent.ts",
          }),
        ],
        "/fake",
        {},
        [
          {
            className: "CleanupJob",
            binding: "CLEANUP_JOB",
            name: "cleanup-job",
            sourceFile: "/fake/workflows/cleanup/workflow.ts",
            baseClass: "WorkflowEntrypoint",
          },
        ],
      ),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    expect(out).not.toContain("__ayjntWorkflowBinding");
  });

  test("emailResolverFile set: imports the user's custom resolver, omits default", () => {
    const out = generateEntry(
      mf(
        [agent({ hasOnEmail: true })],
        "/fake",
        {
          email: true,
          emailResolverFile: "/fake/email.ts",
        },
      ),
      { outPath: "/fake/.ayjnt/dist/entry.ts" },
    );
    // Custom resolver is imported and referenced in the email() handler.
    expect(out).toContain('import customEmailResolver from');
    expect(out).toContain('resolver: customEmailResolver');
    // The manifest-derived default + EMAIL_ROUTES map are NOT emitted.
    expect(out).not.toContain("defaultEmailResolver");
    expect(out).not.toContain("EMAIL_ROUTES");
  });
});
