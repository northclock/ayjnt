// ayjnt build — the codegen pipeline. Everything that dev and deploy do
// funnels through runBuild() so the behavior is identical across commands.
//
// Steps (in order — later steps depend on files from earlier ones):
//   1. scan(root)                                    → Manifest
//   2. readLockfile(root)                            → MigrationLockfile
//   3. diffMigrations                                → MigrationDiff
//   4. applyDiff                                     → finalLockfile
//   5. writeLockfile (optional — deploy skips this)
//   5b.syncDevVars(root, dist)                       → relative symlinks
//        in .ayjnt/dist/ pointing at the project-root .dev.vars{,.<env>}.
//        Required because wrangler resolves .dev.vars against the
//        wrangler.jsonc directory (configDir), not its cwd.
//   6. generateTsconfig  → .ayjnt/tsconfig.json
//   7. generateEnvTypes  → .ayjnt/env.d.ts
//   8. generateClientHook per agent → .ayjnt/client/<route>/index.tsx
//   9. Wipe .ayjnt/assets (stale bundles would ship to production otherwise)
//  10. For each agent with app.tsx:
//        bundle app.tsx → .ayjnt/assets/__ayjnt/<route-flat>/app.js
//        write HTML     → .ayjnt/assets/__ayjnt/<route-flat>/index.html
//  11. generateEntry (with assetRoutes map) → .ayjnt/dist/entry.ts
//  12. generateWrangler (with hasApps flag) → .ayjnt/dist/wrangler.jsonc

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import * as path from "node:path";
import {
  bundleApp,
  clientDirFor,
  clientFileFor,
  flattenRoute,
  generateClientHook,
  generateEnvTypes,
  generateHtmlShell,
  generateMountEntry,
  generateTsconfig,
  hasDefaultExport,
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
  /** Count of agents with a co-located docs.md that got embedded. */
  docsCount: number;
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

  // Wrangler resolves `.dev.vars` relative to the directory containing
  // wrangler.jsonc (configDir), not its cwd. Our generated config lives
  // in .ayjnt/dist/, so without this sync wrangler never sees the user's
  // project-root .dev.vars. Mirror every .dev.vars{,.<env>} into outDir.
  syncDevVars(cwd, outDir, log);

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
  //
  //     New in v0.5: if app.tsx exports a default React component, we
  //     generate a mount wrapper at .ayjnt/client/<route>/mount.tsx and
  //     bundle THAT instead of the user file. The wrapper owns
  //     createRoot + StrictMode + error boundary, so users never write
  //     mount boilerplate. If app.tsx has no default export we assume
  //     the legacy manual-mount pattern and bundle it directly, with a
  //     deprecation warning.
  const assetRoutes: Record<string, string> = {};
  let appCount = 0;
  for (const agent of manifest.agents) {
    if (!agent.hasApp) continue;
    const flat = flattenRoute(agent.routePath);
    const perRouteDir = path.join(assetsScoped, flat);
    mkdirSync(perRouteDir, { recursive: true });

    const userAppPath = path.join(path.dirname(agent.sourceFile), "app.tsx");
    const source = await Bun.file(userAppPath).text();

    let bundleEntry: string;
    if (hasDefaultExport(source)) {
      // Generated mount wrapper lives next to the typed useAgent hook
      // so both sit in the same client subtree.
      const mountDir = path.join(dotDir, clientDirFor(agent));
      if (!existsSync(mountDir)) mkdirSync(mountDir, { recursive: true });
      const mountPath = path.join(mountDir, "mount.tsx");
      const appImportPath = path
        .relative(path.dirname(mountPath), userAppPath)
        .replace(/\\/g, "/");
      const importSpec = appImportPath.startsWith(".")
        ? appImportPath
        : "./" + appImportPath;
      await Bun.write(
        mountPath,
        generateMountEntry({ appImportPath: importSpec }),
      );
      bundleEntry = mountPath;
    } else {
      log(
        `⚠ ayjnt: ${path.relative(cwd, userAppPath)} uses manual createRoot — deprecated. Export default your component; the framework will handle the mount.`,
      );
      bundleEntry = userAppPath;
    }

    const bundledJs = await bundleApp({
      appEntry: bundleEntry,
      projectRoot: cwd,
    });
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
  //
  // docs.md content is loaded once per agent and inlined as a string literal
  // in the generated entry so the worker can serve it from <route>/docs
  // without requiring an extra binding (Assets is optional). The catalog
  // endpoint uses each agent's hasDocs flag to expose the docsUrl.
  const entryPath = path.join(outDir, "entry.ts");
  const wranglerPath = path.join(outDir, "wrangler.jsonc");

  const docsByBinding: Record<string, string> = {};
  let docsCount = 0;
  for (const agent of manifest.agents) {
    if (!agent.hasDocs) continue;
    const docsPath = path.join(path.dirname(agent.sourceFile), "docs.md");
    docsByBinding[agent.binding] = await Bun.file(docsPath).text();
    docsCount++;
  }

  await Bun.write(
    entryPath,
    generateEntry(manifest, {
      outPath: entryPath,
      assetRoutes,
      docs: docsByBinding,
    }),
  );

  const name = await resolveWorkerName(cwd);
  // AYJNT_COMPATIBILITY_DATE lets users override the framework's pinned
  // default without forking — useful when they upgrade their wrangler
  // independently of ayjnt and want to opt into newer runtime behaviour.
  const compatibilityDate = process.env["AYJNT_COMPATIBILITY_DATE"];
  await Bun.write(
    wranglerPath,
    generateWrangler(manifest, finalLock, {
      name,
      hasApps: appCount > 0,
      ...(compatibilityDate ? { compatibilityDate } : {}),
    }),
  );

  const appSuffix = appCount ? `, ${appCount} with UI` : "";
  const docsSuffix = docsCount ? `, ${docsCount} with docs` : "";
  log(
    `✓ ayjnt: ${manifest.agents.length} agent(s)${appSuffix}${docsSuffix} → .ayjnt/dist/wrangler.jsonc`,
  );

  return {
    wranglerPath,
    entryPath,
    staged: !!diff.nextEntry,
    agentCount: manifest.agents.length,
    appCount,
    docsCount,
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

/**
 * Mirror every `.dev.vars` file from the project root into
 * `.ayjnt/dist/` so wrangler picks them up. Wrangler resolves
 * `.dev.vars` from the directory containing wrangler.jsonc (configDir),
 * not from its working directory — and our generated config lives in
 * `.ayjnt/dist/`. Without this sync the user's project-root
 * `.dev.vars` is invisible to wrangler, which is the original bug.
 *
 * Sync covers `.dev.vars` and any `.dev.vars.<env>` siblings
 * (for `wrangler dev --env <env>`). Files ending in `.example` are
 * skipped — those are checked-in samples, not real secrets.
 *
 * Strategy: relative symlink first (so wrangler sees live edits to the
 * source file with no rebuild), copy fallback for filesystems that
 * refuse symlinks (Windows without developer mode → EPERM). Stale
 * entries in dist from previous syncs are cleaned up — if the user
 * deletes `.dev.vars` from the project root, the mirror in dist goes
 * with it on the next build.
 *
 * Exported for testing.
 */
export function syncDevVars(
  projectRoot: string,
  distDir: string,
  log: (msg: string) => void = () => {},
): void {
  // Discover source files at project root: .dev.vars and .dev.vars.<env>,
  // excluding the conventional .example samples.
  const sources = existsSync(projectRoot)
    ? readdirSync(projectRoot).filter(
        (f) =>
          (f === ".dev.vars" || f.startsWith(".dev.vars.")) &&
          !f.endsWith(".example"),
      )
    : [];
  const sourceSet = new Set(sources);

  // Cleanup pass: remove any stale `.dev.vars*` previously synced into
  // dist that no longer have a project-root source. Without this, a
  // user who deletes `.dev.vars` would be surprised by wrangler still
  // loading the old values from a leftover mirror.
  if (existsSync(distDir)) {
    for (const entry of readdirSync(distDir)) {
      if (
        (entry === ".dev.vars" || entry.startsWith(".dev.vars.")) &&
        !sourceSet.has(entry)
      ) {
        try {
          rmSync(path.join(distDir, entry), { force: true });
        } catch {
          // Best-effort; non-fatal.
        }
      }
    }
  }

  for (const file of sources) {
    const src = path.join(projectRoot, file);
    const dest = path.join(distDir, file);

    // Wipe any prior mirror — symlink or copy — so we never accumulate
    // stale state. `force: true` makes rmSync silent on missing files
    // and on broken symlinks (which lstat would flag, but rm handles).
    try {
      rmSync(dest, { force: true });
    } catch {
      // Fall through; the symlink/copy below will surface real errors.
    }

    try {
      // Relative symlink keeps the dist dir movable with the project —
      // an absolute symlink would break if the user renames a parent
      // directory. The `"file"` arg is required on Windows but
      // harmless elsewhere.
      const rel = path.relative(distDir, src);
      symlinkSync(rel, dest, "file");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // EPERM is the Windows-without-developer-mode signature. Other
      // codes (EEXIST after a race, ENOSYS on exotic FSes) take the
      // same fallback — a snapshot copy. Mid-session edits to the
      // source won't auto-reload through a copy; we warn so the user
      // knows to re-run build after secret changes.
      try {
        copyFileSync(src, dest);
        log(
          `⚠ ayjnt: copied ${file} into .ayjnt/dist/ (symlink failed${
            code ? `: ${code}` : ""
          }). Edits to ${file} won't auto-reload — re-run ayjnt build after changes.`,
        );
      } catch (copyErr) {
        log(
          `⚠ ayjnt: failed to sync ${file} into .ayjnt/dist/ — wrangler will not see it. ` +
            `(${(copyErr as Error).message})`,
        );
      }
    }
  }
}

/** Helper for tests: tells whether a path in dist is currently a
 *  symlink to the project-root file, or a copy of it. */
export function devVarsSyncKind(
  distDir: string,
  filename: string,
): "symlink" | "copy" | "missing" {
  const p = path.join(distDir, filename);
  if (!existsSync(p)) return "missing";
  try {
    return lstatSync(p).isSymbolicLink() ? "symlink" : "copy";
  } catch {
    return "missing";
  }
}
