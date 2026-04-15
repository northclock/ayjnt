// ayjnt dev — initial build, watch agents/, debounced rebuild in parallel
// with `wrangler dev`.
//
// Wrangler already watches the files it bundles (entry.ts, agent.ts,
// middleware.ts) and reloads the worker on change. It also watches the
// assets directory for changes to bundled UIs. What it does NOT watch is
// the file-tree structure under agents/ — adding or renaming a folder
// doesn't re-run our codegen, so new agents wouldn't register as DOs and
// existing agents wouldn't pick up a newly-added app.tsx.
//
// We own that gap. The watcher here listens for anything that changes
// under agents/, debounces for 150ms, and re-invokes runBuild. That
// regenerates entry.ts, wrangler.jsonc, client hooks, and asset bundles.
// Wrangler notices the new files and reloads.
//
// Debounce + running/pending pattern: while a rebuild is running we
// don't launch a second one; we flip a pending flag and trigger exactly
// one more rebuild after the current finishes. Rapid saves coalesce,
// no queue buildup.

import { watch, type FSWatcher } from "node:fs";
import * as path from "node:path";
import { runBuild } from "./build.ts";
import { parseArgs, runWrangler } from "./util.ts";

const DEBOUNCE_MS = 150;

export async function dev(argv: string[]): Promise<void> {
  const { cwd, passthrough } = parseArgs(argv);

  // Initial build before wrangler starts — failures here should block
  // launch, so we don't swallow the throw.
  const result = await runBuild({ cwd });

  const watcher = startAgentsWatcher(cwd);

  // Wrangler dev inherits stdio and owns the foreground. When the user
  // hits Ctrl-C the signal reaches both the child and this process; we
  // close the watcher before exiting so the fs handle is released.
  const closeWatcher = () => {
    try {
      watcher.close();
    } catch {
      /* already closed */
    }
  };
  process.once("SIGINT", closeWatcher);
  process.once("SIGTERM", closeWatcher);
  process.once("exit", closeWatcher);

  const code = await runWrangler(
    "dev",
    ["--config", result.wranglerPath, ...passthrough],
    cwd,
  );
  closeWatcher();
  if (code !== 0) process.exit(code);
}

function startAgentsWatcher(cwd: string): FSWatcher {
  const agentsDir = path.join(cwd, "agents");

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
      await runBuild({ cwd, quiet: false });
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

  const watcher = watch(
    agentsDir,
    { recursive: true },
    (eventType, filename) => {
      if (!filename) return;
      // Restrict to files that can affect codegen. Ignore transient
      // editor artifacts (.swp, .DS_Store, ~), lockfiles, etc.
      if (!shouldRebuildFor(filename)) return;
      schedule(`${eventType}: ${filename}`);
    },
  );

  return watcher;
}

function shouldRebuildFor(filename: string): boolean {
  if (filename.startsWith(".")) return false; // dotfiles, .DS_Store
  if (filename.endsWith("~") || filename.endsWith(".swp")) return false;
  return (
    filename.endsWith(".ts") ||
    filename.endsWith(".tsx") ||
    // A new empty folder shows up as a rename event with no extension;
    // accept it so `mkdir agents/foo` before adding agent.ts doesn't
    // silently miss the subsequent file event on some platforms.
    !filename.includes(".")
  );
}
