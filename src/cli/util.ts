// Shared CLI helpers — arg parsing and wrangler shell-out.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";

export type ParsedArgs = {
  /** --cwd <path> or --cwd=<path>. Defaults to process.cwd(). */
  cwd: string;
  /** --force flag (deploy uses this). */
  force: boolean;
  /** Everything after `--` forwarded verbatim to wrangler. */
  passthrough: string[];
};

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    cwd: process.cwd(),
    force: false,
    passthrough: [],
  };
  // Anything after an explicit `--` is passthrough. Anything we don't
  // recognize before that also falls through to wrangler — this way
  // `ayjnt dev --port 8787` just works without the user knowing `--`.
  const sepIdx = argv.indexOf("--");
  const ours = sepIdx >= 0 ? argv.slice(0, sepIdx) : argv;
  const explicitPassthrough = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];
  const forwarded: string[] = [];

  for (let i = 0; i < ours.length; i++) {
    const a = ours[i]!;
    if (a === "--cwd" || a.startsWith("--cwd=")) {
      const value = a.startsWith("--cwd=") ? a.slice("--cwd=".length) : ours[++i];
      // A missing value (or the next flag swallowed as the value) used to
      // silently forward `--cwd` to wrangler, which errors confusingly.
      if (!value || value.startsWith("-")) {
        throw new Error("--cwd requires a path (--cwd <path> or --cwd=<path>)");
      }
      if (!existsSync(value) || !statSync(value).isDirectory()) {
        throw new Error(`--cwd ${value} is not a directory`);
      }
      result.cwd = value;
    } else if (a === "--force") {
      result.force = true;
    } else {
      forwarded.push(a);
    }
  }

  result.passthrough = [...forwarded, ...explicitPassthrough];
  return result;
}

/**
 * Run a wrangler subcommand via bunx, streaming stdio. Returns the child's
 * exit code. Translates ENOENT into a friendly install instruction.
 *
 * Termination signals are forwarded to the child: Ctrl-C reaches it via
 * the terminal's foreground process group anyway, but a programmatic
 * SIGTERM (CI timeouts, process managers) only hits this process — without
 * forwarding, the wrangler child would be orphaned and keep the port.
 */
export function runWrangler(
  subcommand: string,
  args: string[],
  cwd: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("bunx", ["wrangler", subcommand, ...args], {
      stdio: "inherit",
      cwd,
    });

    const forward = (signal: NodeJS.Signals) => () => {
      if (child.exitCode === null && !child.killed) {
        child.kill(signal);
      }
    };
    const onSigterm = forward("SIGTERM");
    const onSigint = forward("SIGINT");
    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);
    const cleanup = () => {
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGINT", onSigint);
    };

    child.on("error", (err: NodeJS.ErrnoException) => {
      cleanup();
      if (err.code === "ENOENT") {
        reject(
          new Error("could not launch bunx. Install Bun from https://bun.com"),
        );
      } else {
        reject(err);
      }
    });
    child.on("exit", (code) => {
      cleanup();
      resolve(code ?? 1);
    });
  });
}
