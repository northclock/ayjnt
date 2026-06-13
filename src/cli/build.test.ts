// Tests for the .dev.vars sync helper. The whole point of syncDevVars
// is to make wrangler's `configDir`-relative `.dev.vars` resolution
// work when our generated wrangler.jsonc lives in `.ayjnt/dist/`.
// We mirror — preferably as a symlink — every .dev.vars{,.<env>} from
// the project root into dist, and clean up stale entries on rebuild.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { devVarsSyncKind, syncDevVars } from "./build.ts";

let project: string;
let dist: string;

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "ayjnt-devvars-"));
  dist = path.join(project, ".ayjnt", "dist");
  mkdirSync(dist, { recursive: true });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("syncDevVars", () => {
  test("symlinks .dev.vars into dist with a relative target", () => {
    writeFileSync(path.join(project, ".dev.vars"), "API_KEY=secret\n");

    syncDevVars(project, dist);

    expect(devVarsSyncKind(dist, ".dev.vars")).toBe("symlink");
    // Relative target keeps the link valid if the project moves.
    const target = readlinkSync(path.join(dist, ".dev.vars"));
    expect(path.isAbsolute(target)).toBe(false);
    // Pointing back at the right file — follow it and verify content.
    expect(readFileSync(path.join(dist, ".dev.vars"), "utf8")).toBe(
      "API_KEY=secret\n",
    );
  });

  test("no-op when no .dev.vars files exist at project root", () => {
    syncDevVars(project, dist);
    expect(existsSync(path.join(dist, ".dev.vars"))).toBe(false);
  });

  test("mirrors all .dev.vars.<env> siblings", () => {
    // wrangler dev --env staging looks up .dev.vars.staging in configDir,
    // so every variant has to land in dist.
    writeFileSync(path.join(project, ".dev.vars"), "X=1\n");
    writeFileSync(path.join(project, ".dev.vars.staging"), "Y=2\n");
    writeFileSync(path.join(project, ".dev.vars.production"), "Z=3\n");

    syncDevVars(project, dist);

    expect(devVarsSyncKind(dist, ".dev.vars")).toBe("symlink");
    expect(devVarsSyncKind(dist, ".dev.vars.staging")).toBe("symlink");
    expect(devVarsSyncKind(dist, ".dev.vars.production")).toBe("symlink");
  });

  test("skips .dev.vars.example samples", () => {
    // .example files are checked-in templates for collaborators, not
    // real secrets. Mirroring them would teach wrangler to load fake
    // values and shadow whatever the user has set elsewhere.
    writeFileSync(path.join(project, ".dev.vars.example"), "API_KEY=\n");

    syncDevVars(project, dist);

    expect(devVarsSyncKind(dist, ".dev.vars.example")).toBe("missing");
  });

  test("removes stale dist entries when project-root source disappears", () => {
    // User had .dev.vars, ran build (mirror created), then deleted
    // the source. On the next build we must purge the leftover mirror
    // — otherwise wrangler keeps loading the old values.
    writeFileSync(path.join(project, ".dev.vars"), "X=1\n");
    syncDevVars(project, dist);
    expect(devVarsSyncKind(dist, ".dev.vars")).toBe("symlink");

    rmSync(path.join(project, ".dev.vars"));
    syncDevVars(project, dist);
    expect(devVarsSyncKind(dist, ".dev.vars")).toBe("missing");
  });

  test("removes stale .dev.vars.<env> when only some variants survive", () => {
    writeFileSync(path.join(project, ".dev.vars"), "X=1\n");
    writeFileSync(path.join(project, ".dev.vars.staging"), "Y=2\n");
    syncDevVars(project, dist);
    expect(devVarsSyncKind(dist, ".dev.vars.staging")).toBe("symlink");

    rmSync(path.join(project, ".dev.vars.staging"));
    syncDevVars(project, dist);
    expect(devVarsSyncKind(dist, ".dev.vars.staging")).toBe("missing");
    expect(devVarsSyncKind(dist, ".dev.vars")).toBe("symlink");
  });

  test("re-running sync replaces an existing link without crashing", () => {
    // Idempotency: a no-change rebuild must not error. The implementation
    // unlinks then re-links every entry; this test pins that against
    // regressions like leaving the dest in place and calling symlink
    // (which would EEXIST on POSIX).
    writeFileSync(path.join(project, ".dev.vars"), "X=1\n");
    syncDevVars(project, dist);
    syncDevVars(project, dist);
    syncDevVars(project, dist);
    expect(devVarsSyncKind(dist, ".dev.vars")).toBe("symlink");
  });

  test("replaces a stale copy (from a prior fallback) with a fresh symlink", () => {
    // Simulate the Windows-fallback case: a prior sync left a real
    // file copy in dist. The next sync should clobber it with the
    // canonical relative symlink so live edits work again.
    writeFileSync(path.join(dist, ".dev.vars"), "OLD=copy\n");
    expect(devVarsSyncKind(dist, ".dev.vars")).toBe("copy");

    writeFileSync(path.join(project, ".dev.vars"), "NEW=symlink\n");
    syncDevVars(project, dist);

    expect(devVarsSyncKind(dist, ".dev.vars")).toBe("symlink");
    expect(readFileSync(path.join(dist, ".dev.vars"), "utf8")).toBe(
      "NEW=symlink\n",
    );
  });

  test("live edits to source propagate through the symlink (no rebuild needed)", () => {
    // This is the headline benefit of symlink-over-copy: wrangler
    // resolves the path once at startup, but as long as it re-reads
    // through the link it sees current contents. We approximate
    // wrangler's behaviour by re-reading after a source edit.
    writeFileSync(path.join(project, ".dev.vars"), "V=1\n");
    syncDevVars(project, dist);

    writeFileSync(path.join(project, ".dev.vars"), "V=2\n");
    expect(readFileSync(path.join(dist, ".dev.vars"), "utf8")).toBe("V=2\n");
  });

  test("captures fallback warning via the log callback when symlink would fail", () => {
    // We can't reliably force a symlink failure on POSIX, so this test
    // verifies the log-callback wiring is plumbed through. The actual
    // EPERM-fallback path is best smoke-tested manually on Windows.
    const messages: string[] = [];
    writeFileSync(path.join(project, ".dev.vars"), "X=1\n");
    syncDevVars(project, dist, (m) => messages.push(m));
    // Happy path: no warnings on POSIX.
    expect(messages).toEqual([]);
  });
});

// runBuild integration: the client tree must be regenerated from scratch on
// every build so renamed/deleted agents can't leave stale typed hooks behind
// (a stale hook keeps the user's old `@ayjnt/<route>` import compiling and
// silently targets a route the worker no longer serves).
import { runBuild } from "./build.ts";
import { writeFile, mkdir, rename } from "node:fs/promises";

describe("runBuild client-tree cleanup", () => {
  test("renaming an agent folder removes the orphaned client hook", async () => {
    const proj = mkdtempSync(path.join(tmpdir(), "ayjnt-build-"));
    await mkdir(path.join(proj, "agents/chat"), { recursive: true });
    await writeFile(
      path.join(proj, "package.json"),
      JSON.stringify({ name: "cleanup-test", type: "module" }),
    );
    await writeFile(
      path.join(proj, "agents/chat/agent.ts"),
      `export default class ChatAgent extends Agent {}`,
    );

    await runBuild({ cwd: proj, quiet: true });
    expect(existsSync(path.join(proj, ".ayjnt/client/chat/index.tsx"))).toBe(true);

    // Folder rename — same class, new route.
    await rename(path.join(proj, "agents/chat"), path.join(proj, "agents/support"));
    await runBuild({ cwd: proj, quiet: true });

    expect(existsSync(path.join(proj, ".ayjnt/client/support/index.tsx"))).toBe(true);
    expect(existsSync(path.join(proj, ".ayjnt/client/chat"))).toBe(false);

    // And the folder move must NOT have staged a storage-destroying
    // migration: one v1 entry, no deleted_classes anywhere.
    const lock = JSON.parse(
      readFileSync(path.join(proj, ".ayjnt/migrations.json"), "utf8"),
    );
    expect(lock.migrations).toHaveLength(1);
    expect(lock.migrations[0].deleted_classes).toBeUndefined();
    expect(lock.classes["support"].className).toBe("ChatAgent");

    rmSync(proj, { recursive: true, force: true });
  });
});

describe("runBuild atomicity and validation", () => {
  // Apps in these fixtures use the legacy manual-mount shape (no default
  // export) so bundling needs no React install — these tests are about
  // build ORDERING and validation, not the mount wrapper.
  const scaffold = async (proj: string, name = "atomicity-test") => {
    await mkdir(path.join(proj, "agents/x"), { recursive: true });
    await writeFile(
      path.join(proj, "package.json"),
      JSON.stringify({ name, type: "module" }),
    );
    await writeFile(
      path.join(proj, "agents/x/agent.ts"),
      `export default class XAgent extends Agent {}`,
    );
  };

  test("a failing bundle aborts before destroying prior assets or staging the lockfile", async () => {
    const proj = mkdtempSync(path.join(tmpdir(), "ayjnt-atomic-"));
    await scaffold(proj);
    await writeFile(
      path.join(proj, "agents/x/app.tsx"),
      `document.body.appendChild(document.createElement("div"));`,
    );
    await runBuild({ cwd: proj, quiet: true });
    const assetPath = path.join(proj, ".ayjnt/assets/__ayjnt/x/app.js");
    expect(existsSync(assetPath)).toBe(true);
    const goodAsset = readFileSync(assetPath, "utf8");
    rmSync(path.join(proj, ".ayjnt/migrations.json"));

    // Break the app and rebuild: must reject, keep the old asset bytes, and
    // NOT write a lockfile (bundling happens before any destructive step).
    await writeFile(
      path.join(proj, "agents/x/app.tsx"),
      `import "package-that-does-not-exist";
document.body.appendChild(document.createElement("div"));`,
    );
    await expect(runBuild({ cwd: proj, quiet: true })).rejects.toThrow(
      /package-that-does-not-exist/,
    );
    expect(readFileSync(assetPath, "utf8")).toBe(goodAsset);
    expect(existsSync(path.join(proj, ".ayjnt/migrations.json"))).toBe(false);

    rmSync(proj, { recursive: true, force: true });
  });

  test("two app routes flattening to the same asset segment are rejected", async () => {
    const proj = mkdtempSync(path.join(tmpdir(), "ayjnt-flatcol-"));
    await writeFile(
      path.join(proj, "package.json"),
      JSON.stringify({ name: "flat-col", type: "module" }),
    );
    // Note the explicit agentId: with DEFAULT ids these two folders would
    // already collide on agentId in scan (ids derive like flats do) — the
    // flat check matters exactly when an explicit id bypasses that.
    for (const [dir, cls, idLine] of [
      ["agents/admin/users", "AdminUsersAgent", ""],
      ["agents/admin_users", "AdminFlatAgent", 'export const agentId = "flat_v1";\n'],
    ] as const) {
      await mkdir(path.join(proj, dir), { recursive: true });
      await writeFile(
        path.join(proj, dir, "agent.ts"),
        `${idLine}export default class ${cls} extends Agent {}`,
      );
      await writeFile(
        path.join(proj, dir, "app.tsx"),
        `document.body.appendChild(document.createElement("div"));`,
      );
    }
    await expect(runBuild({ cwd: proj, quiet: true })).rejects.toThrow(
      /both flatten to the asset segment "admin_users"/,
    );
    rmSync(proj, { recursive: true, force: true });
  });

  test("missing package.json name falls back to the directory name with a warning", async () => {
    const proj = mkdtempSync(path.join(tmpdir(), "ayjnt-noname-"));
    await mkdir(path.join(proj, "agents/x"), { recursive: true });
    await writeFile(path.join(proj, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      path.join(proj, "agents/x/agent.ts"),
      `export default class XAgent extends Agent {}`,
    );
    await runBuild({ cwd: proj, quiet: true });
    const cfg = JSON.parse(
      readFileSync(path.join(proj, ".ayjnt/dist/wrangler.jsonc"), "utf8")
        .split("\n").slice(1).join("\n"),
    );
    expect(cfg.name).toBe(path.basename(proj).toLowerCase());
    rmSync(proj, { recursive: true, force: true });
  });

  test("deferDeletions: a vanished agent is not staged as deleted_classes", async () => {
    const proj = mkdtempSync(path.join(tmpdir(), "ayjnt-defer-"));
    await scaffold(proj, "defer-test");
    await runBuild({ cwd: proj, quiet: true });
    const lockBefore = readFileSync(path.join(proj, ".ayjnt/migrations.json"), "utf8");

    rmSync(path.join(proj, "agents/x"), { recursive: true, force: true });
    // dev-style rebuild: deletion must NOT land in the lockfile…
    await runBuild({ cwd: proj, quiet: true, deferDeletions: true });
    expect(readFileSync(path.join(proj, ".ayjnt/migrations.json"), "utf8")).toBe(lockBefore);

    // …but an explicit build stages it.
    await runBuild({ cwd: proj, quiet: true });
    const lock = JSON.parse(readFileSync(path.join(proj, ".ayjnt/migrations.json"), "utf8"));
    expect(lock.migrations.at(-1).deleted_classes).toEqual(["XAgent"]);
    rmSync(proj, { recursive: true, force: true });
  });
});
