// Worker entrypoint generator. Emits .ayjnt/dist/entry.ts — the actual worker
// the user's runtime runs on. We bypass routeAgentRequest and own the dispatch
// so URL shape stays under our control and nested routing / route groups work.
//
// Generated file:
//   - re-exports every agent class (required so DO can register them by name)
//     and also keeps a local reference to each class so MCP dispatch can call
//     `ClassName.serve(path, { binding }).fetch(...)`
//   - imports every unique middleware.ts file once
//   - builds a route table sorted longest-prefix first, with each route
//     carrying its own ordered middleware chain, optional `assetFlat` (for
//     agents with app.tsx), and an `isMcp` flag
//   - exports a default { fetch } that matches the route, runs the chain
//     via `compose`, then dispatches to:
//       1. McpAgent.serve(...).fetch(...)       if the agent is an MCP agent
//       2. env.ASSETS.fetch(<route>/index.html) if HTML is wanted and the
//                                               agent has an app.tsx
//       3. stub.fetch(...) via getAgentByName   in every other case
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
import type { Manifest } from "../core/types.ts";
import { isMcpAgent } from "./scan.ts";

export type EntryOptions = {
  /** Absolute path where the generated entry.ts will be written. Used to
   *  compute relative imports of agent sources and middleware. */
  outPath: string;
  /** Map from agent binding → flat route segment (e.g. "admin_users").
   *  Only agents with a co-located app.tsx appear here. The segment is
   *  used to construct asset URLs like /__ayjnt/<flat>/index.html. */
  assetRoutes?: Record<string, string>;
};

export function generateEntry(
  manifest: Manifest,
  options: EntryOptions,
): string {
  const outDir = path.dirname(path.resolve(options.outPath));
  const agents = manifest.agents;
  const assetRoutes = options.assetRoutes ?? {};
  const hasApps = Object.keys(assetRoutes).length > 0;

  // Collect unique middleware files across all agents, preserving first-seen
  // order. Each gets a stable `mw_<N>` import name.
  const middlewareIndex = new Map<string, number>();
  for (const a of agents) {
    for (const mw of a.middlewareChain) {
      if (!middlewareIndex.has(mw)) middlewareIndex.set(mw, middlewareIndex.size);
    }
  }

  // Sort routes longest-first so prefix matching picks the specific route.
  // /admin/users must beat /admin if both existed.
  const routes = [...agents].sort(
    (a, b) => b.routePath.length - a.routePath.length,
  );

  // Two-pronged import: we both need the class identity (for static method
  // calls like McpAgent.serve()) AND a re-export (so the DO runtime can
  // register the class by name at the module boundary). `import X` gives
  // us the local binding; `export { X }` hoists it into the module's exports.
  const agentImports = agents
    .map((a) => {
      const rel = toImportSpec(outDir, a.sourceFile);
      return `import ${a.className} from "${rel}";`;
    })
    .join("\n");

  const agentReexports =
    agents.length === 0
      ? "// (no agents discovered)"
      : `export { ${agents.map((a) => a.className).join(", ")} };`;

  const middlewareImports = [...middlewareIndex.entries()]
    .map(([file, i]) => `import mw_${i} from "${toImportSpec(outDir, file)}";`)
    .join("\n");

  const routeEntries = routes
    .map((a) => {
      const chain = a.middlewareChain
        .map((f) => `mw_${middlewareIndex.get(f)!}`)
        .join(", ");
      const mcp = isMcpAgent(a) ? "true" : "false";
      const assetFlat = assetRoutes[a.binding];
      const assetFlatValue = assetFlat
        ? JSON.stringify(assetFlat)
        : "null";
      return `  { prefix: ${JSON.stringify(a.routePath)}, binding: ${JSON.stringify(a.binding)}, middleware: [${chain}], isMcp: ${mcp}, assetFlat: ${assetFlatValue} },`;
    })
    .join("\n");

  const bindingUnion =
    agents.length === 0
      ? "never"
      : agents.map((a) => JSON.stringify(a.binding)).join(" | ");

  // Map binding → class for runtime reflection. Used by MCP dispatch to
  // call `CLASSES[binding].serve(...)`.
  const classMapEntries = agents
    .map((a) => `  ${JSON.stringify(a.binding)}: ${a.className},`)
    .join("\n");

  // Env is the DO bindings plus, if any agent has an app.tsx, the ASSETS
  // Fetcher binding wrangler provisions from the assets config.
  const envType = hasApps
    ? `Record<Binding, DurableObjectNamespace> & { ASSETS: Fetcher }`
    : `Record<Binding, DurableObjectNamespace>`;

  return `// GENERATED by ayjnt — do not edit. Regenerated on every build.
import { getAgentByName } from "agents";
import { compose, createContext, type Middleware } from "ayjnt/middleware";
${middlewareImports}
${agentImports}

${agentReexports}

type Binding = ${bindingUnion};

type Env = ${envType};

type Route = {
  prefix: string;
  binding: Binding;
  middleware: Middleware<any>[];
  /** True when the agent class extends McpAgent. MCP agents dispatch via
   *  the static \`.serve()\` handler instead of a direct DO fetch. */
  isMcp: boolean;
  /** Flat route segment for the assets tree, e.g. "admin_users". Null when
   *  the agent has no co-located app.tsx. */
  assetFlat: string | null;
};

const ROUTES: Route[] = [
${routeEntries}
];

/** Binding → class object. Used by MCP dispatch which calls static methods
 *  (ClassName.serve(...)) on the class itself. */
const CLASSES: Record<Binding, any> = {
${classMapEntries}
};

type Match = {
  binding: Binding;
  instanceId: string;
  rest: string;
  middleware: Middleware<any>[];
  isMcp: boolean;
  assetFlat: string | null;
};

function matchRoute(pathname: string): Match | null {
  for (const route of ROUTES) {
    if (
      pathname === route.prefix ||
      pathname.startsWith(route.prefix + "/")
    ) {
      const remainder = pathname.slice(route.prefix.length);
      const parts = remainder.split("/").filter(Boolean);
      // MCP agents don't use our instanceId scheme — the MCP transport
      // handles session management internally via headers. Accept the
      // route match even without an instance segment.
      if (route.isMcp) {
        return {
          binding: route.binding,
          instanceId: "",
          rest: remainder || "/",
          middleware: route.middleware,
          isMcp: true,
          assetFlat: route.assetFlat,
        };
      }
      const instanceId = parts[0];
      if (!instanceId) return null;
      const rest = "/" + parts.slice(1).join("/");
      return {
        binding: route.binding,
        instanceId,
        rest,
        middleware: route.middleware,
        isMcp: false,
        assetFlat: route.assetFlat,
      };
    }
  }
  return null;
}

/**
 * True when the client wants HTML (browser navigation), not a WebSocket
 * upgrade or HTTP API call. Used to pick HTML vs agent dispatch for the
 * same URL. Order of checks matters: \`Upgrade: websocket\` wins over
 * \`Accept: text/html\` even if both are set (some clients do).
 */
function isHtmlRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (
    request.headers.get("upgrade")?.toLowerCase() === "websocket"
  ) {
    return false;
  }
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

export default {
  async fetch(
    request: Request,
    env: Env,
    executionCtx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const match = matchRoute(url.pathname);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    // Middleware runs for both UI and agent dispatch so admin auth gates
    // the HTML too, not just the API. The choice between "serve HTML",
    // "forward to DO", and "MCP serve" happens inside finalize, after all
    // middleware has had a chance to short-circuit.
    const finalize = async (): Promise<Response> => {
      if (match.isMcp) {
        // McpAgent.serve produces a { fetch } handler that manages the MCP
        // transport (streamable-http / SSE) at the message level and
        // dispatches to the DO internally. We forward the original request
        // verbatim — MCP's handler parses the path against the prefix we
        // pass it to find the right session.
        const ClassRef = CLASSES[match.binding];
        const handler = ClassRef.serve(
          ROUTE_PREFIX_BY_BINDING[match.binding],
          { binding: match.binding },
        );
        return handler.fetch(request, env, executionCtx);
      }

      // HTML navigation for an agent with a co-located app.tsx: fetch the
      // pre-bundled shell from the Assets binding, keeping the user's URL
      // intact. The HTML references /__ayjnt/<flat>/app.js which is served
      // directly by Assets on its own (no worker trip).
      if (match.assetFlat && isHtmlRequest(request)) {
        const assetUrl = new URL(url);
        assetUrl.pathname = \`/__ayjnt/\${match.assetFlat}/index.html\`;
        return (env as any).ASSETS.fetch(new Request(assetUrl, request));
      }

      // getAgentByName does: idFromName → get → stub.setName(name). The
      // setName step is what teaches the DO its own identity so the
      // CF_AGENT_IDENTITY message to the client is correct.
      const stub = await getAgentByName(env[match.binding], match.instanceId);
      const forwarded = new URL(url);
      forwarded.pathname = match.rest || "/";
      return stub.fetch(new Request(forwarded, request));
    };

    if (match.middleware.length === 0) return finalize();

    const c = createContext({
      request,
      url,
      env,
      executionCtx,
      params: { instanceId: match.instanceId, pathSuffix: match.rest },
    });
    return compose(match.middleware, c, finalize);
  },
};

/** Binding → route prefix. Used for MCP dispatch (McpAgent.serve needs the
 *  path prefix as its first argument). */
const ROUTE_PREFIX_BY_BINDING: Record<Binding, string> = {
${agents.map((a) => `  ${JSON.stringify(a.binding)}: ${JSON.stringify(a.routePath)},`).join("\n")}
};
`;
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
