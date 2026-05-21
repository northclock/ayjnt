// File tree scanner — walks <root>/agents/, finds every folder containing an
// agent.ts, extracts the default-exported class name (and optional agentId
// override), computes the route path, DO binding, and middleware chain, and
// returns a Manifest.
//
// Deliberately does NOT do full TS parsing — a line-based extractor is fast,
// predictable, and keeps the framework dependency-light. If users need
// anything exotic, an explicit `export const agentId = "..."` override works.

import { Glob } from "bun";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { AgentEntry, CallableMethod, Manifest } from "../core/types.ts";

export type { AgentEntry, CallableMethod };

/**
 * Scan the project for agents. Returns a Manifest with all discovered agents
 * sorted by routePath for stable output. Throws if duplicate routes, bindings,
 * or agent IDs are detected, or if an agent.ts file can't be parsed.
 */
export async function scan(root: string): Promise<Manifest> {
  const agentsDir = path.join(root, "agents");

  // Bun.file().exists() returns false for directories — use fs.
  if (!existsSync(agentsDir)) {
    return { root, agents: [] };
  }

  const glob = new Glob("**/agent.ts");
  const entries: AgentEntry[] = [];

  for await (const rel of glob.scan({ cwd: agentsDir })) {
    const agentFile = path.join(agentsDir, rel);
    const source = await Bun.file(agentFile).text();

    const parsed = parseAgentSource(source);
    if (!parsed) {
      throw new Error(
        `${agentFile}: could not find a default-exported class. Expected:\n  export default class <Name> extends Agent<...> { ... }`,
      );
    }

    const folderPath = normalizeSlashes(path.dirname(rel));
    const agentFolder = path.dirname(agentFile);
    const appFile = path.join(agentFolder, "app.tsx");
    const docsFile = path.join(agentFolder, "docs.md");

    entries.push({
      agentId: parsed.agentId ?? defaultAgentId(folderPath),
      className: parsed.className,
      baseClass: parsed.baseClass,
      folderPath,
      routePath: folderToRoute(folderPath),
      binding: classNameToBinding(parsed.className),
      sourceFile: agentFile,
      hasApp: existsSync(appFile),
      hasDocs: existsSync(docsFile),
      callables: parseCallables(source),
      middlewareChain: await resolveMiddlewareChain(agentFolder, root),
    });
  }

  entries.sort((a, b) => a.routePath.localeCompare(b.routePath));
  assertUnique(entries);

  return { root, agents: entries };
}

/**
 * Extract the default-exported class name, base class name, and (optional)
 * static agentId from an agent.ts source file. Returns null if no class
 * is found.
 *
 * Matches patterns like:
 *   export default class ChatAgent extends Agent { ... }
 *   export default class ChatAgent extends Agent<Env, State> { ... }
 *   export default class Tools extends McpAgent<Env, State> { ... }
 *   export const agentId = "chat_v1";
 *   export const agentId: string = "chat_v1";
 *
 * The base class is returned as-is from the source — we use "McpAgent" to
 * detect MCP agents at build time. If users alias imports (`import
 * { McpAgent as Mcp }`), detection won't trigger; that's a documented
 * limitation, not a bug.
 */
export function parseAgentSource(source: string): {
  className: string;
  baseClass: string;
  agentId: string | null;
} | null {
  const classMatch = source.match(
    /^[ \t]*export\s+default\s+class\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)/m,
  );
  if (!classMatch || !classMatch[1] || !classMatch[2]) return null;

  const idMatch = source.match(
    /^[ \t]*export\s+const\s+agentId\s*(?::\s*string)?\s*=\s*["'`]([^"'`]+)["'`]/m,
  );

  return {
    className: classMatch[1],
    baseClass: classMatch[2],
    agentId: idMatch?.[1] ?? null,
  };
}

/**
 * Find every method on the agent class that should appear in
 * `/__ayjnt/catalog`. Two markers trigger inclusion:
 *
 *   1. **`@callable()` decorator from `"agents"`** (primary). The same
 *      decorator that makes the method invocable from a browser client
 *      via `agent.stub.method(...)`. Including it in the catalog
 *      automatically means "what's reachable from the browser" and
 *      "what's discoverable in the catalog" stay in sync without the
 *      author maintaining two markers.
 *
 *      ```ts
 *      @callable({ description: "Decrement stock for a SKU." })
 *      async decrement(sku: string, qty: number): Promise<number> { … }
 *      ```
 *
 *      Also accepts the deprecated alias `@unstable_callable()` for
 *      compat with older SDK code.
 *
 *   2. **`/** @callable *\/` JSDoc tag** (legacy fallback). Useful when
 *      you want catalog visibility *without* exposing the method over
 *      WebSocket — e.g., a method other agents call via `getAgent<T>`
 *      that you still want advertised.
 *
 *      ```ts
 *      /**
 *       * Internal seed routine — listed in the catalog as a public
 *       * RPC method for agent-to-agent callers.
 *       * @callable
 *       *\/
 *      async seed(): Promise<void> { … }
 *      ```
 *
 * **Description precedence** when both markers are present (or when a
 * decorator has a plain JSDoc above it):
 *
 *   1. `@callable({ description: "…" })` — the decorator option
 *   2. First prose line of the JSDoc (with or without `@callable` tag)
 *      that immediately precedes the method or decorator
 *   3. `null`
 *
 * Long-form developer-facing JSDoc above a decorated method stays
 * available for editor hover regardless of which line ends up in the
 * catalog.
 *
 * Limitations (line-based, like everything else in scan.ts):
 *   - Parameter lists must fit on one line.
 *   - Return type may not span lines or contain top-level `{` (object
 *     literal types as the return annotation aren't supported).
 *   - Decorator-detection is source-level: aliased imports
 *     (`import { callable as cb }; @cb(...)`) aren't followed. Keep
 *     the import plain.
 *   - Decorator args with nested parens (e.g. an arrow function inside
 *     the options object) confuse the non-greedy capture. Stick to
 *     simple object literals in the decorator argument, or use the
 *     JSDoc-tag fallback.
 */
export function parseCallables(source: string): CallableMethod[] {
  // Method name → metadata. Methods discovered by both passes get merged
  // (decorator wins for description). Position-tracked so the final
  // result preserves source order.
  type Found = CallableMethod & { pos: number };
  const byName = new Map<string, Found>();

  const upsert = (
    name: string,
    pos: number,
    partial: Omit<CallableMethod, "name">,
    source: "jsdoc" | "decorator",
  ) => {
    const prior = byName.get(name);
    if (!prior) {
      byName.set(name, { name, pos, ...partial });
      return;
    }
    // Earliest position wins so source-order sort puts the method where
    // the first marker appears.
    if (pos < prior.pos) prior.pos = pos;
    // Description precedence: a non-null value from the decorator
    // overrides whatever JSDoc supplied. JSDoc only fills in when the
    // decorator left it null.
    if (source === "decorator" && partial.description !== null) {
      prior.description = partial.description;
    } else if (source === "jsdoc" && prior.description === null) {
      prior.description = partial.description;
    }
    // params/returnType: both passes captured the same method, so the
    // values should be identical. Keep the first.
  };

  // Modifier block shared by both passes — covers everything that can
  // legitimately sit between the marker and the method name.
  const MODIFIERS =
    "(?:public\\s+|private\\s+|protected\\s+)?(?:static\\s+)?(?:override\\s+)?(?:async\\s+)?";

  // -- Pass 1: JSDoc-tagged methods -----------------------------------------
  // Anchors on `/** … @callable … */` immediately followed by a method
  // declaration. The `(?:(?!\*\/)[\s\S])*?` guard prevents the JSDoc body
  // capture from spanning across an earlier JSDoc's `*/`.
  const jsdocRe = new RegExp(
    `\\/\\*\\*((?:(?!\\*\\/)[\\s\\S])*?@callable(?:(?!\\*\\/)[\\s\\S])*?)\\*\\/\\s*${MODIFIERS}([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)(?:\\s*:\\s*([^{=;\\n]+?))?\\s*\\{`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = jsdocRe.exec(source)) !== null) {
    upsert(
      m[2]!,
      m.index,
      {
        params: (m[3] ?? "").trim(),
        returnType: m[4] ? m[4].trim() : null,
        description: firstProseLine(m[1] ?? ""),
      },
      "jsdoc",
    );
  }

  // -- Pass 2: decorator-tagged methods -------------------------------------
  // Anchors on `@callable(args)` or `@unstable_callable(args)`. The args
  // capture is non-greedy `[\s\S]*?` — handles simple object literals,
  // breaks on nested parens (documented limitation).
  //
  // An optional preceding JSDoc block is captured so a plain JSDoc above
  // a decorated method (no `@callable` tag in the comment) can still
  // supply the description as a fallback.
  //
  // Optional middle group allows other decorators stacked between
  // `@callable(...)` and the method declaration.
  const decoratorRe = new RegExp(
    `(?:\\/\\*\\*((?:(?!\\*\\/)[\\s\\S])*?)\\*\\/\\s*)?` +
      `@(?:callable|unstable_callable)\\s*\\(([\\s\\S]*?)\\)\\s*` +
      `(?:@[A-Za-z_$][\\w$]*(?:\\s*\\([\\s\\S]*?\\))?\\s*)*` +
      `${MODIFIERS}([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)` +
      `(?:\\s*:\\s*([^{=;\\n]+?))?\\s*\\{`,
    "g",
  );
  while ((m = decoratorRe.exec(source)) !== null) {
    const jsdocBefore = m[1];
    const decoratorArgs = m[2] ?? "";
    const name = m[3]!;
    const params = (m[4] ?? "").trim();
    const returnType = m[5] ? m[5].trim() : null;

    const description =
      extractDecoratorDescription(decoratorArgs) ??
      (jsdocBefore != null ? firstProseLine(jsdocBefore) : null);

    upsert(name, m.index, { params, returnType, description }, "decorator");
  }

  return [...byName.values()]
    .sort((a, b) => a.pos - b.pos)
    .map(({ name, params, returnType, description }) => ({
      name,
      params,
      returnType,
      description,
    }));
}

/** First non-tag, non-empty line of a JSDoc body, with the leading
 *  ` * ` stripped. `@callable`, `@param ...`, and any other tag lines
 *  are skipped. */
function firstProseLine(jsdoc: string): string | null {
  for (const raw of jsdoc.split("\n")) {
    const line = raw.replace(/^\s*\*\s?/, "").trim();
    if (!line) continue;
    if (line.startsWith("@")) continue;
    return line;
  }
  return null;
}

/** Pull `description: "…"` out of a `@callable({ … })` argument string.
 *
 *  Looks for the `description` key with a string-literal value
 *  (double, single, or backtick-quoted). Returns the unescaped string,
 *  or `null` if the description key is absent or the value isn't a
 *  literal. Doesn't try to handle nested object shapes — anything
 *  weirder than `{ description: "…" }` falls back to JSDoc. */
function extractDecoratorDescription(args: string): string | null {
  const m = args.match(/description\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/);
  if (!m) return null;
  return m[2]!.replace(/\\(.)/g, (_, c) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    return c;
  });
}

/**
 * Convert a folder path (relative to agents/) to a URL route.
 * Route groups — path segments wrapped in parens like (public) — are stripped.
 *
 *   "chat"                 → "/chat"
 *   "admin/users"          → "/admin/users"
 *   "(public)/chat"        → "/chat"
 *   "admin/(internal)/log" → "/admin/log"
 */
export function folderToRoute(folderPath: string): string {
  const parts = normalizeSlashes(folderPath)
    .split("/")
    .filter((p) => p.length > 0 && !isRouteGroup(p));
  return "/" + parts.join("/");
}

/**
 * Derive the DO binding name from a PascalCase class name.
 *   ChatAgent        → CHAT_AGENT
 *   AdminUsersAgent  → ADMIN_USERS_AGENT
 *
 * Consecutive uppercase runs (acronyms) stay glued — HTTPServerAgent becomes
 * HTTPSERVER_AGENT. Users hitting this should rename the class; keeping the
 * rule simple beats clever acronym detection that surprises people.
 */
export function classNameToBinding(className: string): string {
  return className.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/** True when an agent extends McpAgent (by source-level name match). Users
 *  who import McpAgent under an alias aren't detected — documented
 *  limitation. */
export function isMcpAgent(entry: { baseClass: string }): boolean {
  return entry.baseClass === "McpAgent";
}

/**
 * Default agentId derived from folder path. Route groups stripped, slashes
 * to underscores, so renames of the folder are non-breaking as long as the
 * leaf folder name doesn't change.
 *
 *   "chat"                 → "chat"
 *   "admin/users"          → "admin_users"
 *   "(public)/chat"        → "chat"
 *
 * For rename-safety across folder moves, users should export an explicit
 * `agentId` from their agent.ts.
 */
export function defaultAgentId(folderPath: string): string {
  const parts = normalizeSlashes(folderPath)
    .split("/")
    .filter((p) => p.length > 0 && !isRouteGroup(p));
  return parts.join("_") || "_root";
}

/**
 * Collect every middleware.ts file from the project root down to the agent
 * folder. Returned in outer → inner order so the chain runs root first.
 *
 * Absolute paths returned so callers don't need to resolve against anything.
 */
export async function resolveMiddlewareChain(
  agentFolder: string,
  root: string,
): Promise<string[]> {
  const absRoot = path.resolve(root);
  const absFolder = path.resolve(agentFolder);

  if (!absFolder.startsWith(absRoot)) {
    throw new Error(
      `agent folder ${agentFolder} is outside project root ${root}`,
    );
  }

  // Walk up from the agent folder to (and including) root, collecting
  // middleware.ts along the way. Unshift so the result is root-first.
  const chain: string[] = [];
  let current = absFolder;
  while (true) {
    const mwPath = path.join(current, "middleware.ts");
    if (existsSync(mwPath)) {
      chain.unshift(mwPath);
    }
    if (current === absRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain;
}

// --- helpers ---------------------------------------------------------------

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function isRouteGroup(segment: string): boolean {
  return /^\(.+\)$/.test(segment);
}

function assertUnique(entries: AgentEntry[]): void {
  const seen = new Map<string, { kind: string; entry: AgentEntry }>();
  const check = (
    kind: "routePath" | "binding" | "agentId",
    value: string,
    entry: AgentEntry,
  ) => {
    const key = `${kind}:${value}`;
    const prior = seen.get(key);
    if (prior) {
      throw new Error(
        `Duplicate ${kind} "${value}"\n` +
          `  first:  ${prior.entry.sourceFile}\n` +
          `  second: ${entry.sourceFile}`,
      );
    }
    seen.set(key, { kind, entry });
  };

  for (const entry of entries) {
    check("routePath", entry.routePath, entry);
    check("binding", entry.binding, entry);
    check("agentId", entry.agentId, entry);
  }
}
