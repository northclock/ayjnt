// Shared types. The single source of truth for what the codegen pipeline passes
// between stages (scan → manifest → migration diff → wrangler/entry emission).

/**
 * One method on an agent class marked callable — primarily via Cloudflare's
 * `@callable()` decorator from `"agents"` (which also exposes the method to
 * browser clients), with the legacy `/** @callable *​/` JSDoc tag as a
 * catalog-only fallback. Surfaces in `/__ayjnt/catalog` so other agents and
 * external tooling can discover the public RPC surface (name, parameter
 * signature, return type, blurb).
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

/**
 * A co-located tool collection for one agent route — a set of functions the
 * agent can hand to a model as tool calls.
 *
 * Two runtimes, chosen by filename:
 *
 *   - `agents/<route>/tools.ts`      → executes inside workerd, alongside the
 *     agent. Deploys to Cloudflare like any other worker code.
 *   - `agents/<route>/tools.host.ts` → executes in the Bun host process via
 *     the `__AYJNT_HOST` bridge, so tools can use `Bun.$`, `Bun.file`,
 *     `bun:sqlite` and other native capabilities workerd does not have.
 *
 * The filename is the only signal — there is deliberately no `"use host"`
 * directive, because the path already carries that information. What DOES
 * get checked is the inverse mistake: a workerd-side `tools.ts` reaching for
 * a Bun/node-only global (see `detectHostOnlyGlobals`).
 *
 * Host tools cannot work on deployed Cloudflare — there is no host process
 * there — so `ayjnt deploy` refuses a project containing them unless the
 * file opts out via {@link HOST_TOOLS_OPTIONAL_MARKER}.
 */
export type ToolsEntry = {
  /** Absolute path to the tools.ts / tools.host.ts source file. */
  sourceFile: string;
  /** Which runtime executes the tool bodies. */
  runtime: "worker" | "host";
  /** Route path of the owning agent, e.g. "/research". Used to namespace
   *  tool names across agents on the host bridge. */
  routePath: string;
  /** True when a host tools file is marked as safe to omit from a deploy
   *  rather than blocking it. Always false for `runtime: "worker"`. */
  optionalOnDeploy: boolean;
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
  /** Whether the agent class implements an `onEmail(email)` method. Drives
   *  inclusion in the generated worker `email()` handler's resolver map. */
  hasOnEmail: boolean;
  /** True when the class is constructed via the `withVoice(...)` mixin
   *  from `@cloudflare/voice`. The generated typed React hook for this
   *  agent uses `useVoiceAgent` (with ayjnt URL routing) instead of the
   *  default `useAgent`. */
  isVoice: boolean;
  /** Middleware files that apply to this agent, ordered root → leaf. Absolute paths. */
  middlewareChain: string[];
  /** Co-located tool collections — at most one per runtime. Empty when the
   *  route has neither tools.ts nor tools.host.ts. Sorted worker-first for
   *  stable codegen output. */
  tools: ToolsEntry[];
  /** Name of the class this agent extends, as written in the source. We use
   *  this to detect McpAgent subclasses and route them differently — the
   *  Agents SDK provides a `.serve()` static for MCP that handles the MCP
   *  protocol (streamable-http, SSE) at the transport layer. */
  baseClass: string;
};

/** Features the project opts into by import or convention.
 *
 *  Each flag here triggers a corresponding wrangler.jsonc change. Computed
 *  workspace-wide during scan rather than per-agent because the bindings
 *  themselves are workspace-wide (one `browser` block in wrangler regardless
 *  of how many agents call `browserTools(this)`). */
export type FeatureFlags = {
  /** Any agent imports from `"ayjnt/browser"`. Adds `browser`,
   *  `worker_loaders`, and `ai` bindings + the `nodejs_compat` flag. */
  browser: boolean;
  /** Any agent implements `onEmail(email)`. Adds a `send_email` binding
   *  and emits an `email(message, env)` worker export with a generated
   *  resolver that maps the local part of the `to` address to an agent
   *  route, with optional `+suffix` for the DO instance id. */
  email: boolean;
  /** Absolute path to a user-supplied `email.ts` at the workspace root.
   *  When present, the generated entry imports the default-exported
   *  resolver from it instead of using the manifest-derived default. */
  emailResolverFile: string | null;
  /** Any agent uses the `withVoice(...)` mixin from `@cloudflare/voice`.
   *  Adds the `ai` binding (shared with the browser feature if both are
   *  on) and switches the generated React hook for those agents to a
   *  custom `useVoiceAgent` that connects via ayjnt's URL shape. */
  voice: boolean;
};

/** A single Cloudflare Workflow discovered in the file tree.
 *
 *  Workflows live in `workflow.ts` files, either co-located with an
 *  agent (`agents/<route>/workflow.ts`) or at the project root under
 *  `workflows/<name>/workflow.ts`. The default-exported class must
 *  extend `AgentWorkflow` or `WorkflowEntrypoint`. */
export type WorkflowEntry = {
  /** Exported class name as written in workflow.ts. Must match the
   *  wrangler binding's `class_name`. */
  className: string;
  /** Binding name on `env` — UPPER_SNAKE of the class name. */
  binding: string;
  /** Wrangler-side workflow `name` field. Kebab of the class. */
  name: string;
  /** Absolute path to the workflow.ts source file. */
  sourceFile: string;
  /** Name of the class this workflow extends — `AgentWorkflow` or
   *  `WorkflowEntrypoint` typically. */
  baseClass: string;
};

/** Optional root-level UI :)
 * `agents/app.tsx` - a home page served at `/`
 * gated gy the root middlewareChain. Sibling to ` agents/middleware.ts`
 */
export type RootApp = {
  //** Absolute path to `agents/app.tsx`
  sourceFile: string;
  /** Root middleware chain (root → leaf), same shape as
   *  AgentEntry.middlewareChain. The `/` UI runs through it. */
  middlewareChain: string[];
};

/** The full scan result. One per project. */
export type Manifest = {
  /** Project root (absolute). */
  root: string;
  /** All agents, in stable order (alphabetical by routePath). */
  agents: AgentEntry[];
  /** All workflows, in stable order (alphabetical by className). */
  workflows: WorkflowEntry[];
  /** Feature opt-ins detected from agent source — see {@link FeatureFlags}. */
  features: FeatureFlags;
  /** Root-level home UI, or null when there's no agent/app.tsx */
  rootApp?: RootApp | null;
  /** Absolute path to an optional root-level `cli.ts`, or null.
   *
   *  When present, `ayjnt run` (and a compiled binary) boots the worker under
   *  a local workerd and then invokes this file's default export in the
   *  foreground. When it returns, everything shuts down — including workerd.
   *  Never bundled into the worker: it runs in Bun, not in the Workers
   *  runtime. */
  cliFile?: string | null;
};

/** Marker a `tools.host.ts` can include to say "omit me from a deploy rather
 *  than blocking it". Recognized anywhere in the file's leading comments. */
export const HOST_TOOLS_OPTIONAL_MARKER = "@ayjnt-optional-on-deploy";

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
  /** Folder moves: the agentId changed but the className didn't. DO storage
   *  is keyed by class name, so no wrangler migration is needed — only the
   *  lockfile's bookkeeping key moves. Without this, a folder rename would
   *  emit delete+create of the same class and destroy all production
   *  storage. */
  moved: { fromAgentId: string; toAgentId: string; className: string }[];
  /** If non-empty, the next migration entry. null if no changes. */
  nextEntry: MigrationEntry | null;
};
