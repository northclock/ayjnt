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

import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { runBuild } from "./build.ts";
import { deployBlockingHostTools } from "./hostTools.ts";
import { parseArgs, runWrangler } from "./util.ts";
import { HOST_TOOLS_OPTIONAL_MARKER, type Manifest } from "../core/types.ts";

export async function deploy(argv: string[]): Promise<void> {
  const { cwd, force, passthrough } = parseArgs(argv);

  if (!force) {
    assertGitReady(cwd);
  }

  const result = await runBuild({ cwd, writeLockfile: false });

  // Host tools have no counterpart in production — see assertNoHostTools.
  // Checked even under --force: --force is about migration coordination, not
  // about shipping a worker that will fault at its first tool call.
  assertNoHostTools(result.manifest, cwd);

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
 * Refuse to deploy a project whose agents depend on host tools.
 *
 * A `tools.host.ts` executes in the Bun process that hosts the local runtime.
 * Deployed to Cloudflare there is no such process — no Bun, no bridge — so
 * those tools cannot work, no matter what. The options were to fail here, to
 * omit the tools silently, or to deploy stubs that throw at runtime. Failing
 * here is the only one that surfaces the problem while it's still cheap: a
 * silent omission gives the same agent different capabilities in prod than
 * locally with nothing to indicate it, and a throwing stub converts a
 * build-time error into a production incident.
 *
 * A file that genuinely is optional can say so with the
 * `@ayjnt-optional-on-deploy` marker; its tools are then simply absent from the
 * deployed ToolSet, which the runtime already handles (no bridge bound means no
 * proxies are built).
 */
export function assertNoHostTools(manifest: Manifest, cwd: string): void {
  const blocking = deployBlockingHostTools(manifest);
  if (blocking.length === 0) return;

  const list = blocking
    .map((t) => `  ${path.relative(cwd, t.sourceFile)}  (${t.routePath})`)
    .join("\n");

  throw new Error(
    [
      `cannot deploy: ${blocking.length} host tool file(s) would not work in production.`,
      "",
      list,
      "",
      "Host tools run in the Bun process that hosts your local runtime. A deployed",
      "Cloudflare worker has no host process, so these functions have nowhere to run.",
      "",
      "Options:",
      `  • Move the tools into agents/<route>/tools.ts to run them in workerd instead`,
      `    (they lose access to Bun.$, Bun.file, bun:sqlite and node APIs).`,
      `  • Ship the app with \`ayjnt compile\` instead of deploying it.`,
      `  • If the agent works without them, add the comment marker`,
      `    \`${HOST_TOOLS_OPTIONAL_MARKER}\` to the file — its tools will be`,
      `    omitted from the deployed ToolSet instead of blocking the deploy.`,
    ].join("\n"),
  );
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
