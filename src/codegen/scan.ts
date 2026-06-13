// File tree scanner — walks <root>/agents/, finds every folder containing an
// agent.ts, extracts the default-exported class name (and optional agentId
// override), computes the route path, DO binding, and middleware chain, and
// returns a Manifest.
//
// Deliberately does NOT do full TS parsing — a comment-aware, line-based
// extractor is fast, predictable, and keeps the framework dependency-light.
// If users need anything exotic, an explicit `export const agentId = "..."`
// override works.

import { Glob } from "bun";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type {
  AgentEntry,
  CallableMethod,
  FeatureFlags,
  Manifest,
  WorkflowEntry,
} from "../core/types.ts";

export type { AgentEntry, CallableMethod, WorkflowEntry };

/** Binding names the framework provisions itself (feature bindings and the
 *  assets Fetcher). An agent or workflow class whose derived binding lands
 *  on one of these would silently shadow the framework binding on `env`,
 *  so we reject it at scan time with a rename instruction. */
const RESERVED_BINDINGS = new Set([
  "BROWSER",
  "LOADER",
  "AI",
  "EMAIL",
  "ASSETS",
]);

/**
 * Scan the project for agents. Returns a Manifest with all discovered agents
 * sorted by routePath for stable output. Throws if duplicate routes, bindings,
 * or agent IDs are detected, or if an agent.ts file can't be parsed.
 */
export async function scan(root: string): Promise<Manifest> {
  const agentsDir = path.join(root, "agents");

  // Bun.file().exists() returns false for directories — use fs.
  if (!existsSync(agentsDir)) {
    return {
      root,
      agents: [],
      workflows: await scanWorkflows(root),
      features: emptyFeatures(),
      rootApp: null,
    };
  }

  const glob = new Glob("**/agent.ts");
  const entries: AgentEntry[] = [];
  const features: FeatureFlags = emptyFeatures();

  // A workspace-level `email.ts` (default export = EmailResolver) lets the
  // user override the manifest-derived default routing. Picked up here so
  // entry codegen can emit the right import.
  const emailFile = path.join(root, "email.ts");
  if (existsSync(emailFile)) {
    features.emailResolverFile = emailFile;
  }

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
    if (folderPath === ".") {
      throw new Error(
        `${agentFile}: agent.ts must live in a subfolder of agents/ — ` +
          `move it to agents/<route>/agent.ts so the folder name gives the agent its URL.`,
      );
    }
    const routePath = folderToRoute(folderPath);
    if (routePath === "/") {
      throw new Error(
        `${agentFile}: every segment of "${folderPath}" is a route group ` +
          `(parens are stripped from the URL), so the agent would map to "/", ` +
          `which ayjnt does not serve. Add a non-group folder segment, e.g. ` +
          `agents/${folderPath}/chat/agent.ts.`,
      );
    }

    const agentFolder = path.dirname(agentFile);
    const appFile = path.join(agentFolder, "app.tsx");
    const docsFile = path.join(agentFolder, "docs.md");

    const hasOnEmail = detectOnEmail(source);
    const isVoice = detectWithVoice(source);

    entries.push({
      agentId: parsed.agentId ?? defaultAgentId(folderPath),
      className: parsed.className,
      baseClass: parsed.baseClass,
      folderPath,
      routePath,
      binding: classNameToBinding(parsed.className),
      sourceFile: agentFile,
      hasApp: existsSync(appFile),
      hasDocs: existsSync(docsFile),
      callables: parseCallables(source),
      hasOnEmail,
      isVoice,
      middlewareChain: await resolveMiddlewareChain(agentFolder, root),
    });

    // Feature opt-ins — detected by source-level import or method. One
    // agent anywhere triggering a flag is enough to flip it on for the
    // whole workspace, because the wrangler bindings are workspace-wide.
    if (importsAyjntBrowser(source)) features.browser = true;
    if (hasOnEmail) features.email = true;
    // Any `@cloudflare/voice` import (mixin OR provider classes like
    // `WorkersAIFluxSTT`) needs the workspace's AI binding. The per-agent
    // `isVoice` flag stays tied to the `withVoice(` mixin specifically —
    // that's what drives the typed `useVoiceAgent` client hook codegen.
    if (isVoice || importsCloudflareVoice(source)) features.voice = true;
  }

  entries.sort((a, b) => a.routePath.localeCompare(b.routePath));
  assertUnique(entries);

  const workflows = await scanWorkflows(root);
  assertUniqueWorkflows(workflows, entries);

  /** Root middleware chain (root → leaf), same shape as
   *  AgentEntry.middlewareChain. The `/` UI runs through it. */

  const rootAppFile = path.join(agentsDir, "app.tsx");
  const rootApp = existsSync(rootAppFile)
    ? {
        sourceFile: rootAppFile,
        middlewareChain: await resolveMiddlewareChain(agentsDir, root),
      }
    : null;
  return { root, agents: entries, workflows, features, rootApp };
}

/**
 * Scan the project for workflow.ts files in the two locations the framework
 * recognises: co-located with an agent (`agents/<route>/workflow.ts`) or
 * under a top-level shared tree (`workflows/<name>/workflow.ts`).
 *
 * Deliberately NOT a whole-project glob — scanning from the root walked
 * node_modules on every rebuild and crashed on symlinked dev setups
 * (ENAMETOOLONG on self-referencing links).
 *
 * Exported for tests.
 */
export async function scanWorkflows(root: string): Promise<WorkflowEntry[]> {
  const entries: WorkflowEntry[] = [];

  for (const base of ["agents", "workflows"]) {
    const dir = path.join(root, base);
    if (!existsSync(dir)) continue;
    const glob = new Glob("**/workflow.ts");
    for await (const rel of glob.scan({ cwd: dir, onlyFiles: true })) {
      const file = path.join(dir, rel);
      const source = await Bun.file(file).text();
      const parsed = parseWorkflowSource(source);
      if (!parsed) continue;
      entries.push({
        className: parsed.className,
        baseClass: parsed.baseClass,
        binding: classNameToBinding(parsed.className),
        name: classNameToKebab(parsed.className),
        sourceFile: file,
      });
    }
  }

  entries.sort((a, b) => a.className.localeCompare(b.className));
  return entries;
}

/**
 * Extract the default-exported class name and base class from a
 * workflow.ts source file. Returns null when the file doesn't have a
 * default-exported class — we silently skip those, since `workflow.ts`
 * isn't a reserved name (a project might have unrelated files with
 * that name and we shouldn't error on them).
 *
 * Accepts `extends AgentWorkflow` (from `agents/workflows`) and
 * `extends WorkflowEntrypoint` (from `cloudflare:workers` — the raw
 * Cloudflare Workflow base class).
 */
export function parseWorkflowSource(source: string): {
  className: string;
  baseClass: string;
} | null {
  // Strip comments first so a block-commented old class can't shadow the
  // live declaration.
  const m = stripComments(source).match(
    /^[ \t]*export\s+default\s+class\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)/m,
  );
  if (!m || !m[1] || !m[2]) return null;
  // Only count classes whose base looks like a workflow. Same
  // source-level approach as `extends McpAgent` detection — aliased
  // imports are a documented limitation.
  const baseClass = m[2];
  if (baseClass !== "AgentWorkflow" && baseClass !== "WorkflowEntrypoint") {
    return null;
  }
  return { className: m[1], baseClass };
}

function assertUniqueWorkflows(
  workflows: WorkflowEntry[],
  agents: AgentEntry[],
): void {
  // Workflow binding names share a namespace with agent DO bindings.
  // Two `FOO` bindings would be ambiguous on `env.FOO` and conflict
  // in wrangler.jsonc, so we reject the collision early.
  const seen = new Map<string, string>();
  for (const a of agents) seen.set(a.binding, `agent ${a.sourceFile}`);
  for (const w of workflows) {
    assertNotReservedBinding(
      w.binding,
      w.className,
      `workflow ${w.sourceFile}`,
    );
    const prior = seen.get(w.binding);
    if (prior) {
      throw new Error(
        `Duplicate binding "${w.binding}"\n  first:  ${prior}\n  second: workflow ${w.sourceFile}`,
      );
    }
    seen.set(w.binding, `workflow ${w.sourceFile}`);
  }
}

/** Default-shape `FeatureFlags`. Centralised so the empty case stays in
 *  sync between the no-agents-dir bailout and the regular scan path. */
function emptyFeatures(): FeatureFlags {
  return {
    browser: false,
    email: false,
    emailResolverFile: null,
    voice: false,
  };
}

/**
 * Blank out comments while preserving everything else — including string
 * and template-literal CONTENTS, which the detectors below match against
 * (import specifiers are strings!).
 *
 * A single linear pass tracking string/comment state, so comment markers
 * inside strings (`"/* not a comment *​/"`) don't trigger stripping, and
 * string-looking text inside comments doesn't leak through. Comments are
 * replaced with spaces (newlines kept) so line/anchor-based regexes keep
 * their positions.
 *
 * Known limitation: regex literals aren't tracked (telling `/` division
 * from a regex start requires a real parser), so a regex containing `//`
 * blanks the rest of that line. None of the framework's detection targets
 * (imports, class declarations, method heads) can appear after a regex
 * literal on the same line, so this is harmless in practice.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";

  while (i < n) {
    const ch = source[i]!;
    const next = source[i + 1];
    switch (mode) {
      case "code":
        if (ch === "/" && next === "/") {
          mode = "line";
          out += "  ";
          i += 2;
        } else if (ch === "/" && next === "*") {
          mode = "block";
          out += "  ";
          i += 2;
        } else {
          if (ch === "'") mode = "single";
          else if (ch === '"') mode = "double";
          else if (ch === "`") mode = "template";
          out += ch;
          i++;
        }
        break;
      case "line":
        if (ch === "\n") {
          mode = "code";
          out += ch;
        } else {
          out += " ";
        }
        i++;
        break;
      case "block":
        if (ch === "*" && next === "/") {
          mode = "code";
          out += "  ";
          i += 2;
        } else {
          out += ch === "\n" ? "\n" : " ";
          i++;
        }
        break;
      case "single":
      case "double": {
        if (ch === "\\") {
          out += ch + (next ?? "");
          i += 2;
          break;
        }
        const quote = mode === "single" ? "'" : '"';
        if (ch === quote || ch === "\n") mode = "code";
        out += ch;
        i++;
        break;
      }
      case "template":
        if (ch === "\\") {
          out += ch + (next ?? "");
          i += 2;
          break;
        }
        if (ch === "`") mode = "code";
        out += ch;
        i++;
        break;
    }
  }
  return out;
}

/** True when the source imports anything from `@cloudflare/voice` (the
 *  package root or any subpath like `@cloudflare/voice/providers`).
 *  Used to flip the workspace `voice` feature flag — which provisions
 *  the `AI` binding in wrangler.jsonc — without falsely tagging the
 *  agent as a 1:1 voice agent.
 *
 *  This is broader than {@link detectWithVoice}: it fires for STT/TTS
 *  providers used outside the `withVoice` mixin too (e.g. a multi-party
 *  conference room that runs Whisper per participant). */
export function importsCloudflareVoice(source: string): boolean {
  return /\bimport\b[^;\n]*?(["'])@cloudflare\/voice(?:\/[^"']*)?\1/.test(
    stripComments(source),
  );
}

/** True when the source uses Cloudflare's `withVoice(...)` mixin from
 *  `@cloudflare/voice`. The detection is source-level — the user must
 *  literally write `withVoice(SomeBase)` for it to fire. Aliased
 *  imports (`import { withVoice as wv }`) are a documented limitation,
 *  same as `extends McpAgent` detection. */
export function detectWithVoice(source: string): boolean {
  // Comments are stripped so JSDoc examples don't trigger the flag.
  // Matches `withVoice(` as a function call — covers both
  // `class Foo extends withVoice(Agent) { … }` and
  // `const V = withVoice(Agent); class Foo extends V { … }`.
  return /\bwithVoice\s*\(/.test(stripComments(source));
}

/** True when the source declares an `onEmail` method anywhere on the
 *  class body. Same line-based heuristic as `parseCallables` — we look
 *  for the method declaration shape, not a full TS parse. */
export function detectOnEmail(source: string): boolean {
  // Comments are stripped so an example mentioning `onEmail` doesn't
  // trigger the flag. We require the opening `(` to differentiate from
  // a class field or variable named the same. The `async`/`override`/
  // modifier prefixes are optional in any order — we accept any subset.
  return /(?:^|[};{])\s*(?:public\s+|private\s+|protected\s+|override\s+|async\s+|static\s+)*onEmail\s*\(/m.test(
    stripComments(source),
  );
}

/** True when the source contains an `import` statement referencing the
 *  `"ayjnt/browser"` module specifier. Matches every import shape:
 *
 *    import { browserTools } from "ayjnt/browser";  // named
 *    import x from "ayjnt/browser";                  // default
 *    import * as x from "ayjnt/browser";             // namespace
 *    import "ayjnt/browser";                         // side-effect
 *
 *  Same source-level detection approach as `extends McpAgent`. Aliased
 *  re-exports (`import { browserTools as bt } from "…"`) still match
 *  because we anchor on the module specifier, not the binding name. */
export function importsAyjntBrowser(source: string): boolean {
  // `\bimport\b` requires an actual `import` keyword nearby; the
  // `[^;\n]*?` keeps the match within a single statement so a string
  // literal mentioning the path elsewhere (no preceding `import`)
  // doesn't trigger.
  return /\bimport\b[^;\n]*?(["'])ayjnt\/browser\1/.test(stripComments(source));
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
 * Comments are stripped before matching, so a block-commented old class
 * (or agentId) can't shadow the live one.
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
  const stripped = stripComments(source);

  const classMatch = stripped.match(
    /^[ \t]*export\s+default\s+class\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)/m,
  );
  if (!classMatch || !classMatch[1] || !classMatch[2]) return null;

  // The quote is captured and back-referenced so the value may contain the
  // OTHER quote characters ('it`s' is fine) and mismatched quotes don't
  // silently truncate the id.
  const idMatch = stripped.match(
    /^[ \t]*export\s+const\s+agentId\s*(?::\s*string)?\s*=\s*(["'`])((?:(?!\1).)+)\1/m,
  );

  return {
    className: classMatch[1],
    baseClass: classMatch[2],
    agentId: idMatch?.[2] ?? null,
  };
}

// Matches a (possibly nested-one-level) parenthesized chunk without
// backtracking blowup: the alternatives are disjoint on their first
// character, so failure is linear. Used for decorator args and parameter
// lists. Two-plus levels of nesting remain a documented limitation.
const PAREN_CHUNK = "(?:[^()]|\\([^()]*\\))*";

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
 * **Description precedence** when both markers are present (or when a
 * decorator has a plain JSDoc above it):
 *
 *   1. `@callable({ description: "…" })` — the decorator option
 *   2. First prose line of the JSDoc (with or without `@callable` tag)
 *      that immediately precedes the method or decorator
 *   3. `null`
 *
 * Limitations (line-based, like everything else in scan.ts):
 *   - Parameter lists and decorator arguments may contain parens nested
 *     at most ONE level deep (`cb: (x: number) => void` is fine;
 *     `cb: (x: (y: number) => void) => void` is not). The same goes for
 *     UNBALANCED parens inside string literals (`@callable({ description:
 *     "see :)" })`) — the paren matcher doesn't track strings, so such a
 *     method silently drops from the catalog. Use the JSDoc fallback or
 *     balance the parens.
 *   - Return type annotations may not contain top-level `{`, `=`, or
 *     newlines (object-literal and arrow types as the return annotation
 *     aren't supported — wrap them in a named type).
 *   - Decorator-detection is source-level: aliased imports
 *     (`import { callable as cb }; @cb(...)`) aren't followed. Keep
 *     the import plain.
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

  // Method head: name, params (one nesting level), optional return type.
  const METHOD_HEAD = `${MODIFIERS}([A-Za-z_$][\\w$]*)\\s*\\((${PAREN_CHUNK})\\)(?:\\s*:\\s*([^{=;\\n]+?))?\\s*\\{`;

  // -- Pass 1: JSDoc-tagged methods -----------------------------------------
  // Anchors on `/** … @callable … */` immediately followed by a method
  // declaration. The `(?:(?!\*\/)[\s\S])*?` guard prevents the JSDoc body
  // capture from spanning across an earlier JSDoc's `*/`.
  const jsdocRe = new RegExp(
    `\\/\\*\\*((?:(?!\\*\\/)[\\s\\S])*?@callable(?:(?!\\*\\/)[\\s\\S])*?)\\*\\/\\s*${METHOD_HEAD}`,
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
  // Anchors on `@callable(args)` or `@unstable_callable(args)`. Args and
  // any stacked decorators between the marker and the method use the
  // bounded PAREN_CHUNK — an unmatched `@callable(` fails in linear time
  // instead of backtracking exponentially across stacked decorators.
  //
  // An optional preceding JSDoc block is captured so a plain JSDoc above
  // a decorated method (no `@callable` tag in the comment) can still
  // supply the description as a fallback.
  const decoratorRe = new RegExp(
    `(?:\\/\\*\\*((?:(?!\\*\\/)[\\s\\S])*?)\\*\\/\\s*)?` +
      `@(?:callable|unstable_callable)\\s*\\((${PAREN_CHUNK})\\)\\s*` +
      `(?:@[A-Za-z_$][\\w$]*(?:\\s*\\(${PAREN_CHUNK}\\))?\\s*)*` +
      METHOD_HEAD,
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

/**
 * Derive the kebab-case name from a PascalCase class name. Matches the
 * Cloudflare Agents SDK's own kebab-casing, which is what
 * `routeAgentEmail`'s resolver expects in `EmailResolverResult.agentName`.
 *
 *   ChatAgent        → chat-agent
 *   AdminUsersAgent  → admin-users-agent
 *   HTTPServerAgent  → httpserver-agent   (acronyms stay glued — same
 *                                          documented trade-off as
 *                                          {@link classNameToBinding})
 */
export function classNameToKebab(className: string): string {
  return className.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
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
 * `agentId` from their agent.ts. (Moving a folder WITHOUT one is still
 * storage-safe as long as the class name is unchanged — the migration
 * differ recognises the move — but pinning the id keeps the lockfile
 * history tidy.)
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

  // path.relative-based containment: a bare startsWith would accept
  // sibling folders that share a name prefix (root "/a/b" matching
  // "/a/bc") and walk middleware from outside the project.
  const rel = path.relative(absRoot, absFolder);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
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

function assertNotReservedBinding(
  binding: string,
  className: string,
  where: string,
): void {
  if (RESERVED_BINDINGS.has(binding)) {
    throw new Error(
      `Class "${className}" (${where}) derives the binding name "${binding}", ` +
        `which ayjnt reserves for a framework binding ` +
        `(${[...RESERVED_BINDINGS].join(", ")} are reserved). Rename the class.`,
    );
  }
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
    assertNotReservedBinding(
      entry.binding,
      entry.className,
      `agent ${entry.sourceFile}`,
    );
    check("routePath", entry.routePath, entry);
    check("binding", entry.binding, entry);
    check("agentId", entry.agentId, entry);
  }
}
