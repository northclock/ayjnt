// ayjnt run — boot the app the way a compiled binary does.
//
// codegen → wrangler bundle → local workerd → cli.ts in the foreground.
//
// The invariant worth protecting: `ayjnt run` and a binary from
// `ayjnt compile` execute the SAME code path (`runApp` below). Compile only
// changes where the inputs come from — embedded in the executable instead of
// read off disk. If they ever diverge, `cli.ts` starts behaving differently
// depending on how it was launched, which is precisely the failure this
// command exists to avoid.
//
// Contrast with `ayjnt dev`, which stays a thin wrapper around `wrangler dev`.
// That command keeps wrangler's behavior; this one keeps the binary's.

import * as path from "node:path";
import { runBuild } from "./build.ts";
import { bundleWorker } from "./bundle.ts";
import {
  parseGeneratedConfig,
  readDevVars,
  startHost,
  type GeneratedWranglerConfig,
  type RunningHost,
} from "./host.ts";
import { loadHostTools, resolvePolicy } from "./hostTools.ts";
import type { Manifest } from "../core/types.ts";

export type RunArgs = {
  cwd: string;
  port?: number;
  dataDir?: string | null;
  allowWrite: boolean;
  allowExec: boolean;
  /** Extra args forwarded verbatim to cli.ts as `argv`. */
  cliArgv: string[];
};

/**
 * Parse `ayjnt run` flags.
 *
 * There is no wrangler to forward to here, so the split is different from
 * dev/deploy:
 *
 *   - Recognized flags are consumed.
 *   - **Positional** args pass through to `cli.ts` as `argv`, so
 *     `ayjnt run add hello world` works without ceremony. This matters more
 *     than it looks: `bun run start -- list` has its `--` eaten by Bun before
 *     ayjnt ever sees it, so the command arrives as `ayjnt run list`. Rejecting
 *     that made the documented invocation fail.
 *   - **Unrecognized flags** are still an error. A typo'd `--prot 8787` would
 *     otherwise be silently handed to cli.ts and the server would quietly bind
 *     the wrong port.
 *   - An explicit `--` passes the remainder through untouched, flags included,
 *     for a cli.ts that wants its own `--port`.
 */
export function parseRunArgs(argv: string[]): RunArgs {
  const result: RunArgs = {
    cwd: process.cwd(),
    allowWrite: false,
    allowExec: false,
    cliArgv: [],
  };
  const sepIdx = argv.indexOf("--");
  const ours = sepIdx >= 0 ? argv.slice(0, sepIdx) : argv;
  // Args after an explicit `--` go straight through; positionals found while
  // scanning `ours` are appended to these below.
  const afterSeparator = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];
  const positionals: string[] = [];

  for (let i = 0; i < ours.length; i++) {
    const a = ours[i]!;
    const valueOf = (flag: string): string => {
      const v = a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : ours[++i];
      if (!v || v.startsWith("-")) {
        throw new Error(`${flag} requires a value (${flag} <value>)`);
      }
      return v;
    };
    if (a === "--cwd" || a.startsWith("--cwd=")) {
      result.cwd = valueOf("--cwd");
    } else if (a === "--port" || a.startsWith("--port=")) {
      const raw = valueOf("--port");
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--port must be an integer 0-65535 (got "${raw}")`);
      }
      result.port = port;
    } else if (a === "--data-dir" || a.startsWith("--data-dir=")) {
      result.dataDir = valueOf("--data-dir");
    } else if (a === "--allow-host-writes") {
      result.allowWrite = true;
    } else if (a === "--allow-host-exec") {
      result.allowExec = true;
    } else if (a.startsWith("-")) {
      // An unknown flag is a typo. Passing it to cli.ts would mean a mistyped
      // `--prot 8787` silently binds the default port instead of failing.
      throw new Error(
        `unknown option "${a}" for \`ayjnt run\`.\n` +
          `If it's meant for your cli.ts, put it after \`--\`:\n` +
          `  ayjnt run -- ${a}`,
      );
    } else {
      // A positional belongs to cli.ts.
      positionals.push(a);
    }
  }

  result.cliArgv = [...positionals, ...afterSeparator];
  return result;
}

export async function run(argv: string[]): Promise<void> {
  const args = parseRunArgs(argv);
  const cwd = path.resolve(args.cwd);

  // Deletions are never auto-staged from a run — same reasoning as dev.
  const built = await runBuild({ cwd, deferDeletions: true });

  const bundleDir = path.join(cwd, ".ayjnt", "bundle");
  const { scriptPath } = await bundleWorker({
    cwd,
    wranglerPath: built.wranglerPath,
    outDir: bundleDir,
    log: (m) => console.log(m),
  });

  const config = parseGeneratedConfig(
    await Bun.file(built.wranglerPath).text(),
  );

  const cliFile = built.manifest.cliFile ?? null;

  await runApp({
    // Spread first: `cwd` below is the resolved absolute form of args.cwd, and
    // must win.
    ...args,
    cwd,
    config,
    manifest: built.manifest,
    scriptPath,
    bundleDir,
    assetsDir: config.assets ? path.join(cwd, ".ayjnt", "assets") : null,
    cliMain: cliFile ? await loadCliMain(cliFile) : null,
    vars: await readDevVars(cwd),
  });
}

export type RunAppOptions = {
  cwd: string;
  config: GeneratedWranglerConfig;
  manifest: Manifest;
  scriptPath: string;
  bundleDir: string;
  assetsDir: string | null;
  /** The cli.ts default export, or null to just serve.
   *
   *  Passed in rather than loaded here because a compiled binary has no
   *  filesystem to import from — its bootstrap imports cli.ts statically so
   *  Bun bundles it, then hands the function over. */
  cliMain: ((cli: unknown) => unknown) | null;
  /** Pre-imported `tools.host.ts` modules, keyed by absolute source path.
   *  Same reason as `cliMain`: dynamic import can't reach into a compiled
   *  binary, so the bootstrap imports them statically. */
  hostToolModules?: Map<string, Record<string, unknown>>;
  vars: Record<string, string>;
  port?: number;
  dataDir?: string | null;
  allowWrite: boolean;
  allowExec: boolean;
  cliArgv: string[];
};

/**
 * Boot the runtime, run `cli.ts`, tear everything down.
 *
 * Shared verbatim with a compiled binary. Everything environment-specific
 * (where the script and assets live, how cli.ts is loaded) arrives as an
 * argument.
 */
export async function runApp(opts: RunAppOptions): Promise<void> {
  const log = (m: string) => console.log(m);

  const policy = resolvePolicy({
    allowWrite: opts.allowWrite,
    allowExec: opts.allowExec,
  });
  const hostTools = await loadHostTools(
    opts.manifest,
    policy,
    log,
    opts.hostToolModules
      ? (file) => {
          const mod = opts.hostToolModules!.get(file);
          if (!mod) {
            throw new Error(
              `host tools for ${file} were not embedded in this binary — rebuild with \`ayjnt compile\``,
            );
          }
          return Promise.resolve(mod);
        }
      : undefined,
  );
  if (hostTools && hostTools.descriptors.length > 0) {
    log(
      `[ayjnt] ${hostTools.descriptors.length} host tool(s) available: ` +
        hostTools.descriptors.map((d) => d.toolName).join(", "),
    );
  }

  const host = await startHost({
    cwd: opts.cwd,
    config: opts.config,
    manifest: opts.manifest,
    scriptPath: opts.scriptPath,
    bundleDir: opts.bundleDir,
    assetsDir: opts.assetsDir,
    port: opts.port,
    dataDir: opts.dataDir,
    vars: opts.vars,
    hostTools,
    log,
  });

  log(`[ayjnt] serving on ${host.url}`);

  // ONE teardown path. cli.ts returning, cli.ts throwing, SIGINT and SIGTERM
  // all converge here. An early return that skipped disposal would leave a
  // ~100MB workerd process orphaned holding the port — the single most
  // annoying way this could fail.
  let disposed = false;
  const teardown = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await host.dispose();
  };

  let signalExit: (() => void) | null = null;
  const onSignal = () => {
    // Don't await inside a signal handler — resolve the race with the main
    // flow and let it run teardown once.
    signalExit?.();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    if (!opts.cliMain) {
      log("[ayjnt] no cli.ts — serving until interrupted (Ctrl-C to stop)");
      await new Promise<void>((resolve) => {
        signalExit = resolve;
      });
      return;
    }

    const stopped = new Promise<void>((resolve) => {
      signalExit = resolve;
    });

    const main = opts.cliMain;
    const context = await host.buildCliContext(opts.cliArgv, () => signalExit?.());

    // Whichever settles first wins: cli.ts finishing, or a signal.
    await Promise.race([Promise.resolve(main(context as never)), stopped]);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await teardown();
  }
}

/** Import a cli.ts and return its default export, with a useful error when the
 *  file exists but doesn't export a function. */
export async function loadCliMain(
  cliFile: string,
): Promise<(cli: unknown) => unknown> {
  const mod = (await import(Bun.pathToFileURL(path.resolve(cliFile)).href)) as {
    default?: unknown;
  };
  if (typeof mod.default !== "function") {
    throw new Error(
      `${cliFile}: expected a default-exported function. Example:\n\n` +
        `  import type { AyjntCli } from "@ayjnt/cli";\n\n` +
        `  export default async function ({ agents }: AyjntCli) {\n` +
        `    // ...\n` +
        `  }\n`,
    );
  }
  return mod.default as (cli: unknown) => unknown;
}

export type { RunningHost };
