// ayjnt deploy — the safety-railed shipping command.
//
// Invariant: nothing goes to production unless the .ayjnt/migrations.json in
// use is committed and pushed. This prevents two developers from racing a
// deploy and producing divergent lockfiles in prod.
//
// Preflight (in order; --force skips all):
//   1. git status --porcelain empty
//   2. local in sync with origin/<branch>
//   3. run build WITHOUT writing the lockfile
//   4. if build would stage a new migration → reject with install instruction
//
// Only then: bunx wrangler deploy --config .ayjnt/dist/wrangler.jsonc

import { spawnSync } from "node:child_process";
import { runBuild } from "./build.ts";
import { parseArgs, runWrangler } from "./util.ts";

export async function deploy(argv: string[]): Promise<void> {
  const { cwd, force, passthrough } = parseArgs(argv);

  if (!force) {
    assertGitReady(cwd);
  }

  const result = await runBuild({ cwd, writeLockfile: false });

  if (result.staged && !force) {
    throw new Error(
      [
        "pending lockfile change (migration or folder move) — not yet committed to .ayjnt/migrations.json.",
        "Run `ayjnt build` to stage it, then `git add .ayjnt/migrations.json && git commit && git push` before deploying.",
        "Use --force to deploy anyway (not recommended — risks divergent migrations across deploys).",
      ].join("\n"),
    );
  }

  const code = await runWrangler(
    "deploy",
    ["--config", result.wranglerPath, ...passthrough],
    cwd,
  );
  if (code !== 0) process.exit(code);
}

/**
 * Checks: (a) no uncommitted changes, (b) no unpushed commits, (c) no
 * unpulled commits. Throws with actionable message on failure.
 *
 * Gracefully degrades when git isn't available or there's no remote — prints
 * a warning rather than blocking the deploy. In those cases the user is
 * taking responsibility for migration coordination themselves.
 */
function assertGitReady(cwd: string): void {
  const git = (args: string[]) =>
    spawnSync("git", args, { cwd, encoding: "utf8" });

  const status = git(["status", "--porcelain"]);
  if (status.status === null) {
    console.warn("warning: git not available; skipping repo sync checks");
    return;
  }
  if (status.status !== 0) {
    console.warn(`warning: not a git repo (${status.stderr.trim()}); skipping repo sync checks`);
    return;
  }

  if (status.stdout.trim().length > 0) {
    throw new Error(
      [
        "uncommitted changes detected:",
        status.stdout,
        "commit or stash before deploying. Use --force to bypass.",
      ].join("\n"),
    );
  }

  const branchRes = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchRes.status !== 0) return;
  const branch = branchRes.stdout.trim();

  // Detached HEAD: `--abbrev-ref` returns the literal "HEAD", and comparing
  // against `origin/HEAD` (which usually exists as a symbolic ref) would
  // produce bogus ahead/behind counts and misleading errors. Same degraded
  // path as a missing remote: warn and let the clean-tree check stand alone.
  if (branch === "HEAD") {
    console.warn(
      "warning: detached HEAD — skipping remote sync check. Make sure this commit is pushed before deploying.",
    );
    return;
  }

  const remoteCheck = git(["rev-parse", "--verify", `origin/${branch}`]);
  if (remoteCheck.status !== 0) {
    console.warn(
      `warning: no origin/${branch} — skipping sync check. Ensure coworkers coordinate migrations.`,
    );
    return;
  }

  const ahead = git(["rev-list", "--count", `origin/${branch}..HEAD`]);
  const behind = git(["rev-list", "--count", `HEAD..origin/${branch}`]);
  const aheadN = parseInt(ahead.stdout.trim() || "0", 10);
  const behindN = parseInt(behind.stdout.trim() || "0", 10);

  if (aheadN > 0) {
    throw new Error(
      `${aheadN} unpushed commit(s) on ${branch}. Push before deploying. Use --force to bypass.`,
    );
  }
  if (behindN > 0) {
    throw new Error(
      `${behindN} unpulled commit(s) from origin/${branch}. Pull before deploying. Use --force to bypass.`,
    );
  }
}
