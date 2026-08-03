// ayjnt build — the codegen pipeline. Everything that dev and deploy do
// funnels through runBuild() so the behavior is identical across commands.
//
// Ordering principle: do all FALLIBLE work (scanning, parsing, bundling)
// before any DESTRUCTIVE work (wiping directories), and commit the
// migration lockfile LAST — a build that dies halfway must not leave a
// staged migration for code that was never generated.
//
// Steps:
//   1. scan(root)                       → Manifest
//   2. readLockfile + diffMigrations    → MigrationDiff (nothing written yet)
//   3. write tsconfig / env.d.ts / per-agent hooks into a FRESH .ayjnt/client
//      (wiped first — stale hooks for renamed/deleted agents would keep
//      old @ayjnt/<route> imports compiling and silently target dead routes)
//   4. bundle every app.tsx into memory (the most failure-prone step —
//      nothing destructive has happened to the assets tree yet)
//   5. wipe .ayjnt/assets/__ayjnt and write the bundles + HTML shells
//   6. generateEntry  → .ayjnt/dist/entry.ts
//   7. generateWrangler → .ayjnt/dist/wrangler.jsonc
//   8. syncDevVars (wrangler resolves .dev.vars against the config dir)
//   9. write the lockfile (build/dev only — deploy verifies it's committed)

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
  type BundledApp,
} from "../codegen/client.ts";
import {
  assertNoReservedClientRoutes,
  generateCliTypes,
} from "../codegen/cli.ts";
import { generateEntry } from "../codegen/entry.ts";
import {
  generateWasmProxy,
  wasmProxyPath,
} from "../codegen/modules.ts";
import {
  applyDiff,
  diffChangesLockfile,
  diffMigrations,
  formatDiff,
  readLockfile,
  writeLockfile,
} from "../codegen/migrations.ts";
import { scan } from "../codegen/scan.ts";
import { deriveWorkerName, generateWrangler } from "../codegen/wrangler.ts";
import type { AgentEntry, Manifest } from "../core/types.ts";
import { parseArgs } from "./util.ts";

/** Reserved flat asset segment for the root agents/app.tsx UI. */
const ROOT_APP_FLAT = "__home";

export type RunBuildOptions = {
  cwd: string;
  /** Write the updated lockfile to disk. dev/build pass true; deploy passes
   *  false so the lockfile is never written during deploy (it must already
   *  be committed). */
  writeLockfile?: boolean;
  /** Don't auto-stage DELETIONS into the lockfile; warn instead. `ayjnt dev`
   *  sets this: its watcher rebuilds on every fs event, and a folder rename
   *  that reaches the differ in two builds (create-new-then-delete-old
   *  editors, a pause mid-rename, a transient state during git checkout)
   *  would otherwise stage deleted_classes in build N and new_sqlite_classes
   *  in build N+1 — two append-only entries that destroy the class's
   *  storage on deploy. Deletions stage only via an explicit `ayjnt build`. */
  deferDeletions?: boolean;
  /** If false, suppress console output. Tests. */
  quiet?: boolean;
};

export type BuildResult = {
  /** .ayjnt/dist/wrangler.jsonc (absolute). */
  wranglerPath: string;
  /** .ayjnt/dist/entry.ts (absolute). */
  entryPath: string;
  /** True if this build changes the lockfile (a new migration entry, or a
   *  folder move's re-keyed bookkeeping). */
  staged: boolean;
  /** Count of agents in the emitted manifest. */
  agentCount: number;
  /** Count of agents with a co-located app.tsx that got bundled. */
  appCount: number;
  /** Count of agents with a co-located docs.md that got embedded. */
  docsCount: number;
  /** The manifest this build was generated from. `ayjnt run` and
   *  `ayjnt compile` need it to configure the local runtime (DO bindings,
   *  workflows, host tools) without re-scanning. */
  manifest: Manifest;
};

export async function runBuild(opts: RunBuildOptions): Promise<BuildResult> {
  const cwd = path.resolve(opts.cwd);
  const shouldWrite = opts.writeLockfile ?? true;
  const quiet = opts.quiet ?? false;
  const log = (msg: string) => {
    if (!quiet) console.log(msg);
  };

  // 1-2: manifest + migration diff (computed now, written at the very end).
  const manifest = await scan(cwd);
  const priorLock = await readLockfile(cwd);
  const diff = diffMigrations(priorLock, manifest);
  const finalLock = applyDiff(priorLock, diff);
  if (diffChangesLockfile(diff)) {
    log(formatDiff(diff));
  }

  const dotDir = path.join(cwd, ".ayjnt");
  const outDir = path.join(dotDir, "dist");
  const clientDir = path.join(dotDir, "client");
  // Lives inside client/ so every existing project-wide `@ayjnt/*` path
  // mapping resolves Wasm proxies without a tsconfig migration.
  const modulesDir = path.join(clientDir, "modules");
  const assetsScoped = path.join(dotDir, "assets", "__ayjnt");

  // 3: client tree. Wiped first — it is fully regenerated below, and a
  // stale hook for a renamed/deleted agent would keep the user's old
  // `@ayjnt/<route>` import compiling against a route the worker no
  // longer serves.
  rmSync(clientDir, { recursive: true, force: true });
  for (const dir of [dotDir, outDir, clientDir, modulesDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  await Bun.write(path.join(dotDir, "tsconfig.json"), generateTsconfig());

  // Stable, depth-independent imports for root modules/**/*.wasm. Each proxy
  // preserves a static artifact import so Wrangler can discover and compile
  // only modules actually referenced by an agent or workflow.
  for (const wasm of manifest.wasmModules) {
    const proxyPath = path.join(modulesDir, wasmProxyPath(wasm));
    mkdirSync(path.dirname(proxyPath), { recursive: true });
    await Bun.write(proxyPath, generateWasmProxy(wasm, proxyPath));
  }

  const envPath = path.join(dotDir, "env.d.ts");
  await Bun.write(envPath, generateEnvTypes(manifest, envPath));

  // `@ayjnt/cli` — the typed context for a root-level cli.ts. Emitted
  // unconditionally: the types are useful for authoring cli.ts before the file
  // exists, and an unused generated module costs nothing (it's types-only).
  assertNoReservedClientRoutes(manifest);
  const cliTypesPath = path.join(clientDir, "cli.ts");
  await Bun.write(
    cliTypesPath,
    generateCliTypes(manifest, { outPath: cliTypesPath }),
  );

  // Per-agent typed useAgent hooks. Must exist on disk BEFORE bundling so
  // the @ayjnt/<route> imports in user app.tsx resolve.
  for (const agent of manifest.agents) {
    const hookPath = path.join(dotDir, clientFileFor(agent));
    mkdirSync(path.dirname(hookPath), { recursive: true });
    await Bun.write(hookPath, generateClientHook(agent, hookPath));
  }

  // 4: bundle every app.tsx into memory. If any bundle fails, the assets
  // tree from the previous successful build is still intact.
  assertUniqueAssetRoutes(manifest);
  const bundles: {
    agent: AgentEntry;
    flat: string;
    bundle: BundledApp;
  }[] = [];
  for (const agent of manifest.agents) {
    if (!agent.hasApp) continue;
    const userAppPath = path.join(path.dirname(agent.sourceFile), "app.tsx");
    bundles.push({
      agent,
      flat: flattenRoute(agent.routePath),
      bundle: await bundleUiApp({
        userAppPath,
        mountDir: path.join(dotDir, clientDirFor(agent)),
        cwd,
        log,
      }),
    });
  }

  // Root home app (agents/app.tsx), bundled the same way into the reserved
  // __home segment. null when there's no root app.
  let rootAppBundle: BundledApp | null = null;
  if (manifest.rootApp) {
    rootAppBundle = await bundleUiApp({
      userAppPath: manifest.rootApp.sourceFile,
      mountDir: path.join(dotDir, "client", ROOT_APP_FLAT),
      cwd,
      log,
    });
  }

  // 5: wipe the scoped assets tree and write the fresh bundles. The wipe
  // happens only now, after every bundle succeeded.
  rmSync(assetsScoped, { recursive: true, force: true });
  const assetRoutes: Record<string, string> = {};
  for (const { agent, flat, bundle } of bundles) {
    const perRouteDir = path.join(assetsScoped, flat);
    mkdirSync(perRouteDir, { recursive: true });
    await Bun.write(path.join(perRouteDir, "app.js"), bundle.entryJs);
    // Sibling outputs: CSS, hashed images/fonts, split chunks. The entry
    // references them by ./basename, so they live flat next to app.js.
    for (const extra of bundle.extras) {
      await Bun.write(path.join(perRouteDir, extra.fileName), extra.bytes);
    }
    await Bun.write(
      path.join(perRouteDir, "index.html"),
      generateHtmlShell({
        title: agent.className,
        scriptSrc: `/__ayjnt/${flat}/app.js`,
        styleSrcs: bundle.styles.map((name) => `/__ayjnt/${flat}/${name}`),
      }),
    );
    assetRoutes[agent.binding] = flat;
  }
  const appCount = bundles.length;

  // Root home app shares the same flat layout under the reserved segment.
  if (rootAppBundle) {
    const dir = path.join(assetsScoped, ROOT_APP_FLAT);
    mkdirSync(dir, { recursive: true });
    await Bun.write(path.join(dir, "app.js"), rootAppBundle.entryJs);
    for (const extra of rootAppBundle.extras) {
      await Bun.write(path.join(dir, extra.fileName), extra.bytes);
    }
    await Bun.write(
      path.join(dir, "index.html"),
      generateHtmlShell({
        title: "Home",
        scriptSrc: `/__ayjnt/${ROOT_APP_FLAT}/app.js`,
        styleSrcs: rootAppBundle.styles.map(
          (n) => `/__ayjnt/${ROOT_APP_FLAT}/${n}`,
        ),
      }),
    );
  }

  // 6-7: worker entry + wrangler config.
  //
  // docs.md content is loaded once per agent and inlined as a string literal
  // in the generated entry so the worker can serve it from <route>/docs
  // without requiring an extra binding (Assets is optional).
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
      rootAppFlat: rootAppBundle ? ROOT_APP_FLAT : undefined,
    }),
  );

  const name = await resolveWorkerName(cwd, log);
  // AYJNT_COMPATIBILITY_DATE lets users override the framework's pinned
  // default without forking — useful when they upgrade their wrangler
  // independently of ayjnt and want to opt into newer runtime behaviour.
  const compatibilityDate = process.env["AYJNT_COMPATIBILITY_DATE"];
  await Bun.write(
    wranglerPath,
    generateWrangler(manifest, finalLock, {
      name,
      hasApps: appCount > 0 || rootAppBundle !== null,
      ...(compatibilityDate ? { compatibilityDate } : {}),
    }),
  );

  // 8: wrangler resolves `.dev.vars` relative to the directory containing
  // wrangler.jsonc (configDir), not its cwd. Our generated config lives
  // in .ayjnt/dist/, so without this sync wrangler never sees the user's
  // project-root .dev.vars.
  syncDevVars(cwd, outDir, log);

  // 9: only now, with every artifact written, commit the lockfile.
  const staged = diffChangesLockfile(diff);
  if (staged && shouldWrite) {
    if (opts.deferDeletions && diff.deleted.length > 0) {
      log(
        `⚠ ayjnt: ${diff.deleted.map((d) => d.className).join(", ")} disappeared from agents/ — ` +
          `NOT staging the deletion (storage would be destroyed on deploy). ` +
          `If the removal is intentional, run \`ayjnt build\` to stage it.`,
      );
    } else {
      await writeLockfile(cwd, finalLock);
      log("  → wrote .ayjnt/migrations.json");
    }
  }

  const appSuffix = appCount ? `, ${appCount} with UI` : "";
  const docsSuffix = docsCount ? `, ${docsCount} with docs` : "";
  const homeSuffix = rootAppBundle ? `, home UI at /` : "";
  const wasmSuffix = manifest.wasmModules.length
    ? `, ${manifest.wasmModules.length} Wasm module(s)`
    : "";
  log(
    `✓ ayjnt: ${manifest.agents.length} agent(s)${appSuffix}${docsSuffix}${homeSuffix}${wasmSuffix} → .ayjnt/dist/wrangler.jsonc`,
  );

  return {
    wranglerPath,
    entryPath,
    staged,
    agentCount: manifest.agents.length,
    appCount,
    docsCount,
    manifest,
  };
}

/**
 * flattenRoute maps "/" to "_": "/admin/users" → "admin_users" — which
 * collides with a literal "/admin_users" route. Rare, but the collision
 * would silently serve one agent's UI bundle for both routes, so reject
 * it with the pair spelled out.
 */
function assertUniqueAssetRoutes(manifest: Manifest): void {
  const byFlat = new Map<string, AgentEntry>();
  for (const agent of manifest.agents) {
    if (!agent.hasApp) continue;
    const flat = flattenRoute(agent.routePath);
    const prior = byFlat.get(flat);
    if (prior) {
      throw new Error(
        `Routes ${prior.routePath} and ${agent.routePath} both flatten to the ` +
          `asset segment "${flat}" — their UI bundles would overwrite each other. ` +
          `Rename one of the folders.`,
      );
    }
    byFlat.set(flat, agent);
  }
  // The root home UI owns the reserved __home segment; an agent route that
  // flattens to it would clobber the home bundle (and vice versa).
  if (manifest.rootApp && byFlat.has(ROOT_APP_FLAT)) {
    throw new Error(
      `Agent route ${byFlat.get(ROOT_APP_FLAT)!.routePath} flattens to ` +
        `"${ROOT_APP_FLAT}", which is reserved for the root agents/app.tsx UI. ` +
        `Rename the folder.`,
    );
  }
}

/**
 * Bundle one UI `app.tsx`. If it default-exports a component we generate a
 * mount wrapper (createRoot + StrictMode + error boundary) and bundle that;
 * otherwise we bundle the file directly with a deprecation warning. Shared
 * by per-agent apps and the root home app so both follow the same rules.
 */
async function bundleUiApp(params: {
  userAppPath: string;
  mountDir: string;
  cwd: string;
  log: (msg: string) => void;
}): Promise<BundledApp> {
  const source = await Bun.file(params.userAppPath).text();
  let bundleEntry: string;
  if (hasDefaultExport(source)) {
    mkdirSync(params.mountDir, { recursive: true });
    const mountPath = path.join(params.mountDir, "mount.tsx");
    const rel = path
      .relative(params.mountDir, params.userAppPath)
      .replace(/\\/g, "/");
    const importSpec = rel.startsWith(".") ? rel : "./" + rel;
    await Bun.write(
      mountPath,
      generateMountEntry({ appImportPath: importSpec }),
    );
    bundleEntry = mountPath;
  } else {
    params.log(
      `⚠ ayjnt: ${path.relative(params.cwd, params.userAppPath)} uses manual createRoot — deprecated. Export default your component; the framework will handle the mount.`,
    );
    bundleEntry = params.userAppPath;
  }
  return bundleApp({ appEntry: bundleEntry, projectRoot: params.cwd });
}

/**
 * Worker name resolution: package.json "name" → sanitized; falls back to
 * the project directory's name, then a fixed default, when the package
 * name sanitizes to nothing (e.g. a non-Latin name). The fallback is
 * logged — a silently-defaulted name could clobber an unrelated worker
 * on deploy.
 */
async function resolveWorkerName(
  cwd: string,
  log: (msg: string) => void,
): Promise<string> {
  const pkgPath = path.join(cwd, "package.json");
  let fromPkg = "";
  if (existsSync(pkgPath)) {
    try {
      const pkg = (await Bun.file(pkgPath).json()) as { name?: string };
      if (typeof pkg.name === "string") {
        fromPkg = deriveWorkerName(pkg.name);
      }
    } catch {
      // unparseable package.json — fall through to the directory name
    }
  }
  if (fromPkg) return fromPkg;

  const fromDir = deriveWorkerName(path.basename(cwd));
  const name = fromDir || "ayjnt-worker";
  log(
    `⚠ ayjnt: package.json has no usable "name" — deploying as worker "${name}". ` +
      `Set "name" in package.json to control this.`,
  );
  return name;
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
