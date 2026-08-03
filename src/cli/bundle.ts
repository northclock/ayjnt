// Produce a workerd-ready bundle from the generated entry.
//
// We deliberately do NOT bundle the worker ourselves. `wrangler deploy
// --dry-run --outdir` runs wrangler's own esbuild pipeline, including the
// `@cloudflare/unenv-preset` polyfills that make `nodejs_compat` mean what
// agents expect it to mean. Reimplementing that with Bun's bundler would put
// bundling fidelity — the hardest thing to get right and the easiest thing to
// get subtly wrong — squarely on us.
//
// This runs at build time on a developer machine, where node_modules and
// wrangler are present. The resulting script is what `ayjnt run` hands to
// Miniflare and what `ayjnt compile` embeds, so a compiled binary never needs
// wrangler at runtime.
//
// `--dry-run` does not authenticate and does not touch the network, so this is
// safe in CI and offline.

import { existsSync, readdirSync } from "node:fs";
import * as path from "node:path";

export type BundleResult = {
  /** Absolute path to the bundled worker script. */
  scriptPath: string;
  /** Directory containing the script — Miniflare's `modulesRoot`. */
  bundleDir: string;
  /** Every JavaScript and WebAssembly module emitted by Wrangler, with the
   *  entry script first. Used by `compile` to embed the complete module graph. */
  modulePaths: string[];
};

export type BundleOptions = {
  cwd: string;
  /** Absolute path to the generated wrangler.jsonc. */
  wranglerPath: string;
  /** Directory to write the bundle into. Wiped by wrangler. */
  outDir: string;
  log?: (msg: string) => void;
};

/**
 * Run wrangler's bundler and return the emitted entry script.
 *
 * Wrangler's output is captured rather than inherited: on success it's noise
 * (a binding table and an upload size that never gets uploaded), and on failure
 * we want to attach it to a thrown error with context about which step failed.
 */
export async function bundleWorker(
  opts: BundleOptions,
): Promise<BundleResult> {
  const log = opts.log ?? (() => {});
  log("[ayjnt] bundling worker (wrangler --dry-run)…");

  const proc = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "deploy",
      "--config",
      opts.wranglerPath,
      "--dry-run",
      "--outdir",
      opts.outDir,
    ],
    {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      // Wrangler prints a telemetry notice and an update banner on first run;
      // neither is useful here and both muddy real error output.
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(
      `wrangler failed to bundle the worker (exit ${code}).\n\n` +
        `${stderr.trim() || stdout.trim()}\n\n` +
        `This is wrangler's own bundler, so the error above refers to your ` +
        `agent sources or their imports.`,
    );
  }

  const scriptPath = findEntryScript(opts.outDir);
  if (!scriptPath) {
    throw new Error(
      `wrangler reported success but no .js bundle appeared in ${opts.outDir}.\n\n` +
        `${stdout.trim()}`,
    );
  }

  return {
    scriptPath,
    bundleDir: opts.outDir,
    modulePaths: collectBundleModulePaths(scriptPath, opts.outDir),
  };
}

/** Collect the deployable module graph emitted by Wrangler. Source maps and
 *  metadata are intentionally excluded: workerd only needs JS and Wasm. */
export function collectBundleModulePaths(
  scriptPath: string,
  bundleDir: string,
): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.isFile() &&
        (entry.name.endsWith(".js") || entry.name.endsWith(".wasm"))
      ) {
        files.push(full);
      }
    }
  };
  if (existsSync(bundleDir)) walk(bundleDir);
  files.sort();
  return [scriptPath, ...files.filter((file) => file !== scriptPath)];
}

/**
 * Locate the bundle's entry script.
 *
 * Wrangler names it after `main` (so `entry.js` for our generated config), but
 * it also emits sourcemaps and may emit split chunks. Prefer `entry.js` and
 * fall back to the only remaining `.js` file rather than hardcoding the name.
 */
export function findEntryScript(outDir: string): string | null {
  if (!existsSync(outDir)) return null;
  const preferred = path.join(outDir, "entry.js");
  if (existsSync(preferred)) return preferred;

  const candidates = readdirSync(outDir).filter(
    (f) => f.endsWith(".js") && !f.endsWith(".map"),
  );
  if (candidates.length === 1) return path.join(outDir, candidates[0]!);
  return null;
}
