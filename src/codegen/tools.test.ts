import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  detectHostOnlyGlobals,
  hostToolFiles,
  resolveCliFile,
  resolveTools,
  scan,
} from "./scan.ts";
import { assertNoHostTools } from "../cli/deploy.ts";
import { deployBlockingHostTools } from "../cli/hostTools.ts";

describe("detectHostOnlyGlobals", () => {
  test("names the specific member so the error is actionable", () => {
    expect(detectHostOnlyGlobals("const t = await Bun.file(p).text();")).toBe(
      "Bun.file",
    );
    expect(detectHostOnlyGlobals("await Bun.$`ls`")).toBe("Bun.$");
    expect(detectHostOnlyGlobals("Bun.spawnSync([])")).toBe("Bun.spawnSync");
  });

  test("flags bun: builtin specifiers", () => {
    expect(
      detectHostOnlyGlobals(`import { Database } from "bun:sqlite";`),
    ).toBe("bun:sqlite");
    expect(detectHostOnlyGlobals(`import x from 'bun:ffi';`)).toBe("bun:ffi");
  });

  test("ignores mentions inside comments", () => {
    // Doc comments routinely explain the workerd/host split by naming Bun APIs.
    expect(
      detectHostOnlyGlobals("// use Bun.file here? no — see tools.host.ts"),
    ).toBeNull();
    expect(
      detectHostOnlyGlobals("/* Bun.$ is unavailable in workerd */"),
    ).toBeNull();
  });

  test("does not match an identifier that merely ends in Bun", () => {
    expect(detectHostOnlyGlobals("myBun.foo(); notBun.bar();")).toBeNull();
    expect(detectHostOnlyGlobals("obj.Bun.x")).toBeNull();
  });

  test("allows node: imports, which nodejs_compat provides", () => {
    expect(
      detectHostOnlyGlobals(`import * as path from "node:path";`),
    ).toBeNull();
  });

  test("returns null for ordinary worker-safe source", () => {
    expect(
      detectHostOnlyGlobals(`import { tool } from "ai";\nexport const a = tool({});`),
    ).toBeNull();
  });
});

describe("resolveTools", () => {
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "ayjnt-tools-"));
    // worker-only route
    await mkdir(path.join(root, "worker"), { recursive: true });
    await writeFile(
      path.join(root, "worker", "tools.ts"),
      `import { tool } from "ai";\nexport const a = tool({});`,
    );
    // host-only route
    await mkdir(path.join(root, "host"), { recursive: true });
    await writeFile(
      path.join(root, "host", "tools.host.ts"),
      `export const b = hostTool({ execute: async () => Bun.file("x").text() });`,
    );
    // both, with the host file opted out of blocking deploys
    await mkdir(path.join(root, "both"), { recursive: true });
    await writeFile(path.join(root, "both", "tools.ts"), `export const c = 1;`);
    await writeFile(
      path.join(root, "both", "tools.host.ts"),
      `// @ayjnt-optional-on-deploy\nexport const d = 2;`,
    );
    // a workerd tools.ts that reaches for Bun
    await mkdir(path.join(root, "bad"), { recursive: true });
    await writeFile(
      path.join(root, "bad", "tools.ts"),
      `export const e = async () => Bun.file("x").text();`,
    );
    // neither
    await mkdir(path.join(root, "none"), { recursive: true });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("finds a workerd-side tools.ts", async () => {
    const tools = await resolveTools(path.join(root, "worker"), "/worker");
    expect(tools).toHaveLength(1);
    expect(tools[0]!.runtime).toBe("worker");
    expect(tools[0]!.optionalOnDeploy).toBe(false);
  });

  test("finds a host-side tools.host.ts", async () => {
    const tools = await resolveTools(path.join(root, "host"), "/host");
    expect(tools).toHaveLength(1);
    expect(tools[0]!.runtime).toBe("host");
    expect(tools[0]!.routePath).toBe("/host");
  });

  test("a route can have both, ordered worker-first for stable codegen", async () => {
    const tools = await resolveTools(path.join(root, "both"), "/both");
    expect(tools.map((t) => t.runtime)).toEqual(["worker", "host"]);
  });

  test("reads the opt-out marker from the host file", async () => {
    const tools = await resolveTools(path.join(root, "both"), "/both");
    expect(tools.find((t) => t.runtime === "host")!.optionalOnDeploy).toBe(true);
  });

  test("host files are never treated as worker files, Bun globals and all", async () => {
    // The host file above uses Bun.file; that's the whole point of the suffix.
    await expect(
      resolveTools(path.join(root, "host"), "/host"),
    ).resolves.toHaveLength(1);
  });

  test("rejects a workerd tools.ts using a Bun global, pointing at the fix", async () => {
    await expect(
      resolveTools(path.join(root, "bad"), "/bad"),
    ).rejects.toThrow(/Bun\.file.*tools\.host\.ts/s);
  });

  test("returns nothing for a route with no tool files", async () => {
    expect(await resolveTools(path.join(root, "none"), "/none")).toEqual([]);
  });
});

describe("resolveCliFile", () => {
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "ayjnt-cli-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("returns null when absent", () => {
    expect(resolveCliFile(root)).toBeNull();
  });

  test("returns the absolute path when present", async () => {
    await writeFile(path.join(root, "cli.ts"), `export default async () => {};`);
    expect(resolveCliFile(root)).toBe(path.join(root, "cli.ts"));
  });
});

describe("scan integration: cli.ts and tools", () => {
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "ayjnt-scan-tools-"));
    await mkdir(path.join(root, "agents", "research"), { recursive: true });
    await writeFile(
      path.join(root, "agents", "research", "agent.ts"),
      `export default class ResearchAgent extends Agent<Env> {}`,
    );
    await writeFile(
      path.join(root, "agents", "research", "tools.ts"),
      `export const a = 1;`,
    );
    await writeFile(
      path.join(root, "agents", "research", "tools.host.ts"),
      `export const b = 2;`,
    );
    await writeFile(path.join(root, "cli.ts"), `export default async () => {};`);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("the manifest carries cliFile and both tool entries", async () => {
    const manifest = await scan(root);
    expect(manifest.cliFile).toBe(path.join(root, "cli.ts"));
    expect(manifest.agents[0]!.tools.map((t) => t.runtime)).toEqual([
      "worker",
      "host",
    ]);
  });

  test("hostToolFiles picks out only the host entries", async () => {
    const manifest = await scan(root);
    const host = hostToolFiles(manifest);
    expect(host).toHaveLength(1);
    expect(host[0]!.sourceFile).toEndWith("tools.host.ts");
  });
});

describe("assertNoHostTools", () => {
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "ayjnt-deploy-guard-"));
    await mkdir(path.join(root, "agents", "a"), { recursive: true });
    await writeFile(
      path.join(root, "agents", "a", "agent.ts"),
      `export default class AAgent extends Agent<Env> {}`,
    );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("passes when there are no host tools", async () => {
    const manifest = await scan(root);
    expect(() => assertNoHostTools(manifest, root)).not.toThrow();
  });

  test("blocks a deploy and names the offending file", async () => {
    await writeFile(
      path.join(root, "agents", "a", "tools.host.ts"),
      `export const t = 1;`,
    );
    const manifest = await scan(root);
    expect(deployBlockingHostTools(manifest)).toHaveLength(1);
    expect(() => assertNoHostTools(manifest, root)).toThrow(
      /agents\/a\/tools\.host\.ts/,
    );
  });

  test("an opted-out file does not block the deploy", async () => {
    await writeFile(
      path.join(root, "agents", "a", "tools.host.ts"),
      `// @ayjnt-optional-on-deploy\nexport const t = 1;`,
    );
    const manifest = await scan(root);
    expect(deployBlockingHostTools(manifest)).toHaveLength(0);
    expect(() => assertNoHostTools(manifest, root)).not.toThrow();
  });
});
