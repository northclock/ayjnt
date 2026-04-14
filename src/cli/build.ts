// ayjnt build — the codegen pipeline. Everything that dev and deploy do
// funnels through runBuild() so the behavior is identical across commands.
//
// Steps (in order — later steps depend on files from earlier ones):
//   1. scan(root)                                    → Manifest
//   2. readLockfile(root)                            → MigrationLockfile
//   3. diffMigrations                                → MigrationDiff
//   4. applyDiff                                     → finalLockfile
//   5. writeLockfile (optional — deploy skips this)
//   6. generateTsconfig  → .ayjnt/tsconfig.json
//   7. generateEnvTypes  → .ayjnt/env.d.ts
//   8. generateClientHook per agent → .ayjnt/client/<route>/index.tsx
//   9. Wipe .ayjnt/assets (stale bundles would ship to production otherwise)
//  10. For each agent with app.tsx:
//        bundle app.tsx → .ayjnt/assets/__ayjnt/<route-flat>/app.js
//        write HTML     → .ayjnt/assets/__ayjnt/<route-flat>/index.html
//  11. generateEntry (with assetRoutes map) → .ayjnt/dist/entry.ts
//  12. generateWrangler (with hasApps flag) → .ayjnt/dist/wrangler.jsonc

import { existsSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import {
  bundleApp,
  clientFileFor,
  flattenRoute,
  generateClientHook,
  generateEnvTypes,
  generateHtmlShell,
  generateTsconfig,
} from "../codegen/client.ts";
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
  /** Count of agents with a co-located app.tsx that got bundled. */
  appCount: number;
};

export async function runBuild(opts: RunBuildOptions): Promise<BuildResult> {
  const cwd = path.resolve(opts.cwd);
  const shouldWrite = opts.writeLockfile ?? true;
  const quiet = opts.quiet ?? false;
  const log = (msg: string) => {
    if (!quiet) console.log(msg);
  };

  // 1-5: manifest + migrations
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

  const dotDir = path.join(cwd, ".ayjnt");
  const outDir = path.join(dotDir, "dist");
  const clientDir = path.join(dotDir, "client");
  const assetsDir = path.join(dotDir, "assets");
  const assetsScoped = path.join(assetsDir, "__ayjnt");
  for (const dir of [dotDir, outDir, clientDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // 6: path-alias tsconfig (always the same content, but regenerated so
  //    users can't drift by editing it).
  await Bun.write(path.join(dotDir, "tsconfig.json"), generateTsconfig());

  // 7: GeneratedEnv type
  const envPath = path.join(dotDir, "env.d.ts");
  await Bun.write(envPath, generateEnvTypes(manifest, envPath));

  // 8: per-agent typed useAgent hooks. Must happen BEFORE bundling so the
  //    @ayjnt/<route> imports in user app.tsx resolve.
  for (const agent of manifest.agents) {
    const hookPath = path.join(dotDir, clientFileFor(agent));
    const hookDir = path.dirname(hookPath);
    if (!existsSync(hookDir)) mkdirSync(hookDir, { recursive: true });
    await Bun.write(hookPath, generateClientHook(agent, hookPath));
  }

  // 9: wipe the scoped assets tree so renamed/removed agents don't leave
  //    stale bundles behind (those would still ship to production via
  //    wrangler's assets upload).
  if (existsSync(assetsScoped)) {
    rmSync(assetsScoped, { recursive: true, force: true });
  }

  // 10: bundle + write assets for every agent that has an app.tsx.
  //     assetRoutes maps each binding → flat route segment so the
  //     generated entry.ts knows which asset path to fetch when serving
  //     HTML for that agent.
  const assetRoutes: Record<string, string> = {};
  let appCount = 0;
  for (const agent of manifest.agents) {
    if (!agent.hasApp) continue;
    const flat = flattenRoute(agent.routePath);
    const perRouteDir = path.join(assetsScoped, flat);
    mkdirSync(perRouteDir, { recursive: true });

    const appEntry = path.join(path.dirname(agent.sourceFile), "app.tsx");
    const bundledJs = await bundleApp({ appEntry, projectRoot: cwd });
    await Bun.write(path.join(perRouteDir, "app.js"), bundledJs);
    await Bun.write(
      path.join(perRouteDir, "index.html"),
      generateHtmlShell({
        title: agent.className,
        scriptSrc: `/__ayjnt/${flat}/app.js`,
      }),
    );
    assetRoutes[agent.binding] = flat;
    appCount++;
  }

  // 11-12: worker entry + wrangler config
  const entryPath = path.join(outDir, "entry.ts");
  const wranglerPath = path.join(outDir, "wrangler.jsonc");

  await Bun.write(
    entryPath,
    generateEntry(manifest, { outPath: entryPath, assetRoutes }),
  );

  const name = await resolveWorkerName(cwd);
  await Bun.write(
    wranglerPath,
    generateWrangler(manifest, finalLock, {
      name,
      hasApps: appCount > 0,
    }),
  );

  const appSuffix = appCount ? `, ${appCount} with UI` : "";
  log(
    `✓ ayjnt: ${manifest.agents.length} agent(s)${appSuffix} → .ayjnt/dist/wrangler.jsonc`,
  );

  return {
    wranglerPath,
    entryPath,
    staged: !!diff.nextEntry,
    agentCount: manifest.agents.length,
    appCount,
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
