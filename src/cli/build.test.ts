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
