import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { validateNewArgs, validateTargetDir } from "./new.ts";

describe("validateNewArgs", () => {
  test("no args / -h / --help → help", () => {
    expect(validateNewArgs([]).kind).toBe("help");
    expect(validateNewArgs(["-h"]).kind).toBe("help");
    expect(validateNewArgs(["my-app", "--help"]).kind).toBe("help");
  });

  test("a typo'd flag is an error, not a silently-wrong template", () => {
    const r = validateNewArgs(["my-app", "--with-iu"]);
    expect(r).toEqual({ kind: "error", message: "unknown option --with-iu" });
  });

  test("extra positionals are rejected", () => {
    const r = validateNewArgs(["my-app", "other"]);
    expect(r.kind).toBe("error");
  });

  test("missing directory is rejected", () => {
    expect(validateNewArgs(["--with-ui"])).toEqual({
      kind: "error",
      message: "missing <directory>",
    });
  });

  test("template selection", () => {
    expect(validateNewArgs(["my-app"])).toEqual({
      kind: "scaffold",
      targetDir: "my-app",
      template: "blank",
    });
    expect(validateNewArgs(["my-app", "--with-ui"])).toEqual({
      kind: "scaffold",
      targetDir: "my-app",
      template: "with-ui",
    });
  });
});

describe("validateTargetDir", () => {
  test("nonexistent target is fine", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-new-"));
    expect(validateTargetDir(path.join(tmp, "fresh"))).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("existing EMPTY directory is fine (ayjnt new . flow)", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-new-"));
    expect(validateTargetDir(tmp)).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("a lone .DS_Store doesn't count as content", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-new-"));
    writeFileSync(path.join(tmp, ".DS_Store"), "");
    expect(validateTargetDir(tmp)).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("non-empty directory is refused", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-new-"));
    await mkdir(path.join(tmp, "src"));
    expect(validateTargetDir(tmp)).toMatch(/not empty/);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("existing file (not a directory) is refused", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-new-"));
    const f = path.join(tmp, "taken");
    writeFileSync(f, "x");
    expect(validateTargetDir(f)).toMatch(/not a directory/);
    rmSync(tmp, { recursive: true, force: true });
  });
});
