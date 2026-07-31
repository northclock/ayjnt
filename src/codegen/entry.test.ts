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
    tools: [],
    ...overrides,
  };
}

const OUT = { outPath: "/fake/.ayjnt/dist/entry.ts" };

describe("generateEntry", () => {
  test("imports agents under synthetic names and re-exports the real class name", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    // The synthetic local name means user class names can never collide
    // with the entry's own identifiers; the re-export registers the class
    // with the DO runtime under the name wrangler's class_name expects.
    expect(out).toContain(
      `import __ayjnt_agent_0 from "../../agents/chat/agent.ts";`,
    );
    expect(out).toContain(`export { __ayjnt_agent_0 as ChatAgent };`);
    expect(out).toContain(`prefix: "/chat"`);
    expect(out).toContain(`binding: "CHAT_AGENT"`);
    expect(out).toContain('type Binding = "CHAT_AGENT"');
  });

  test("routing logic is imported from ayjnt/router, not inlined", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toContain('from "ayjnt/router"');
    expect(out).toContain("matchRoute(ROUTES, url.pathname)");
    expect(out).toContain("buildCatalog(ROUTES, request, env, executionCtx)");
    // The old inline implementations must be gone — they were untestable.
    expect(out).not.toContain("function matchRoute");
    expect(out).not.toContain("function buildCatalog");
    expect(out).not.toContain("function isHtmlRequest");
    expect(out).not.toContain("status: 999");
  });

  test("a user class named like a generated identifier cannot collide", () => {
    const out = generateEntry(
      mf([
        agent({ className: "Response", binding: "RESPONSE" }),
        agent({
          agentId: "env",
          className: "Env",
          binding: "ENV",
          routePath: "/env",
          folderPath: "env",
          sourceFile: "/fake/agents/env/agent.ts",
        }),
      ]),
      OUT,
    );
    // No local binding is created under the user's class name.
    expect(out).not.toMatch(/^import Response from/m);
    expect(out).not.toMatch(/^import Env from/m);
    expect(out).toContain("export { __ayjnt_agent_0 as Response, __ayjnt_agent_1 as Env };");
  });

  test("uses getAgentByName so DO learns its identity", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toContain(`import { getAgentByName } from "agents"`);
    expect(out).toContain("await getAgentByName(");
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
      OUT,
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
      OUT,
    );
    expect(out).toContain(`type Binding = "A" | "B"`);
  });

  test("empty manifest produces compilable stub", () => {
    const out = generateEntry(mf([]), OUT);
    expect(out).toContain("type Binding = never");
    expect(out).toContain("// (no agents discovered)");
    expect(out).toContain("export default");
  });

  test("no middleware: route table has empty middleware array", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toContain("middleware: []");
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
      OUT,
    );

    // Each unique middleware file imported exactly once, with stable index.
    expect(out).toContain(`import __ayjnt_mw_0 from "../../agents/middleware.ts"`);
    expect(out).toContain(
      `import __ayjnt_mw_1 from "../../agents/admin/middleware.ts"`,
    );

    // /chat uses just the root
    expect(out).toMatch(
      /prefix: "\/chat", binding: "CHAT_AGENT", middleware: \[__ayjnt_mw_0\]/,
    );
    // /admin/users chains root → admin
    expect(out).toMatch(
      /prefix: "\/admin\/users", binding: "ADMIN_USERS_AGENT", middleware: \[__ayjnt_mw_0, __ayjnt_mw_1\]/,
    );
  });

  test("dispatch runs middleware via compose before calling finalize", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toContain("if (route.middleware.length === 0) return finalize();");
    expect(out).toContain("return compose(route.middleware, c, finalize);");
    expect(out).toContain("createContext({");
  });

  test("no assetRoutes: every route has assetFlat: null and no ASSETS binding", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toContain("assetFlat: null");
    expect(out).toContain("type Env = Record<Binding, DurableObjectNamespace>;");
    expect(out).not.toContain("ASSETS: Fetcher");
  });

  test("with assetRoutes: ASSETS added to Env, dispatch fetches index.html", () => {
    const out = generateEntry(mf([agent({})]), {
      ...OUT,
      assetRoutes: { CHAT_AGENT: "chat" },
    });
    expect(out).toContain(`assetFlat: "chat"`);
    expect(out).toContain("ASSETS: Fetcher");
    expect(out).toContain("route.assetFlat && isHtmlRequest(request)");
    expect(out).toContain("`/__ayjnt/${route.assetFlat}/index.html`");
    expect(out).toContain("(env as any).ASSETS.fetch");
  });

  test("MCP agent: isMcp flag + McpAgent.serve dispatch", () => {
    const out = generateEntry(
      mf([agent({ className: "Tools", binding: "TOOLS", baseClass: "McpAgent" })]),
      OUT,
    );
    expect(out).toMatch(/binding: "TOOLS".*isMcp: true/);
    expect(out).toContain("if (route.isMcp)");
    expect(out).toContain("CLASSES[route.binding as Binding].serve(");
    expect(out).toContain('"TOOLS": "/chat"'); // route prefix map
  });

  test("non-MCP agent: isMcp false in route table", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toMatch(/binding: "CHAT_AGENT".*isMcp: false/);
  });

  test("CLASSES map references the synthetic agent names", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toContain("const CLASSES: Record<Binding, any>");
    expect(out).toContain('"CHAT_AGENT": __ayjnt_agent_0');
  });

  test("no docs.md: route entry has docs: null", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toMatch(/binding: "CHAT_AGENT".*docs: null/);
  });

  test("with docs option: markdown embedded as JSON-encoded literal", () => {
    const md = "# Chat\n\n`back`tick and ${interp} survive escaping.";
    const out = generateEntry(mf([agent({ hasDocs: true })]), {
      ...OUT,
      docs: { CHAT_AGENT: md },
    });
    // JSON.stringify ensures backticks and ${} can't break the literal —
    // unlike template strings, which would corrupt at the first ${.
    expect(out).toContain(JSON.stringify(md));
    expect(out).toContain('"hasDocs":true');
  });

  test("an EMPTY docs.md is embedded (and served), not treated as missing", () => {
    const out = generateEntry(mf([agent({ hasDocs: true })]), {
      ...OUT,
      docs: { CHAT_AGENT: "" },
    });
    expect(out).toMatch(/docs: ""/);
    // The dispatch null-checks rather than truthiness-checks.
    expect(out).toContain("route.docs == null");
  });

  test("docs dispatch returns text/markdown", () => {
    const out = generateEntry(mf([agent({ hasDocs: true })]), {
      ...OUT,
      docs: { CHAT_AGENT: "# Chat\n" },
    });
    expect(out).toContain('kind === "docs"');
    expect(out).toContain("text/markdown");
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
      OUT,
    );
    expect(out).toContain('"name":"decrement"');
    expect(out).toContain('"params":"sku: string, qty: number"');
    expect(out).toContain('"returnType":"Promise<number>"');
  });

  test("catalog endpoint is GET-only and delegates to the router", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toContain("url.pathname === CATALOG_PATH");
    expect(out).toContain('request.method !== "GET"');
    expect(out).toContain("status: 405");
  });

  // ---- Email handler emission ---------------------------------------------

  test("features.email=false: no email handler in default export", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).not.toContain("routeAgentEmail");
    expect(out).not.toContain("async email(");
    expect(out).not.toContain("EMAIL_ROUTES");
    expect(out).not.toContain("EMAIL: SendEmail");
  });

  test("features.email=true: imports routeAgentEmail and emits an email() handler", () => {
    const out = generateEntry(
      mf([agent({ hasOnEmail: true })], "/fake", { email: true }),
      OUT,
    );
    expect(out).toContain('import { routeAgentEmail } from "agents"');
    expect(out).toContain("async email(");
    expect(out).toContain("ForwardableEmailMessage");
    expect(out).toContain("await routeAgentEmail(message, env,");
    expect(out).toContain("EMAIL: SendEmail");
  });

  test("email default resolver keys by lowercased leaf segment, with +suffix instance", () => {
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
      OUT,
    );
    expect(out).toContain("__ayjntDefaultEmailResolver");
    expect(out).toContain("EMAIL_ROUTES");
    expect(out).toContain('"support": { agentName: "support-agent" }');
    expect(out).toContain('local.indexOf("+")');
    expect(out).toContain('"default"'); // fallback instance id
  });

  test("nested onEmail agents are reachable via their leaf segment", () => {
    // Email local parts can't contain "/", so the old full-routePath keys
    // ("eu/support") made nested agents silently unreachable by mail.
    const out = generateEntry(
      mf(
        [
          agent({
            className: "EuSupportAgent",
            routePath: "/eu/Support",
            binding: "EU_SUPPORT_AGENT",
            sourceFile: "/fake/agents/eu/Support/agent.ts",
            folderPath: "eu/Support",
            hasOnEmail: true,
          }),
        ],
        "/fake",
        { email: true },
      ),
      OUT,
    );
    expect(out).toContain('"support": { agentName: "eu-support-agent" }');
    expect(out).not.toContain('"eu/support"');
  });

  test("two onEmail agents colliding on the same local part throw at build time", () => {
    expect(() =>
      generateEntry(
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
              agentId: "eu_support",
              className: "EuSupportAgent",
              routePath: "/eu/support",
              binding: "EU_SUPPORT_AGENT",
              sourceFile: "/fake/agents/eu/support/agent.ts",
              folderPath: "eu/support",
              hasOnEmail: true,
            }),
          ],
          "/fake",
          { email: true },
        ),
        OUT,
      ),
    ).toThrow(/same email local part "support"/);
  });

  test("only agents with hasOnEmail appear in EMAIL_ROUTES", () => {
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
          }),
        ],
        "/fake",
        { email: true },
      ),
      OUT,
    );
    expect(out).toContain('"support": { agentName: "support-agent" }');
    expect(out).not.toContain('"chat": { agentName: "chat-agent" }');
  });

  test("emailResolverFile set: imports the user's custom resolver, omits default", () => {
    const out = generateEntry(
      mf([agent({ hasOnEmail: true })], "/fake", {
        email: true,
        emailResolverFile: "/fake/email.ts",
      }),
      OUT,
    );
    expect(out).toContain("import __ayjnt_emailResolver from");
    expect(out).toContain("resolver: __ayjnt_emailResolver");
    expect(out).not.toContain("__ayjntDefaultEmailResolver");
    expect(out).not.toContain("EMAIL_ROUTES");
  });

  // ---- Workflows ------------------------------------------------------------

  test("workflows: imports + re-exports each workflow class under its real name", () => {
    const out = generateEntry(
      mf([agent({})], "/fake", {}, [
        {
          className: "OrdersProcessing",
          binding: "ORDERS_PROCESSING",
          name: "orders-processing",
          sourceFile: "/fake/agents/orders/workflow.ts",
          baseClass: "AgentWorkflow",
        },
      ]),
      OUT,
    );
    expect(out).toContain(
      `import __ayjnt_workflow_0 from "../../agents/orders/workflow.ts";`,
    );
    expect(out).toContain(`export { __ayjnt_workflow_0 as OrdersProcessing };`);
  });

  test("no workflows: no workflow import / reexport", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).not.toContain("__ayjnt_workflow_");
    expect(out).not.toMatch(/import \w+ from "[^"]*workflow\.ts/);
  });

  test("co-located workflow: emits prototype patch pairing agent to binding", () => {
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
      OUT,
    );
    expect(out).toContain(
      `Object.defineProperty(__ayjnt_agent_0.prototype, "__ayjntWorkflowBinding", { value: "ORDERS_PROCESSING", enumerable: false });`,
    );
  });

  test("non-co-located workflow: no prototype patch emitted", () => {
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
      OUT,
    );
    expect(out).not.toContain("__ayjntWorkflowBinding");
  });
});

describe("root home app", () => {
  const withRootApp = (m: Manifest): Manifest => ({
    ...m,
    rootApp: { sourceFile: "/fake/agents/app.tsx", middlewareChain: [] },
  });

  test("rootAppFlat emits HOME_APP, the / branch, and the ASSETS binding", () => {
    const out = generateEntry(withRootApp(mf([agent({})])), {
      ...OUT,
      rootAppFlat: "__home",
    });
    expect(out).toContain("const HOME_APP");
    expect(out).toContain('flat: "__home"');
    expect(out).toContain('url.pathname === "/" && isHtmlRequest(request)');
    expect(out).toContain("ASSETS: Fetcher");
  });

  test("root middleware is threaded into HOME_APP via a deduped mw import", () => {
    const rootMw = "/fake/agents/middleware.ts";
    const m = mf([
      agent({ middlewareChain: [rootMw] }),
    ]);
    const out = generateEntry(
      { ...m, rootApp: { sourceFile: "/fake/agents/app.tsx", middlewareChain: [rootMw] } },
      { ...OUT, rootAppFlat: "__home" },
    );
    // Imported once, and HOME_APP references that same index.
    expect(out).toContain(`import __ayjnt_mw_0 from "../../agents/middleware.ts"`);
    expect(out).toContain("middleware: [__ayjnt_mw_0] }");
  });

  test("no root app → HOME_APP is null and there's no ASSETS binding", () => {
    const out = generateEntry(mf([agent({})]), OUT);
    expect(out).toContain(
      "const HOME_APP: { flat: string; middleware: Middleware<any>[] } | null = null;",
    );
    expect(out).not.toContain("ASSETS: Fetcher");
  });

  test("works with zero agents (home-only project)", () => {
    const out = generateEntry(withRootApp(mf([])), {
      ...OUT,
      rootAppFlat: "__home",
    });
    expect(out).toContain("type Binding = never");
    expect(out).toContain('flat: "__home"');
    expect(out).toContain("ASSETS: Fetcher");
  });
});
