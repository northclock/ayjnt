import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { collectBundleModulePaths } from "./bundle.ts";
import { collectModules } from "./host.ts";

const roots: string[] = [];

function bundleDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), "ayjnt-bundle-modules-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("worker bundle modules", () => {
  test("collects nested JavaScript and Wasm with the entry first", () => {
    const root = bundleDir();
    mkdirSync(path.join(root, "nested"), { recursive: true });
    const entry = path.join(root, "entry.js");
    writeFileSync(entry, "export default {};");
    writeFileSync(path.join(root, "chunk.js"), "export const n = 1;");
    writeFileSync(path.join(root, "nested/math.wasm"), new Uint8Array([0, 97, 115, 109]));
    writeFileSync(path.join(root, "entry.js.map"), "{}");

    expect(
      collectBundleModulePaths(entry, root).map((file) =>
        path.relative(root, file).replace(/\\/g, "/"),
      ),
    ).toEqual(["entry.js", "chunk.js", "nested/math.wasm"]);
  });

  test("creates explicit Miniflare definitions with binary Wasm contents", async () => {
    const root = bundleDir();
    mkdirSync(path.join(root, "nested"), { recursive: true });
    const entry = path.join(root, "entry.js");
    writeFileSync(entry, 'import wasm from "./nested/math.wasm";');
    writeFileSync(
      path.join(root, "nested/math.wasm"),
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    );

    const modules = await collectModules(entry, root);
    expect(modules[0]).toEqual({
      type: "ESModule",
      path: "entry.js",
      contents: 'import wasm from "./nested/math.wasm";',
    });
    expect(modules[1]?.type).toBe("CompiledWasm");
    expect(modules[1]?.path).toBe("nested/math.wasm");
    expect(modules[1]?.contents).toBeInstanceOf(Uint8Array);
  });
});
