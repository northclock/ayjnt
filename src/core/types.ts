// Shared types. The single source of truth for what the codegen pipeline passes
// between stages (scan → manifest → migration diff → wrangler/entry emission).

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
  /** Middleware files that apply to this agent, ordered root → leaf. Absolute paths. */
  middlewareChain: string[];
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
