// ayjnt dev — initial build, watch the codegen inputs, debounced rebuild in
// parallel with `wrangler dev`.
//
// Wrangler already watches the files it bundles (entry.ts, agent.ts,
// middleware.ts) and reloads the worker on change. It also watches the
// assets directory for changes to bundled UIs. What it does NOT watch is
// the file-tree structure our codegen derives from — adding or renaming a
// folder under agents/, dropping a docs.md, creating a root middleware.ts
// or email.ts, or adding a workflow.ts. None of those re-run codegen on
// their own, so new agents wouldn't register as DOs and existing agents
// wouldn't pick up newly-added companions.
//
// We own that gap. The watchers here listen for anything that changes in
// the codegen inputs, debounce for 150ms, and re-invoke runBuild. That
// regenerates entry.ts, wrangler.jsonc, client hooks, and asset bundles.
// Wrangler notices the new files and reloads.
//
// Debounce + running/pending pattern: while a rebuild is running we
// don't launch a second one; we flip a pending flag and trigger exactly
// one more rebuild after the current finishes. Rapid saves coalesce,
// no queue buildup.

import { existsSync, watch, type FSWatcher } from "node:fs";
import * as path from "node:path";
import { runBuild } from "./build.ts";
import { parseArgs, runWrangler } from "./util.ts";

const DEBOUNCE_MS = 150;

export async function dev(argv: string[]): Promise<void> {
  const { cwd, passthrough } = parseArgs(argv);

  // Initial build before wrangler starts — failures here should block
  // launch, so we don't swallow the throw. Deletions are never auto-staged
  // from dev (see RunBuildOptions.deferDeletions).
  const result = await runBuild({ cwd, deferDeletions: true });

  const watchers = startWatchers(cwd);

  // Wrangler dev inherits stdio and owns the foreground; runWrangler
  // forwards termination signals to it. We close the watchers once
  // wrangler exits (or we're signalled) so the fs handles are released.
  const closeWatchers = () => {
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
  };
  process.once("SIGINT", closeWatchers);
  process.once("SIGTERM", closeWatchers);
  process.once("exit", closeWatchers);

  const code = await runWrangler(
    "dev",
    ["--config", result.wranglerPath, ...passthrough],
    cwd,
  );
  closeWatchers();
  if (code !== 0) process.exit(code);
}

/**
 * Watch every codegen input:
 *   - agents/ (recursive)            — agent.ts, app.tsx, docs.md, middleware.ts
 *   - workflows/ (recursive)         — workflow.ts trees outside agents/
 *   - project root (non-recursive)   — middleware.ts and email.ts, which
 *     join the chain / email routing the moment they exist
 *
 * Missing directories are skipped with a hint instead of crashing —
 * `ayjnt dev` in a fresh folder used to die with a raw fs.watch ENOENT.
 */
function startWatchers(cwd: string): FSWatcher[] {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let pendingReason: string | null = null;

  const rebuild = async (reason: string) => {
    if (running) {
      pending = true;
      pendingReason = reason;
      return;
    }
    running = true;
    try {
      console.log(`\n[ayjnt] rebuilding (${reason})`);
      await runBuild({ cwd, quiet: false, deferDeletions: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ayjnt] rebuild failed: ${msg}`);
    } finally {
      running = false;
      if (pending) {
        const queued = pendingReason ?? "pending change";
        pending = false;
        pendingReason = null;
        // Defer to next tick so we don't recurse deep on a flurry of
        // events. Interlocks with the running flag in case another event
        // fires between finally and this setTimeout.
        setTimeout(() => rebuild(queued), 0);
      }
    }
  };

  const schedule = (reason: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => rebuild(reason), DEBOUNCE_MS);
  };

  const watchers: FSWatcher[] = [];

  const agentsDir = path.join(cwd, "agents");
  if (existsSync(agentsDir)) {
    watchers.push(
      watch(agentsDir, { recursive: true }, (eventType, filename) => {
        if (!filename || !shouldRebuildFor(filename)) return;
        schedule(`${eventType}: agents/${filename}`);
      }),
    );
  } else {
    console.warn(
      `[ayjnt] no agents/ directory at ${cwd} — create agents/<route>/agent.ts to add your first agent (file watching starts on next \`ayjnt dev\`)`,
    );
  }

  const workflowsDir = path.join(cwd, "workflows");
  if (existsSync(workflowsDir)) {
    watchers.push(
      watch(workflowsDir, { recursive: true }, (eventType, filename) => {
        if (!filename || !shouldRebuildFor(filename)) return;
        schedule(`${eventType}: workflows/${filename}`);
      }),
    );
  }

  // Root-level codegen inputs: a middleware.ts here joins every agent's
  // chain, and an email.ts overrides the generated email resolver — both
  // only take effect through a rebuild.
  // A cli.ts here is never bundled into the worker, but its presence changes
  // what codegen emits (`@ayjnt/cli` accessors), so it belongs in the watch set.
  watchers.push(
    watch(cwd, (eventType, filename) => {
      if (
        filename !== "middleware.ts" &&
        filename !== "email.ts" &&
        filename !== "cli.ts"
      )
        return;
      schedule(`${eventType}: ${filename}`);
    }),
  );

  return watchers;
}

function shouldRebuildFor(filename: string): boolean {
  const base = path.basename(filename);
  if (base.startsWith(".")) return false; // dotfiles, .DS_Store
  if (base.endsWith("~") || base.endsWith(".swp")) return false;
  return (
    filename.endsWith(".ts") ||
    filename.endsWith(".tsx") ||
    // docs.md is embedded into the worker at build time — without this,
    // editing docs served stale content until the next manual build.
    filename.endsWith(".md") ||
    // A new empty folder shows up as a rename event with no extension;
    // accept it so `mkdir agents/foo` before adding agent.ts doesn't
    // silently miss the subsequent file event on some platforms.
    !base.includes(".")
  );
}
