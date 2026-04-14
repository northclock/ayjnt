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
import type { AgentEntry, Manifest } from "../core/types.ts";

export type { AgentEntry };

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

    entries.push({
      agentId: parsed.agentId ?? defaultAgentId(folderPath),
      className: parsed.className,
      baseClass: parsed.baseClass,
      folderPath,
      routePath: folderToRoute(folderPath),
      binding: classNameToBinding(parsed.className),
      sourceFile: agentFile,
      hasApp: existsSync(appFile),
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
