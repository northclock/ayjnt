import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parseArgs } from "./util.ts";

describe("parseArgs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ayjnt-args-"));

  test("--cwd <path> and --cwd=<path> are equivalent", () => {
    expect(parseArgs(["--cwd", dir]).cwd).toBe(dir);
    expect(parseArgs([`--cwd=${dir}`]).cwd).toBe(dir);
  });

  test("--cwd without a value throws instead of leaking the flag to wrangler", () => {
    expect(() => parseArgs(["--cwd"])).toThrow(/--cwd requires a path/);
    // The next flag must not be swallowed as the value.
    expect(() => parseArgs(["--cwd", "--force"])).toThrow(/--cwd requires a path/);
  });

  test("--cwd pointing nowhere (or at a file) throws", () => {
    expect(() => parseArgs(["--cwd", path.join(dir, "missing")])).toThrow(
      /is not a directory/,
    );
    const file = path.join(dir, "f.txt");
    writeFileSync(file, "x");
    expect(() => parseArgs(["--cwd", file])).toThrow(/is not a directory/);
  });

  test("unrecognized flags are forwarded to wrangler in order", () => {
    const p = parseArgs(["--port", "8788", "--cwd", dir, "--inspect"]);
    expect(p.passthrough).toEqual(["--port", "8788", "--inspect"]);
  });

  test("everything after -- is verbatim passthrough", () => {
    const p = parseArgs(["--cwd", dir, "--", "--cwd", "ignored", "--help"]);
    expect(p.cwd).toBe(dir);
    expect(p.passthrough).toEqual(["--cwd", "ignored", "--help"]);
  });

  test("--force is recognized and not forwarded", () => {
    const p = parseArgs(["--force"]);
    expect(p.force).toBe(true);
    expect(p.passthrough).toEqual([]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
