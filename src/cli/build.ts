// ayjnt build — the codegen pipeline. Everything that dev and deploy do
// funnels through runBuild() so the behavior is identical across commands.
//
// Steps:
//   1. scan(root)                   → Manifest
//   2. readLockfile(root)           → MigrationLockfile
//   3. diffMigrations(lock, mf)     → MigrationDiff (nextEntry may be null)
//   4. applyDiff                    → finalLockfile (lockfile ∪ pending)
//   5. optionally writeLockfile     → persist the finalLockfile to disk
//   6. generateEntry → write .ayjnt/dist/entry.ts
//   7. generateWrangler → write .ayjnt/dist/wrangler.jsonc

import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { generateEntry } from "../codegen/entry.ts";
import {
  applyDiff,
  diffMigrations,
  formatDiff,
  readLockfile,
  writeLockfile,
} from "../codegen/migrations.ts";
import { scan } from "../codegen/scan.ts";
import { deriveWorkerName, generateWrangler } from "../codegen/wrangler.ts";
import { parseArgs } from "./util.ts";

export type RunBuildOptions = {
  cwd: string;
  /** Write the updated lockfile to disk. dev/build pass true; deploy passes
   *  false so the lockfile is never written during deploy (it must already
   *  be committed). */
  writeLockfile?: boolean;
  /** If false, suppress console output. Tests. */
  quiet?: boolean;
};

export type BuildResult = {
  /** .ayjnt/dist/wrangler.jsonc (absolute). */
  wranglerPath: string;
  /** .ayjnt/dist/entry.ts (absolute). */
  entryPath: string;
  /** True if a new migration was staged during this build. */
  staged: boolean;
  /** Count of agents in the emitted manifest. */
  agentCount: number;
};

export async function runBuild(opts: RunBuildOptions): Promise<BuildResult> {
  const cwd = path.resolve(opts.cwd);
  const shouldWrite = opts.writeLockfile ?? true;
  const quiet = opts.quiet ?? false;
  const log = (msg: string) => {
    if (!quiet) console.log(msg);
  };

  const manifest = await scan(cwd);
  const priorLock = await readLockfile(cwd);
  const diff = diffMigrations(priorLock, manifest);
  const finalLock = applyDiff(priorLock, diff);

  if (diff.nextEntry) {
    log(formatDiff(diff));
    if (shouldWrite) {
      await writeLockfile(cwd, finalLock);
      log("  → wrote .ayjnt/migrations.json");
    }
  }

  const outDir = path.join(cwd, ".ayjnt", "dist");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const entryPath = path.join(outDir, "entry.ts");
  const wranglerPath = path.join(outDir, "wrangler.jsonc");

  await Bun.write(entryPath, generateEntry(manifest, { outPath: entryPath }));

  const name = await resolveWorkerName(cwd);
  await Bun.write(
    wranglerPath,
    generateWrangler(manifest, finalLock, { name }),
  );

  log(
    `✓ ayjnt: ${manifest.agents.length} agent(s) → .ayjnt/dist/wrangler.jsonc`,
  );

  return {
    wranglerPath,
    entryPath,
    staged: !!diff.nextEntry,
    agentCount: manifest.agents.length,
  };
}

async function resolveWorkerName(cwd: string): Promise<string> {
  const pkgPath = path.join(cwd, "package.json");
  if (!existsSync(pkgPath)) return "worker";
  try {
    const pkg = (await Bun.file(pkgPath).json()) as { name?: string };
    if (typeof pkg.name === "string" && pkg.name.length > 0) {
      return deriveWorkerName(pkg.name);
    }
  } catch {
    // fall through
  }
  return "worker";
}

export async function build(argv: string[]): Promise<void> {
  const { cwd } = parseArgs(argv);
  await runBuild({ cwd });
}
