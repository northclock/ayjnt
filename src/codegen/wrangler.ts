// Wrangler config generator. Emits the JSON that wrangler dev/deploy reads.
// Written to <root>/.ayjnt/dist/wrangler.jsonc. Users never touch it.
//
// Inputs:
//   - manifest: drives durable_objects.bindings (name from binding, class_name
//     from className)
//   - lockfile: drives migrations (verbatim). Callers pass the lockfile AFTER
//     applying any diff, so any pending migration is already baked in.
//   - options: project name (from package.json, sanitized), compatibility
//     date, optional user overrides.

import type { Manifest, MigrationLockfile } from "../core/types.ts";

/**
 * Default compatibility date emitted into wrangler.jsonc.
 *
 * Pinned (NOT `new Date()`) on purpose. Two reasons:
 *
 *  1. **Deterministic builds.** Identical sources should produce identical
 *     wrangler.jsonc regardless of when the build runs. A clock-derived
 *     date breaks reproducibility and bloats the migration lockfile diff.
 *
 *  2. **Don't outrun the bundled workerd.** wrangler ships a workerd
 *     binary that supports compatibility dates only up to its build day.
 *     A `today()` default after that day produces:
 *
 *         ✘ This Worker requires compatibility date "YYYY-MM-DD", but
 *           the newest date supported by this server binary is "…".
 *
 * This date should be advanced when the framework's wrangler dep is
 * bumped, to a date the new wrangler's bundled workerd accepts. Users
 * who need a fresher date without forking can set the
 * `AYJNT_COMPATIBILITY_DATE` env var (read in src/cli/build.ts) or pass
 * `compatibilityDate` directly to `generateWrangler`.
 */
export const DEFAULT_COMPATIBILITY_DATE = "2025-11-21";

export type WranglerOptions = {
  /** Worker name. Must match `^[a-z0-9_-]+$`. */
  name: string;
  /** Compatibility date (YYYY-MM-DD). Defaults to {@link DEFAULT_COMPATIBILITY_DATE}. */
  compatibilityDate?: string;
  /** Additional compatibility flags. "nodejs_compat" is always included. */
  compatibilityFlags?: string[];
  /** User-supplied overrides merged into the output (e.g. routes, vars). */
  extras?: Record<string, unknown>;
  /** True when at least one agent has a co-located app.tsx. Triggers the
   *  `assets` config block so Cloudflare ships .ayjnt/assets/ as static
   *  files bound as `env.ASSETS`. */
  hasApps?: boolean;
};

/**
 * Generate a wrangler.jsonc string. The output is actually JSON with a
 * single leading comment — safe to write with a .jsonc extension and still
 * parse with JSON.parse after stripping the comment (which wrangler does).
 */
export function generateWrangler(
  manifest: Manifest,
  lockfile: MigrationLockfile,
  options: WranglerOptions,
): string {
  const {
    name,
    compatibilityDate = DEFAULT_COMPATIBILITY_DATE,
    compatibilityFlags = [],
    extras = {},
    hasApps = false,
  } = options;

  assertValidName(name);

  const flags = Array.from(
    new Set<string>(["nodejs_compat", ...compatibilityFlags]),
  );

  const config: Record<string, unknown> = {
    ...extras,
    $schema: "node_modules/wrangler/config-schema.json",
    name,
    main: "./entry.ts",
    compatibility_date: compatibilityDate,
    compatibility_flags: flags,
    durable_objects: {
      bindings: manifest.agents.map((a) => ({
        name: a.binding,
        class_name: a.className,
      })),
    },
    migrations: lockfile.migrations.map(stripUndefined),
  };

  // Workflows — emitted only when at least one workflow.ts was discovered.
  // Workflows don't have DO-style migrations: they're independent
  // Workflow-class bindings the runtime registers via `class_name`.
  if (manifest.workflows.length > 0) {
    config["workflows"] = manifest.workflows.map((w) => ({
      name: w.name,
      binding: w.binding,
      class_name: w.className,
    }));
  }

  // The assets config points wrangler at .ayjnt/assets/ (one level up from
  // wrangler.jsonc).
  //
  // - `not_found_handling: "none"` makes 404s fall through to the worker so
  //   agent requests reach the DO even though assets are served from the
  //   same origin.
  //
  // - `html_handling: "none"` is the critical bit: the default
  //   ("auto-trailing-slash") issues a 301 for "/__ayjnt/<flat>/index.html"
  //   → "/__ayjnt/<flat>/", which leaks into the browser URL bar. The
  //   worker's HTML dispatch does `env.ASSETS.fetch("/__ayjnt/<flat>/
  //   index.html")` and forwards the response; a redirect from ASSETS
  //   becomes a redirect the browser follows, so the user ends up at
  //   "/__ayjnt/<flat>/" instead of their intended "/<route>/<instanceId>"
  //   and the client-side useAgent hook can't derive the instance name
  //   from window.location.pathname. Setting it to "none" keeps the
  //   response as a plain 200 with the HTML body, the browser stays at
  //   the original URL, and the hook sees the right instance.
  if (hasApps) {
    config["assets"] = {
      directory: "../assets",
      binding: "ASSETS",
      not_found_handling: "none",
      html_handling: "none",
    };
  }

  // Browser tools opt-in. Any agent importing from `"ayjnt/browser"`
  // flips `manifest.features.browser`; we mirror that into the three
  // bindings Cloudflare's `createBrowserTools` requires plus the
  // `nodejs_compat` flag. The flag is added to the existing set so
  // any user-supplied compatibility flags are preserved.
  if (manifest.features.browser) {
    config["browser"] = { binding: "BROWSER" };
    config["worker_loaders"] = [{ binding: "LOADER" }];
    // `ai` may already be present via `extras` (e.g. a Voice agent
    // declared it). Don't clobber a user-set value.
    if (config["ai"] === undefined) {
      config["ai"] = { binding: "AI" };
    }
    // Spread into a fresh set so we don't mutate `flags` after it's
    // been written to the config above.
    if (!flags.includes("nodejs_compat")) {
      // Unreachable — `flags` always starts with `nodejs_compat` — but
      // keep the guard for paranoia in case the default changes.
      flags.push("nodejs_compat");
    }
  }

  // Email opt-in. Any agent with an `onEmail(email)` method flips
  // `manifest.features.email`; we mirror that into a `send_email`
  // binding so `this.sendEmail(...)` and `this.replyToEmail(...)`
  // resolve at runtime. The corresponding `email()` worker export
  // gets emitted by the entry generator.
  //
  // `remote: true` lets local dev send through Cloudflare's Email
  // Service so the round-trip works without a deployed worker.
  // Inbound delivery still requires an Email Routing rule in the
  // Cloudflare dashboard pointing at this worker.
  if (manifest.features.email) {
    config["send_email"] = [{ name: "EMAIL", remote: true }];
  }

  // Voice opt-in. Any agent using the `withVoice(...)` mixin from
  // `@cloudflare/voice` needs the Workers AI binding for its STT /
  // TTS providers (`WorkersAIFluxSTT`, `WorkersAITTS`, etc.). Reuses
  // the same `ai` block the browser feature would add — if both
  // flags are on, we only emit one AI binding.
  if (manifest.features.voice && config["ai"] === undefined) {
    config["ai"] = { binding: "AI" };
  }

  const header =
    "// GENERATED by ayjnt — do not edit. Regenerated on every `ayjnt build`.\n";
  return header + JSON.stringify(config, null, 2) + "\n";
}

function assertValidName(name: string): void {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid worker name "${name}". Wrangler requires lowercase letters, digits, hyphens, and underscores only.`,
    );
  }
}

/** Strip undefined fields from migration entries so JSON stays clean. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * Derive a wrangler-valid name from a package.json "name" field.
 *   "@scope/package" → "package"
 *   "My Cool App"    → "my-cool-app"
 */
export function deriveWorkerName(packageName: string): string {
  const withoutScope = packageName.replace(/^@[^/]+\//, "");
  return withoutScope
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
