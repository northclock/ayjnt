// Shared CLI helpers — arg parsing and wrangler shell-out.

import { spawn } from "node:child_process";

export type ParsedArgs = {
  /** --cwd <path>. Defaults to process.cwd(). */
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
    if (a === "--cwd" && ours[i + 1]) {
      result.cwd = ours[i + 1]!;
      i++;
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
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "could not launch bunx. Install Bun from https://bun.com",
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
