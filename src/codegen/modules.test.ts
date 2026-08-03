import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  generateWasmProxy,
  scanWasmModules,
  wasmProxyPath,
} from "./modules.ts";

const roots: string[] = [];
const wasmHeader = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0]);

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "ayjnt-wasm-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("WebAssembly module convention", () => {
  test("an absent modules directory is an empty opt-in", async () => {
    expect(await scanWasmModules(project())).toEqual([]);
  });

  test("discovers nested artifacts with stable generated imports", async () => {
    const root = project();
    await mkdir(path.join(root, "modules/image"), { recursive: true });
    await writeFile(path.join(root, "modules/math.wasm"), wasmHeader);
    await writeFile(path.join(root, "modules/image/resize.wasm"), wasmHeader);

    const found = await scanWasmModules(root);
    expect(found.map(({ modulePath, importPath }) => ({ modulePath, importPath })))
      .toEqual([
        {
          modulePath: "image/resize.wasm",
          importPath: "@ayjnt/modules/image/resize",
        },
        { modulePath: "math.wasm", importPath: "@ayjnt/modules/math" },
      ]);
    expect(wasmProxyPath(found[0]!)).toBe("image/resize.ts");

    const outPath = path.join(root, ".ayjnt/client/modules/image/resize.ts");
    const proxy = generateWasmProxy(found[0]!, outPath);
    expect(proxy).toContain('import wasmModule from "../../../../modules/image/resize.wasm";');
    expect(proxy).toContain("export default wasmModule as WebAssembly.Module;");
  });

  test("rejects a file with a .wasm extension but no Wasm header", async () => {
    const root = project();
    await mkdir(path.join(root, "modules"), { recursive: true });
    await writeFile(path.join(root, "modules/broken.wasm"), "not wasm");

    await expect(scanWasmModules(root)).rejects.toThrow(/missing the \\0asm header/);
  });
});
