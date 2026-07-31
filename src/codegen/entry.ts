// Worker entrypoint generator. Emits .ayjnt/dist/entry.ts — the actual worker
// the user's runtime runs on. We bypass routeAgentRequest and own the dispatch
// so URL shape stays under our control and nested routing / route groups work.
//
// The generated file is deliberately THIN: a route table, a class map, and a
// fetch handler that delegates to "ayjnt/router" (matchRoute, buildCatalog,
// isHtmlRequest, compose). All routing logic lives in src/runtime/router.ts
// where it is unit-tested — template strings can't be.
//
// Generated file:
//   - imports every agent class under a synthetic `__ayjnt_agent_<N>` name
//     and re-exports it under its real class name. The alias means user
//     class names can never collide with the entry's own identifiers (or
//     shadow globals like Response/URL); the re-export is what registers
//     the class with the DO runtime at the module boundary, and wrangler
//     resolves `class_name` against the EXPORT name, so registration works.
//   - imports every unique middleware.ts once as `__ayjnt_mw_<N>`
//   - builds a route table sorted longest-prefix first
//   - exports a default { fetch } (and an email handler when enabled)
//
// Why env.ASSETS instead of inlining HTML + JS strings:
//   Inlining a bundled ES module inside a <script type="module">…</script>
//   tag breaks whenever the minified bundle contains a literal
//   "</script>" substring (extremely common in regex bodies and string
//   contents). The HTML parser terminates the script tag early and the
//   rest of the bundle renders as raw text. Cloudflare Assets serves the
//   bundle as a standalone static file, bypasses the problem entirely,
//   and benefits from CDN caching on top.
//
// Why getAgentByName and not raw idFromName + get:
//   The Agent base class emits a CF_AGENT_IDENTITY WebSocket message on
//   connect with { name: this.name, agent: kebab(ClassName) }. The client
//   (useAgent / AgentClient / agentFetch) uses this to know which instance
//   it's talking to. The DO only learns its `name` when the server calls
//   `stub.setName(name)` — which is what getAgentByName does under the
//   hood. Skipping it means the DO has no `this.name`, and every identity
//   message to the client is wrong. See docs/README for client details.

import * as path from "node:path";
import type { AgentEntry, Manifest } from "../core/types.ts";
import { classNameToKebab, isMcpAgent } from "./scan.ts";

export type EntryOptions = {
  /** Absolute path where the generated entry.ts will be written. Used to
   *  compute relative imports of agent sources and middleware. */
  outPath: string;
  /** Map from agent binding → flat route segment (e.g. "admin_users").
   *  Only agents with a co-located app.tsx appear here. The segment is
   *  used to construct asset URLs like /__ayjnt/<flat>/index.html. */
  assetRoutes?: Record<string, string>;
  /** Map from agent binding → markdown contents of its co-located docs.md.
   *  Embedded as a string literal in the generated entry so the worker can
   *  serve it from `<routePath>/docs` without an extra binding. */
  docs?: Record<string, string>;
  /** Reserved flat asset segment for the root home UI (agents/app.tsx), or
   *  undefined when there's no root app. Set by build.ts after bundling. */
  rootAppFlat?: string;
};

export function generateEntry(
  manifest: Manifest,
  options: EntryOptions,
): string {
  const outDir = path.dirname(path.resolve(options.outPath));
  const agents = manifest.agents;
  const workflows = manifest.workflows;
  const assetRoutes = options.assetRoutes ?? {};
  const docsByBinding = options.docs ?? {};
  const hasApps =
    Object.keys(assetRoutes).length > 0 || !!options.rootAppFlat;
  const emailEnabled = manifest.features.email;
  const emailResolverFile = manifest.features.emailResolverFile;

  // Synthetic local names. User class names appear ONLY as export aliases
  // and string literals, so they can never collide with the identifiers
  // this file declares or with globals the dispatch code relies on.
  const agentLocal = new Map<AgentEntry, string>(
    agents.map((a, i) => [a, `__ayjnt_agent_${i}`]),
  );
  const workflowLocal = new Map(
    workflows.map((w, i) => [w, `__ayjnt_workflow_${i}`]),
  );

  // Collect unique middleware files across all agents, preserving first-seen
  // order. Each gets a stable `__ayjnt_mw_<N>` import name.
  const middlewareIndex = new Map<string, number>();
  for (const a of agents) {
    for (const mw of a.middlewareChain) {
      if (!middlewareIndex.has(mw)) middlewareIndex.set(mw, middlewareIndex.size);
    }
  }
  // The root home app's chain must be registered too, or its mw_<N> import
  // is never emitted — and with zero agents it'd be missed entirely.
  for (const mw of manifest.rootApp?.middlewareChain ?? []) {
    if (!middlewareIndex.has(mw)) middlewareIndex.set(mw, middlewareIndex.size);
  }

  // Sort routes longest-first so prefix matching picks the specific route.
  // /admin/users must beat /admin if both existed.
  const routes = [...agents].sort(
    (a, b) => b.routePath.length - a.routePath.length,
  );

  const agentImports = agents
    .map((a) => `import ${agentLocal.get(a)!} from "${toImportSpec(outDir, a.sourceFile)}";`)
    .join("\n");
  const agentReexports =
    agents.length === 0
      ? "// (no agents discovered)"
      : `export { ${agents.map((a) => `${agentLocal.get(a)!} as ${a.className}`).join(", ")} };`;

  // Workflows are imported + re-exported the same way agents are, so
  // wrangler's `workflows: [{ class_name }]` entries find them on the
  // module boundary. They don't appear in the route table — they're
  // triggered from agents via `this.workflow(...)` / `this.runWorkflow(...)`.
  const workflowImports = workflows
    .map((w) => `import ${workflowLocal.get(w)!} from "${toImportSpec(outDir, w.sourceFile)}";`)
    .join("\n");
  const workflowReexports =
    workflows.length === 0
      ? ""
      : `export { ${workflows.map((w) => `${workflowLocal.get(w)!} as ${w.className}`).join(", ")} };`;

  // For agents that have a co-located workflow.ts (same parent directory),
  // inject the workflow's binding name onto the agent's prototype. The
  // Ayjnt Agent base reads this at call time so users can write
  // `this.workflow(params)` without a magic binding string. The property
  // remains compatible with the deprecated `withWorkflow` mixin and is
  // non-enumerable so it doesn't show up in user-facing serialization.
  const workflowBindingPatches = workflows
    .map((w) => {
      const workflowDir = path.dirname(w.sourceFile);
      const pairedAgent = agents.find(
        (a) => path.dirname(a.sourceFile) === workflowDir,
      );
      if (!pairedAgent) return null;
      return `Object.defineProperty(${agentLocal.get(pairedAgent)!}.prototype, "__ayjntWorkflowBinding", { value: ${JSON.stringify(w.binding)}, enumerable: false });`;
    })
    .filter((s): s is string => s !== null)
    .join("\n");

  // Every Ayjnt Agent gets the same generated class → binding lookup. The
  // constructor is both the type-inference source and a runtime-safe key, so
  // `this.agent(InventoryAgent, "primary")` needs no string route or env field.
  const agentBindings = `new Map([${agents
    .map(
      (agent) =>
        `[${agentLocal.get(agent)!}, ${JSON.stringify(agent.binding)}]`,
    )
    .join(", ")}])`;
  const agentBindingPatches = agents
    .map(
      (agent) =>
        `Object.defineProperty(${agentLocal.get(agent)!}.prototype, "__ayjntAgentBindings", { value: ${agentBindings}, enumerable: false });`,
    )
    .join("\n");

  const middlewareImports = [...middlewareIndex.entries()]
    .map(([file, i]) => `import __ayjnt_mw_${i} from "${toImportSpec(outDir, file)}";`)
    .join("\n");

  // Workerd-side tool collections (`agents/<route>/tools.ts`). Imported as a
  // namespace and pinned to the agent's prototype, the same way workflow
  // bindings are, so `agentTools(this)` can find them without the user wiring
  // anything up. Host-side tools (`tools.host.ts`) are deliberately absent
  // here: their bodies run in Bun and must never enter the worker bundle —
  // the worker learns about them at runtime from the __AYJNT_HOST_TOOLS
  // binding instead.
  const toolAgents = agents
    .map((a) => ({
      agent: a,
      file: a.tools.find((t) => t.runtime === "worker")?.sourceFile,
    }))
    .filter((x): x is { agent: AgentEntry; file: string } => Boolean(x.file));

  const toolImports = toolAgents
    .map(
      ({ file }, i) =>
        `import * as __ayjnt_tools_${i} from "${toImportSpec(outDir, file)}";`,
    )
    .join("\n");

  const toolPatches = toolAgents
    .map(
      ({ agent }, i) =>
        `Object.defineProperty(${agentLocal.get(agent)!}.prototype, "__ayjntTools", { value: { ...__ayjnt_tools_${i} }, enumerable: false });`,
    )
    .join("\n");

  const routeEntries = routes
    .map((a) => {
      const chain = a.middlewareChain
        .map((f) => `__ayjnt_mw_${middlewareIndex.get(f)!}`)
        .join(", ");
      // docs.md content embedded as a string literal so docs serving doesn't
      // need an extra binding. JSON.stringify handles backticks/${} safely.
      // `?? null` (not truthiness) so an EMPTY docs.md is still served.
      const docs = docsByBinding[a.binding];
      const meta = JSON.stringify({
        agentId: a.agentId,
        className: a.className,
        routePath: a.routePath,
        hasApp: a.hasApp,
        hasDocs: a.hasDocs,
        isMcp: isMcpAgent(a),
      });
      return `  { prefix: ${JSON.stringify(a.routePath)}, binding: ${JSON.stringify(a.binding)}, middleware: [${chain}], isMcp: ${isMcpAgent(a)}, assetFlat: ${JSON.stringify(assetRoutes[a.binding] ?? null)}, docs: ${docs === undefined ? "null" : JSON.stringify(docs)}, callables: ${JSON.stringify(a.callables)}, meta: ${meta} },`;
    })
    .join("\n");

  const bindingUnion =
    agents.length === 0
      ? "never"
      : agents.map((a) => JSON.stringify(a.binding)).join(" | ");

  // Map binding → class for runtime reflection. Used by MCP dispatch to
  // call static methods (`CLASSES[binding].serve(...)`) on the class itself.
  const classMapEntries = agents
    .map((a) => `  ${JSON.stringify(a.binding)}: ${agentLocal.get(a)!},`)
    .join("\n");

  // Binding → route prefix, for MCP dispatch (McpAgent.serve needs the
  // path prefix as its first argument).
  const routePrefixEntries = agents
    .map((a) => `  ${JSON.stringify(a.binding)}: ${JSON.stringify(a.routePath)},`)
    .join("\n");

  // Root home UI (agents/app.tsx) — served at "/" through the root
  // middleware chain. The chain references reuse the same __ayjnt_mw_<N>
  // imports the route table uses.
  const rootAppChain = (manifest.rootApp?.middlewareChain ?? [])
    .map((f) => `__ayjnt_mw_${middlewareIndex.get(f)!}`)
    .join(", ");
  const homeAppConst = options.rootAppFlat
    ? `const HOME_APP: { flat: string; middleware: Middleware<any>[] } | null = { flat: ${JSON.stringify(options.rootAppFlat)}, middleware: [${rootAppChain}] };`
    : `const HOME_APP: { flat: string; middleware: Middleware<any>[] } | null = null;`;

  // Env is the DO bindings plus feature-derived bindings: the ASSETS
  // Fetcher when any agent has an app.tsx, the SendEmail binding when the
  // email feature is on (so `this.env.EMAIL` is reachable inside agents).
  const envExtras: string[] = [];
  if (hasApps) envExtras.push("ASSETS: Fetcher");
  if (emailEnabled) envExtras.push("EMAIL: SendEmail");
  const envType =
    envExtras.length > 0
      ? `Record<Binding, DurableObjectNamespace> & { ${envExtras.join("; ")} }`
      : `Record<Binding, DurableObjectNamespace>`;

  const emailImport = emailEnabled
    ? `import { routeAgentEmail } from "agents";\n`
    : "";
  const customResolverImport =
    emailEnabled && emailResolverFile
      ? `import __ayjnt_emailResolver from "${toImportSpec(outDir, emailResolverFile)}";\n`
      : "";

  return `// GENERATED by ayjnt — do not edit. Regenerated on every build.
import { getAgentByName } from "agents";
${emailImport}${customResolverImport}import {
  CATALOG_PATH,
  DOCS_SEGMENT,
  buildCatalog,
  compose,
  createContext,
  isHtmlRequest,
  matchRoute,
  type AgentRoute,
  type Middleware,
} from "ayjnt/router";
${middlewareImports}
${agentImports}
${workflowImports}
${toolImports}

${agentReexports}
${workflowReexports}

${agentBindingPatches}
${workflowBindingPatches}
${toolPatches}

type Binding = ${bindingUnion};

type Env = ${envType};

/** Route table, longest prefix first. All dispatch logic lives in
 *  "ayjnt/router" — this file only supplies the data. */
const ROUTES: AgentRoute[] = [
${routeEntries}
];

/** Binding → class object. Used by MCP dispatch which calls static methods
 *  (ClassName.serve(...)) on the class itself. */
const CLASSES: Record<Binding, any> = {
${classMapEntries}
};

/** Binding → route prefix. McpAgent.serve takes the prefix as its first arg. */
const ROUTE_PREFIX_BY_BINDING: Record<Binding, string> = {
${routePrefixEntries}
};

${homeAppConst}

export default {
  async fetch(
    request: Request,
    env: Env,
    executionCtx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Reserved global path: catalog. Probes every agent's middleware
    // (against a body-less GET marked x-ayjnt-probe) and returns only the
    // accessible set.
    if (url.pathname === CATALOG_PATH) {
      if (request.method !== "GET") {
        return new Response("method not allowed", {
          status: 405,
          headers: { allow: "GET" },
        });
      }
      return Response.json(
        await buildCatalog(ROUTES, request, env, executionCtx),
      );
    }

    // Root UI: agents/app.tsx is served at "/" for HTML navigations, gated by
    // the root middleware chain. A non-"/" path or a non-HTML request to "/"
    // falls through to the normal route match (which 404s "/" as before).
    if (HOME_APP && url.pathname === "/" && isHtmlRequest(request)) {
      const serveHome = async (): Promise<Response> => {
        const assetUrl = new URL(url);
        assetUrl.pathname = \`/__ayjnt/\${HOME_APP.flat}/index.html\`;
        return (env as any).ASSETS.fetch(new Request(assetUrl, request));
      };
      if (HOME_APP.middleware.length === 0) return serveHome();
      const c = createContext({
        request,
        url,
        env,
        executionCtx,
        params: { instanceId: "", pathSuffix: "/" },
      });
      return compose(HOME_APP.middleware, c, serveHome);
    }

    const match = matchRoute(ROUTES, url.pathname);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }
    const route = match.route;

    // Middleware runs for UI, docs, and agent dispatch alike, so admin auth
    // gates everything, not just the API. The dispatch choice happens
    // inside finalize, after all middleware has had a chance to short-circuit.
    const finalize = async (): Promise<Response> => {
      // Docs: serve the embedded markdown. 404 if no docs.md was authored.
      if (match.kind === "docs") {
        if (route.docs == null) {
          return new Response("docs not found", { status: 404 });
        }
        return new Response(route.docs, {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        });
      }

      if (route.isMcp) {
        // McpAgent.serve produces a { fetch } handler that manages the MCP
        // transport (streamable-http / SSE) and dispatches to the DO
        // internally. We forward the original request verbatim — MCP's
        // handler parses the path against the prefix we pass it.
        const handler = CLASSES[route.binding as Binding].serve(
          ROUTE_PREFIX_BY_BINDING[route.binding as Binding],
          { binding: route.binding },
        );
        return handler.fetch(request, env, executionCtx);
      }

      // HTML navigation for an agent with a co-located app.tsx: fetch the
      // pre-bundled shell from the Assets binding, keeping the user's URL
      // intact. The HTML references /__ayjnt/<flat>/* assets which are
      // served directly by Assets on their own (no worker trip).
      if (route.assetFlat && isHtmlRequest(request)) {
        const assetUrl = new URL(url);
        assetUrl.pathname = \`/__ayjnt/\${route.assetFlat}/index.html\`;
        return (env as any).ASSETS.fetch(new Request(assetUrl, request));
      }

      // getAgentByName does: idFromName → get → stub.setName(name). The
      // setName step is what teaches the DO its own identity so the
      // CF_AGENT_IDENTITY message to the client is correct.
      const stub = await getAgentByName(
        env[route.binding as Binding],
        match.instanceId,
      );
      const forwarded = new URL(url);
      forwarded.pathname = match.rest || "/";
      return stub.fetch(new Request(forwarded, request));
    };

    if (route.middleware.length === 0) return finalize();

    const c = createContext({
      request,
      url,
      env,
      executionCtx,
      params:
        match.kind === "agent"
          ? { instanceId: match.instanceId, pathSuffix: match.rest }
          : { instanceId: "", pathSuffix: "/" + DOCS_SEGMENT },
    });
    return compose(route.middleware, c, finalize);
  },${
    emailEnabled
      ? `

  /**
   * Email worker handler — invoked by Cloudflare's Email Routing rule
   * configured in the dashboard. Routes the inbound message to the
   * agent class that implements onEmail(), keyed by the local part of
   * the \`to\` address:
   *
   *   support@yourdomain.com           → SupportAgent (instance "default")
   *   support+room-42@yourdomain.com   → SupportAgent (instance "room-42")
   *
   * Sub-addressing (the \`+suffix\` form) is the standard RFC-5233 way
   * to pin instance ids without changing the bound address.
   *
   * Users who need a different resolution scheme can drop an \`email.ts\`
   * at the workspace root that default-exports an \`EmailResolver\` —
   * the codegen detects the file and imports it here instead.
   */
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    executionCtx: ExecutionContext,
  ): Promise<void> {
    await routeAgentEmail(message, env, {
      resolver: ${emailResolverFile ? "__ayjnt_emailResolver" : "__ayjntDefaultEmailResolver"},
    });
  },`
      : ""
  }
};${
    emailEnabled && !emailResolverFile
      ? `

/** Manifest-derived default resolver. Maps the local part of the email's
 *  \`to\` address to an agent (keyed by the LAST segment of the agent's
 *  route, lowercased — email local parts can't contain "/"), pulling an
 *  optional instance id from a \`+suffix\` sub-address. */
const EMAIL_ROUTES: Record<string, { agentName: string }> = {
${buildEmailRouteEntries(agents)}
};

async function __ayjntDefaultEmailResolver(
  message: ForwardableEmailMessage,
): Promise<{ agentName: string; agentId: string } | null> {
  const to = message.to ?? "";
  const at = to.indexOf("@");
  const local = at >= 0 ? to.slice(0, at) : to;
  // RFC 5233 sub-addressing: \`route+instance@host\`. Without a +suffix
  // we fall back to the canonical "default" DO instance.
  const plus = local.indexOf("+");
  const route = plus >= 0 ? local.slice(0, plus) : local;
  const instance = plus >= 0 ? local.slice(plus + 1) : "default";
  const entry = EMAIL_ROUTES[route.toLowerCase()];
  if (!entry) return null;
  return { agentName: entry.agentName, agentId: instance };
}`
      : ""
  }
`;
}

/**
 * Build the EMAIL_ROUTES map entries for agents that implement onEmail.
 *
 * Keys are the LAST route segment, lowercased — `agents/support/agent.ts`
 * answers `support@…`, and `agents/eu/support/agent.ts` would too. Email
 * local parts can't contain "/", so keying by the full route path (the
 * old behavior) made nested agents unreachable by mail. Throws when two
 * onEmail agents collide on the same local part, since silently routing
 * to one of them would lose mail.
 */
function buildEmailRouteEntries(agents: AgentEntry[]): string {
  const byLocalPart = new Map<string, AgentEntry>();
  for (const a of agents) {
    if (!a.hasOnEmail) continue;
    const leaf = a.routePath.split("/").filter(Boolean).pop() ?? "";
    const key = leaf.toLowerCase();
    const prior = byLocalPart.get(key);
    if (prior) {
      throw new Error(
        `Two agents with onEmail() resolve to the same email local part "${key}":\n` +
          `  ${prior.routePath} (${prior.sourceFile})\n` +
          `  ${a.routePath} (${a.sourceFile})\n` +
          `Rename one folder, or add a custom email.ts resolver at the project root.`,
      );
    }
    byLocalPart.set(key, a);
  }
  return [...byLocalPart.entries()]
    .map(
      ([key, a]) =>
        `  ${JSON.stringify(key)}: { agentName: ${JSON.stringify(classNameToKebab(a.className))} },`,
    )
    .join("\n");
}

/**
 * Build a module specifier for `import { ... } from "<spec>"` pointing from
 * the generated entry file to a source file. Always produces a forward-slash
 * path starting with "./" or "../".
 */
function toImportSpec(fromDir: string, toFile: string): string {
  const rel = path.relative(fromDir, path.resolve(toFile)).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : "./" + rel;
}
