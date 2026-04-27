// Shared types. The single source of truth for what the codegen pipeline passes
// between stages (scan → manifest → migration diff → wrangler/entry emission).

/**
 * One method on an agent class flagged with the `@callable` JSDoc tag.
 * Surfaces in the catalog so other agents and external tooling can discover
 * the public RPC surface (name, parameter signature, return type, blurb).
 *
 * Parsed source-level — see `parseCallables` in src/codegen/scan.ts for
 * limitations.
 */
export type CallableMethod = {
  /** The method name, e.g. "decrement". */
  name: string;
  /** Raw parameter list as written between the parens, e.g. `"sku: string, qty: number"`.
   *  Empty string for nullary methods. */
  params: string;
  /** Raw return type as written after the colon, e.g. `"Promise<number>"`.
   *  `null` when no explicit return type annotation was present. */
  returnType: string | null;
  /** First non-tag line of the JSDoc block, used as a one-liner blurb in the
   *  catalog. `null` when the JSDoc had no description. */
  description: string | null;
};

/** A single agent discovered in the file tree. */
export type AgentEntry = {
  /** Stable identity used by the migration lockfile. Default derived from folderPath;
   *  override by exporting `agentId` from agent.ts. Renaming the folder is safe as
   *  long as this stays the same. */
  agentId: string;
  /** Exported class name, as written in agent.ts. Must match the DO binding class_name. */
  className: string;
  /** Path relative to agents/, e.g. "admin/users" (with route groups intact: "(public)/chat"). */
  folderPath: string;
  /** URL path, e.g. "/admin/users". Route groups like "(public)" are stripped. */
  routePath: string;
  /** UPPER_SNAKE of className — used as the DO binding name on `env`. */
  binding: string;
  /** Absolute path to the agent.ts source file. */
  sourceFile: string;
  /** Whether a co-located app.tsx exists. */
  hasApp: boolean;
  /** Whether a co-located docs.md exists. When true the framework serves
   *  the markdown at `<routePath>/docs` and exposes the URL in the catalog. */
  hasDocs: boolean;
  /** Methods on the agent class flagged with a `@callable` JSDoc tag.
   *  Surfaced in the agent catalog so callers can discover the RPC surface
   *  without reading source. Empty array when no `@callable` methods exist. */
  callables: CallableMethod[];
  /** Middleware files that apply to this agent, ordered root → leaf. Absolute paths. */
  middlewareChain: string[];
  /** Name of the class this agent extends, as written in the source. We use
   *  this to detect McpAgent subclasses and route them differently — the
   *  Agents SDK provides a `.serve()` static for MCP that handles the MCP
   *  protocol (streamable-http, SSE) at the transport layer. */
  baseClass: string;
};

/** The full scan result. One per project. */
export type Manifest = {
  /** Project root (absolute). */
  root: string;
  /** All agents, in stable order (alphabetical by routePath). */
  agents: AgentEntry[];
};

/** Committed to git at .ayjnt/migrations.json. Source of truth for what is in prod. */
export type MigrationLockfile = {
  version: 1;
  /** Append-only list of migrations already applied. Never edit past entries. */
  migrations: MigrationEntry[];
  /** Frozen snapshot of classes in prod after all migrations applied.
   *  Keyed by agentId for stable lookup across renames. */
  classes: Record<string, MigratedClass>;
};

export type MigrationEntry = {
  /** v1, v2, v3, ... — must be unique and monotonic. */
  tag: string;
  /** ISO timestamp of when this migration was generated. */
  timestamp: string;
  /** New agent classes added in this migration. Must use SQLite storage (Agents require it). */
  new_sqlite_classes?: string[];
  /** Renamed classes: { from, to } pairs. */
  renamed_classes?: { from: string; to: string }[];
  /** Classes removed in this migration. Storage is deleted — irreversible. */
  deleted_classes?: string[];
};

export type MigratedClass = {
  agentId: string;
  className: string;
  /** The migration tag where this class first appeared. For audit. */
  firstTag: string;
};

/** Result of diffing the current manifest against the lockfile. */
export type MigrationDiff = {
  /** New agents never seen before. */
  added: AgentEntry[];
  /** Classes whose className changed while agentId stayed the same. */
  renamed: { from: string; to: string; agentId: string }[];
  /** agentIds that were in the lockfile but aren't in the current manifest. */
  deleted: { agentId: string; className: string }[];
  /** If non-empty, the next migration entry. null if no changes. */
  nextEntry: MigrationEntry | null;
};
