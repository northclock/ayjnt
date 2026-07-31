// ayjnt compile — pack the whole app into one executable.
//
// What goes in: the Bun runtime, workerd, the wrangler-produced worker bundle,
// every bundled UI asset, your cli.ts, your tools.host.ts modules, and the
// framework's local runtime. What's needed to run it: nothing.
//
// The output is roughly 170MB (≈57MB Bun + ≈103MB workerd + your code). That's
// the honest cost of shipping two runtimes in one file; `--no-embed-workerd`
// trades self-containment for ~67MB if the target machine already has workerd.
//
// HOW IT WORKS
//
// Two problems have to be solved, and neither is obvious:
//
//   1. `miniflare` does a top-level `require("workerd")`, and that package
//      resolves its native binary through `require.resolve` at module-load
//      time. Inside a compiled binary there is no node_modules, so the import
//      throws before miniflare's own `MINIFLARE_WORKERD_PATH` override is ever
//      consulted. The env var alone is NOT enough. We alias the `workerd`
//      module to a generated stub that reports the path we extracted to.
//
//   2. `import()` can't reach into the binary, so anything loaded dynamically
//      at runtime — cli.ts, tools.host.ts — must be imported statically by a
//      generated bootstrap so Bun's bundler can see and include it.
//
// The bootstrap then calls the SAME `runApp` that `ayjnt run` uses. Compile
// changes where inputs come from, never what happens to them.

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { runBuild } from "./build.ts";
import { bundleWorker } from "./bundle.ts";
import { parseGeneratedConfig, type GeneratedWranglerConfig } from "./host.ts";
import { hostToolFiles } from "../codegen/scan.ts";
import type { Manifest } from "../core/types.ts";

export type CompileArgs = {
  cwd: string;
  outfile?: string;
  target?: string;
  embedWorkerd: boolean;
  bytecode: boolean;
  minify: boolean;
};

export function parseCompileArgs(argv: string[]): CompileArgs {
  const result: CompileArgs = {
    cwd: process.cwd(),
    embedWorkerd: true,
    bytecode: false,
    minify: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const valueOf = (flag: string): string => {
      const v = a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : argv[++i];
      if (!v || v.startsWith("-")) {
        throw new Error(`${flag} requires a value (${flag} <value>)`);
      }
      return v;
    };
    if (a === "--cwd" || a.startsWith("--cwd=")) result.cwd = valueOf("--cwd");
    else if (a === "--outfile" || a.startsWith("--outfile="))
      result.outfile = valueOf("--outfile");
    else if (a === "--target" || a.startsWith("--target="))
      result.target = valueOf("--target");
    else if (a === "--no-embed-workerd") result.embedWorkerd = false;
    else if (a === "--bytecode") result.bytecode = true;
    else if (a === "--minify") result.minify = true;
    else throw new Error(`unknown option "${a}" for \`ayjnt compile\``);
  }
  return result;
}

export async function compile(argv: string[]): Promise<void> {
  const args = parseCompileArgs(argv);
  const cwd = path.resolve(args.cwd);
  const log = (m: string) => console.log(m);

  // 1. Codegen, exactly as build/run do.
  const built = await runBuild({ cwd, deferDeletions: true });
  const config = parseGeneratedConfig(
    await Bun.file(built.wranglerPath).text(),
  );
  warnOnUncompilableFeatures(built.manifest, config, log);

  // 2. Real wrangler produces the workerd-targeted bundle, while node_modules
  //    is still available to us.
  const compileDir = path.join(cwd, ".ayjnt", "compile");
  const bundleDir = path.join(compileDir, "bundle");
  const { scriptPath } = await bundleWorker({
    cwd,
    wranglerPath: built.wranglerPath,
    outDir: bundleDir,
    log,
  });

  // 3. Collect the assets tree, if any. Each file becomes both a build
  //    entrypoint and a `with { type: "file" }` import in the bootstrap —
  //    Bun's documented way to embed a directory.
  const assetsRoot = path.join(cwd, ".ayjnt", "assets");
  const assetFiles =
    config.assets && existsSync(assetsRoot) ? listFiles(assetsRoot) : [];

  // 4. workerd binary.
  let workerdPath: string | null = null;
  if (args.embedWorkerd) {
    workerdPath = await resolveWorkerdBinary(args.target);
    log(
      `[ayjnt] embedding workerd (${(statSync(workerdPath).size / 1024 / 1024).toFixed(0)}MB)`,
    );
  }

  // 5. Generate the bootstrap + the workerd stub.
  mkdirSync(compileDir, { recursive: true });
  const stubPath = path.join(compileDir, "workerd-stub.ts");
  await Bun.write(stubPath, generateWorkerdStub());

  const bootstrapPath = path.join(compileDir, "bootstrap.ts");
  await Bun.write(
    bootstrapPath,
    generateBootstrap({
      bootstrapDir: compileDir,
      cwd,
      manifest: built.manifest,
      config,
      scriptPath,
      assetsRoot,
      assetFiles,
      workerdPath,
    }),
  );

  // 6. Compile.
  const outfile = args.outfile ?? path.join(cwd, config.name);
  log(`[ayjnt] compiling → ${path.relative(cwd, outfile) || outfile}`);

  const result = await Bun.build({
    entrypoints: [bootstrapPath, ...assetFiles],
    target: "bun",
    minify: args.minify,
    // `sharp` is only ever reached by miniflare through a lazy
    // `await import("sharp")` inside a try/catch that degrades to a 503 on the
    // Images binding. Bundling a native module to satisfy a path we don't use
    // would be pure weight.
    external: ["sharp"],
    compile: {
      outfile,
      ...(args.target ? { target: args.target as never } : {}),
      ...(args.bytecode ? { bytecode: true } : {}),
    },
    plugins: [workerdAliasPlugin(stubPath)],
  });

  if (!result.success) {
    throw new Error(
      `compile failed:\n${result.logs.map((l) => String(l)).join("\n")}`,
    );
  }

  const size = statSync(outfile).size / 1024 / 1024;
  log(`✓ ayjnt: ${path.basename(outfile)} (${size.toFixed(0)}MB)`);
  if (built.manifest.cliFile) {
    log(`  cli.ts runs in the foreground; workerd stops when it returns.`);
  }
  const hostCount = hostToolFiles(built.manifest).length;
  if (hostCount > 0) {
    log(
      `  ${hostCount} host tool file(s) embedded — these work here but cannot be deployed.`,
    );
  }
}

/**
 * Bundle-time replacement for the `workerd` npm package.
 *
 * The real module resolves a native binary path through `require.resolve` when
 * it loads, which cannot work inside a compiled binary. This stub reports the
 * path the bootstrap extracted to instead. Miniflare consumes the default
 * export as the binary path and the two named exports for compatibility-date
 * checks, so those are all it needs to provide.
 */
export function workerdAliasPlugin(stubPath: string): {
  name: string;
  setup(build: { onResolve(o: { filter: RegExp }, cb: () => { path: string }): void }): void;
} {
  return {
    name: "ayjnt-workerd-alias",
    setup(build) {
      build.onResolve({ filter: /^workerd$/ }, () => ({ path: stubPath }));
    },
  };
}

function generateWorkerdStub(): string {
  return `\
// GENERATED by ayjnt — do not edit.
//
// Stands in for the \`workerd\` npm package inside a compiled binary. The real
// module resolves its native binary with \`require.resolve\` at load time, which
// has nothing to resolve against here. The bootstrap extracts workerd and sets
// AYJNT_WORKERD_PATH before anything imports miniflare, so by the time this
// module is evaluated the path is known.

const resolved = process.env["AYJNT_WORKERD_PATH"];
if (!resolved) {
  throw new Error(
    "ayjnt: workerd path unset. This binary was built with --no-embed-workerd, " +
      "so it needs a workerd binary on the host: set AYJNT_WORKERD_PATH to it.",
  );
}

export const compatibilityDate = process.env["AYJNT_WORKERD_COMPAT_DATE"] ?? "2000-01-01";
export const version = process.env["AYJNT_WORKERD_VERSION"] ?? "0.0.0";
export default resolved;
`;
}

type BootstrapOptions = {
  bootstrapDir: string;
  cwd: string;
  manifest: Manifest;
  config: GeneratedWranglerConfig;
  scriptPath: string;
  assetsRoot: string;
  assetFiles: string[];
  workerdPath: string | null;
};

/**
 * Emit the executable's entry module.
 *
 * Everything the app needs is either embedded as a file import or inlined as
 * JSON. The only runtime work is materializing the embedded files somewhere
 * workerd and Miniflare can open them, since both take paths rather than bytes.
 */
function generateBootstrap(opts: BootstrapOptions): string {
  const rel = (p: string) => {
    const r = path.relative(opts.bootstrapDir, path.resolve(p)).replace(/\\/g, "/");
    return r.startsWith(".") ? r : "./" + r;
  };

  const hostTools = hostToolFiles(opts.manifest);
  const workerdVersion = opts.workerdPath ? readWorkerdVersion() : null;

  const lines: string[] = [];
  lines.push(`// GENERATED by ayjnt — do not edit. Rebuilt on every \`ayjnt compile\`.
//
// Entry point of the compiled executable. Extracts the embedded runtime files,
// then hands off to the same runApp() that \`ayjnt run\` uses.

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { runApp } from "ayjnt/internal/run";
import { defaultDataDir, splitBinaryArgs } from "ayjnt/internal/host";`);

  lines.push(`import __workerScript from "${rel(opts.scriptPath)}" with { type: "file" };`);
  if (opts.workerdPath) {
    lines.push(`import __workerd from "${rel(opts.workerdPath)}" with { type: "file" };`);
  }
  for (const [i, file] of opts.assetFiles.entries()) {
    lines.push(`import __asset${i} from "${rel(file)}" with { type: "file" };`);
  }
  if (opts.manifest.cliFile) {
    lines.push(`import __cliMain from "${rel(opts.manifest.cliFile)}";`);
  }
  for (const [i, entry] of hostTools.entries()) {
    lines.push(`import * as __hostTools${i} from "${rel(entry.sourceFile)}";`);
  }

  // Asset paths are stored relative to the assets root so they can be
  // re-rooted at extraction time.
  const assetManifest = opts.assetFiles.map((f, i) => ({
    rel: path.relative(opts.assetsRoot, f).replace(/\\/g, "/"),
    ref: `__asset${i}`,
  }));

  lines.push(`
const CONFIG = ${JSON.stringify(opts.config)};
const MANIFEST = ${JSON.stringify(stripManifestForRuntime(opts.manifest))};
const ASSETS = [
${assetManifest.map((a) => `  { rel: ${JSON.stringify(a.rel)}, src: ${a.ref} },`).join("\n")}
];
const HOST_TOOL_MODULES = new Map([
${hostTools.map((t, i) => `  [${JSON.stringify(t.sourceFile)}, __hostTools${i}],`).join("\n")}
]);
const WORKERD_VERSION = ${JSON.stringify(workerdVersion?.version ?? null)};
const WORKERD_COMPAT_DATE = ${JSON.stringify(workerdVersion?.compatibilityDate ?? null)};

/**
 * Materialize an embedded file on disk, skipping the write when an identical
 * copy is already there.
 *
 * Matters most for workerd: it's ~103MB, and re-extracting it on every launch
 * would make startup miserable. Keyed by version so upgrading the binary
 * naturally invalidates the cache.
 */
async function materialize(src: string, dest: string): Promise<string> {
  const embedded = Bun.file(src);
  if (existsSync(dest)) {
    const onDisk = Bun.file(dest);
    if (onDisk.size === embedded.size) return dest;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  await Bun.write(dest, embedded);
  return dest;
}

async function main(): Promise<void> {
  const dataDir = process.env["AYJNT_DATA_DIR"] ?? defaultDataDir(CONFIG.name);
  const runtimeDir = path.join(dataDir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });

  // workerd first: the stub that miniflare imports reads this env var, and
  // miniflare must not be imported before it is set.
${
  opts.workerdPath
    ? `  const workerdDest = path.join(runtimeDir, "workerd-" + (WORKERD_VERSION ?? "embedded"));
  await materialize(__workerd, workerdDest);
  chmodSync(workerdDest, 0o755);
  process.env["AYJNT_WORKERD_PATH"] = workerdDest;
  if (WORKERD_VERSION) process.env["AYJNT_WORKERD_VERSION"] = WORKERD_VERSION;
  if (WORKERD_COMPAT_DATE) process.env["AYJNT_WORKERD_COMPAT_DATE"] = WORKERD_COMPAT_DATE;`
    : `  // Built with --no-embed-workerd: the host must provide the binary.
  if (!process.env["AYJNT_WORKERD_PATH"]) {
    console.error(
      "ayjnt: this binary was built with --no-embed-workerd.\\n" +
        "Set AYJNT_WORKERD_PATH to a workerd binary, or rebuild without that flag.",
    );
    process.exit(1);
  }`
}

  const scriptDest = path.join(runtimeDir, "worker.js");
  await materialize(__workerScript, scriptDest);

  let assetsDir: string | null = null;
  if (ASSETS.length > 0) {
    assetsDir = path.join(runtimeDir, "assets");
    for (const asset of ASSETS) {
      await materialize(asset.src, path.join(assetsDir, asset.rel));
    }
  }

  let own;
  try {
    own = splitBinaryArgs(process.argv.slice(2));
  } catch (err) {
    console.error("ayjnt: " + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
  await runApp({
    cwd: process.cwd(),
    config: CONFIG,
    manifest: MANIFEST,
    scriptPath: scriptDest,
    bundleDir: runtimeDir,
    assetsDir,
    cliMain: ${opts.manifest.cliFile ? "__cliMain" : "null"},
    hostToolModules: HOST_TOOL_MODULES,
    vars: {},
    port: own.port,
    dataDir: own.dataDir ?? dataDir,
    allowWrite: own.allowWrite,
    allowExec: own.allowExec,
    cliArgv: own.cliArgv,
  });
}

await main();
`);

  return lines.join("\n");
}

/** Trim the manifest to what the runtime actually reads. Callables, docs flags
 *  and middleware chains are build-time concerns already baked into the worker
 *  bundle, so carrying them would only bloat the binary. */
function stripManifestForRuntime(manifest: Manifest): unknown {
  return {
    root: manifest.root,
    agents: manifest.agents.map((a) => ({
      agentId: a.agentId,
      className: a.className,
      binding: a.binding,
      routePath: a.routePath,
      folderPath: a.folderPath,
      sourceFile: a.sourceFile,
      tools: a.tools,
      // Retained because scan-derived types require them; unused at runtime.
      hasApp: a.hasApp,
      hasDocs: a.hasDocs,
      callables: [],
      hasOnEmail: a.hasOnEmail,
      isVoice: a.isVoice,
      middlewareChain: [],
      baseClass: a.baseClass,
    })),
    workflows: manifest.workflows,
    features: manifest.features,
    rootApp: null,
    cliFile: manifest.cliFile ?? null,
  };
}

/** Read the installed workerd's version metadata, for cache keying. */
function readWorkerdVersion(): {
  version: string;
  compatibilityDate: string;
} | null {
  try {
    const mod = require("workerd") as {
      version?: string;
      compatibilityDate?: string;
    };
    if (mod.version && mod.compatibilityDate) {
      return { version: mod.version, compatibilityDate: mod.compatibilityDate };
    }
  } catch {
    // Fall through — version is only a cache key, not correctness.
  }
  return null;
}

/**
 * Find the native workerd binary for the requested target.
 *
 * Cross-compiling swaps Bun's runtime via `--target`, but the embedded workerd
 * is a native binary that must match the TARGET platform, not this one. Only
 * the host's `@cloudflare/workerd-*` optional dependency is installed by
 * default, so a mismatch has to fail loudly — silently embedding a macOS
 * workerd in a Linux binary would produce something that builds fine and dies
 * on first launch.
 */
export async function resolveWorkerdBinary(target?: string): Promise<string> {
  const pkg = workerdPackageFor(target);
  const subpath = pkg.endsWith("windows-64") ? "bin/workerd.exe" : "bin/workerd";
  try {
    return Bun.fileURLToPath(import.meta.resolve(`${pkg}/${subpath}`));
  } catch {
    throw new Error(
      [
        `could not find the workerd binary for ${target ?? "this platform"} (${pkg}).`,
        "",
        target
          ? `Cross-compiling needs the target's workerd, which isn't installed. Add it:\n\n  bun add -d ${pkg}\n`
          : `Install wrangler's workerd dependency, or run \`bun install\`.`,
        `Or build with --no-embed-workerd and provide one at runtime via AYJNT_WORKERD_PATH.`,
      ].join("\n"),
    );
  }
}

/** Map a Bun compile target to the workerd platform package. */
export function workerdPackageFor(target?: string): string {
  const key = target ?? `${process.platform}-${process.arch}`;
  const normalized = key
    .replace(/^bun-/, "")
    .replace(/-(baseline|modern)$/, "")
    .replace(/x64/, "64")
    .replace(/^darwin-arm64$/, "darwin-arm64")
    .replace(/^win32/, "windows");
  const table: Record<string, string> = {
    "darwin-arm64": "@cloudflare/workerd-darwin-arm64",
    "darwin-64": "@cloudflare/workerd-darwin-64",
    "linux-arm64": "@cloudflare/workerd-linux-arm64",
    "linux-64": "@cloudflare/workerd-linux-64",
    "windows-64": "@cloudflare/workerd-windows-64",
    "windows-arm64": "@cloudflare/workerd-windows-64",
  };
  const pkg = table[normalized];
  if (!pkg) {
    throw new Error(
      `no workerd build for target "${key}". Supported: ${Object.keys(table).join(", ")}.`,
    );
  }
  return pkg;
}

/** Every file under a directory, recursively, as absolute paths. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Warn about features that won't work in the compiled binary.
 *
 * Loud on purpose. These produce a binary that builds cleanly and then fails at
 * the first call, which is the worst place to learn about it.
 */
function warnOnUncompilableFeatures(
  manifest: Manifest,
  config: GeneratedWranglerConfig,
  log: (msg: string) => void,
): void {
  if (manifest.features.browser) {
    log(
      `⚠ ayjnt: this project uses browser tools (\`ayjnt/browser\`), which need a ` +
        `\`worker_loaders\` binding. The local runtime has no equivalent, so browser ` +
        `tools will fail in the compiled binary. Everything else still works.`,
    );
  }
  const remote: string[] = [];
  if (config.ai) remote.push("Workers AI");
  if (config.browser) remote.push("Browser Rendering");
  if (config.send_email?.length) remote.push("Email sending");
  if (remote.length > 0) {
    log(
      `⚠ ayjnt: ${remote.join(", ")} ${remote.length === 1 ? "is" : "are"} remote ` +
        `Cloudflare service${remote.length === 1 ? "" : "s"}. The binary is ` +
        `self-contained as a runtime, but ${remote.length === 1 ? "this feature" : "these features"} ` +
        `still need network access and credentials.`,
    );
  }
}
