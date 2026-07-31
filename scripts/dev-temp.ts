// `bun run dev:temp` — spin up a throwaway project wired to THIS checkout
// of ayjnt, so you can feel the real dev experience before publishing.
//
// What it does, in order:
//   1. wipes + recreates a temp project dir (stable path, so it's easy to find)
//   2. scaffolds it with the local CLI (`ayjnt new`), exactly as a user would
//   3. `bun install`s its deps
//   4. replaces node_modules/ayjnt with a symlink to this repo, so the
//      framework runtime resolves to your live source (the `bun` export
//      condition reads src/*.ts directly — no build step needed)
//   5. repoints the project's dev/build/migrate scripts at the local CLI
//      *source*, so codegen changes are live too — edit src/ and just re-run
//
// The result: a sandbox where every byte of ayjnt — runtime AND codegen —
// is your working tree. No `bun link`, no rebuilds, no stale `file:` copies.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "..");
// Stable, predictable path — same place every run, always rebuilt fresh, so
// it never accumulates and you can muscle-memory the `cd`.
const TEMP = path.join(tmpdir(), "ayjnt-dev-temp");

// `--empty` for the minimal one-agent starter; default is the richer UI
// template (counter agent + its page + a root home page — exercises
// bundling, the typed useAgent hook, the root app.tsx, and live state).
const empty = process.argv.includes("--empty");
const template = empty ? "empty" : "ui";

// `--cli` additionally seeds the local-runtime surface: a root cli.ts, a
// workerd-side tools.ts, and a host-side tools.host.ts. Without this the
// sandbox has nothing for `bun run start` / `bun run compile` to exercise,
// because `ayjnt new` scaffolds a deploy-targeted project.
const withCli = process.argv.includes("--cli");

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

let step = 0;
const say = (msg: string) => console.log(`\n${green(`[${++step}]`)} ${msg}`);

/**
 * Write a root `cli.ts` plus a pair of tool files into the scaffolded project,
 * and add the deps model tools need.
 *
 * Kept deliberately small — just enough to prove each mechanism works. For the
 * fuller treatment (side-effect gating, path confinement, a real subcommand
 * parser) see `examples/code`.
 */
async function seedCliFiles(dir: string, isEmpty: boolean): Promise<void> {
  // `ayjnt new --empty` scaffolds agents/alive; the UI template uses counter.
  const route = isEmpty ? "alive" : "counter";
  const agentDir = path.join(dir, "agents", route);

  await Bun.write(
    path.join(dir, "cli.ts"),
    `// Root-level cli.ts — the foreground of this app.
//
// \`bun run start\` boots the worker under a local workerd, calls this, then
// shuts everything down (workerd included) when it returns.
//
// This file runs in BUN. The agent runs in WORKERD. That's why Bun.\$ works
// here and would not work in agents/${route}/agent.ts.

import type { AyjntCli } from "@ayjnt/cli";

export default async function ({ agents, argv, url }: AyjntCli) {
  console.log("serving at", url);
  console.log("argv:", argv);

  // A real Durable Object stub — in-process RPC, no HTTP, no port.
  const agent = agents.${route}("demo");
  console.log("tools the model can call:", await agent.toolNames());

  // Bun-native work, in the same process.
  console.log("bun", Bun.version, "cwd", process.cwd());
}
`,
  );

  await Bun.write(
    path.join(agentDir, "tools.ts"),
    `// Runs in workerd, next to the agent. Deploys normally.
//
// Reaching for Bun.file / Bun.\$ / bun:sqlite here fails the build with a
// pointer to tools.host.ts — try it.

import { tool } from "ai";
import { z } from "zod";

export const countWords = tool({
  description: "Count the words in a piece of text.",
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => ({
    words: text.trim().split(/\\s+/).filter(Boolean).length,
  }),
});
`,
  );

  await Bun.write(
    path.join(agentDir, "tools.host.ts"),
    `// Runs on the Bun host, reached from workerd over the framework's bridge.
// The .host.ts suffix is the whole declaration — there is no directive.
//
// These cannot be deployed: \`ayjnt deploy\` refuses a project containing them,
// because a Cloudflare worker has no host process to proxy to.

import { confinePath, hostTool } from "ayjnt/tools";
import { z } from "zod";

const ROOT = process.cwd();

export const listProjectFiles = hostTool({
  description: "List the files in the project directory.",
  sideEffects: "read",
  inputSchema: z.object({}),
  execute: async () => ({
    files: (await Bun.\$\`ls -1\`.cwd(ROOT).text()).trim().split("\\n"),
  }),
});

// "write" is refused unless you pass --allow-host-writes, because the argument
// comes from model output.
export const writeScratch = hostTool({
  description: "Write a line to scratch.txt in the project directory.",
  sideEffects: "write",
  inputSchema: z.object({ line: z.string() }),
  execute: async ({ line }: { line: string }) => {
    await Bun.write(confinePath(ROOT, "scratch.txt"), line + "\\n");
    return { wrote: line };
  },
});
`,
  );

  // Give the agent a method cli.ts can call to see the merged ToolSet.
  const agentPath = path.join(agentDir, "agent.ts");
  const source = await Bun.file(agentPath).text();
  const patched = source
    .replace(
      /^(import .*\n)/m,
      `$1import { agentTools } from "ayjnt/tools";\n`,
    )
    // Insert a method just inside the class body.
    .replace(
      /(export default class \w+[^{]*\{\n)/,
      `$1
  /** Names of every tool this agent would hand a model. */
  async toolNames(): Promise<string[]> {
    return Object.keys(agentTools(this)).sort();
  }
`,
    );
  await Bun.write(agentPath, patched);

  // Model tools need the AI SDK and zod; the scaffold doesn't ship them.
  const pkgPath = path.join(dir, "package.json");
  const pkg = (await Bun.file(pkgPath).json()) as {
    dependencies?: Record<string, string>;
  };
  pkg.dependencies = {
    ...(pkg.dependencies ?? {}),
    ai: "^6.0.0",
    zod: "^4.0.0",
  };
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/** Run a command, streaming its output, rejecting on non-zero exit. */
function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
  });
}

console.log(bold("\n  ayjnt — temporary dev sandbox"));
console.log(dim(`  framework source: ${REPO}`));
console.log(dim(`  template:         ${template}`));

// 1. fresh temp dir
say(`Resetting the sandbox at ${cyan(TEMP)}`);
rmSync(TEMP, { recursive: true, force: true });
console.log(dim("    (wiped any previous sandbox so you start clean)"));

// 2. scaffold with the local CLI, exactly as `bunx ayjnt new` would
say(`Scaffolding a new project with the local ${bold("ayjnt new")}`);
const newArgs = ["run", path.join(REPO, "bin", "ayjnt.ts"), "new", TEMP];
if (empty) newArgs.push("--empty");
await run("bun", newArgs, REPO);

// 2b. seed the local-runtime files, if asked
if (withCli) {
  say(`Seeding ${bold("cli.ts")}, ${bold("tools.ts")} and ${bold("tools.host.ts")}`);
  await seedCliFiles(TEMP, empty);
  console.log(dim("    plus `ai` + `zod`, which model tools need"));
}

// 3. install the project's own deps (agents, wrangler, react…)
say("Installing the project's dependencies");
await run("bun", ["install"], TEMP);

// 4. point node_modules/ayjnt at this repo (live runtime source)
say("Linking the local ayjnt into the sandbox");
const linkPath = path.join(TEMP, "node_modules", "ayjnt");
rmSync(linkPath, { recursive: true, force: true });
mkdirSync(path.dirname(linkPath), { recursive: true });
symlinkSync(REPO, linkPath, "dir");
console.log(
  dim("    node_modules/ayjnt → this repo (runtime resolves to live src/)"),
);

// 5. repoint the project scripts at the local CLI source (live codegen)
say("Wiring the project scripts to your local CLI source");
const pkgPath = path.join(TEMP, "package.json");
const pkg = (await Bun.file(pkgPath).json()) as {
  scripts: Record<string, string>;
};
// Point at bin/ayjnt.ts (the SOURCE), not the published bin, which resolves to
// the built dist/ayjnt.js. That distinction is the whole reason this sandbox
// exists: edits to src/cli/** and src/codegen/** take effect on the next run
// with no `bun run build` in between.
const cli = `bun run ${path.join(REPO, "bin", "ayjnt.ts")}`;
pkg.scripts.dev = `${cli} dev`;
pkg.scripts.start = `${cli} run`;
pkg.scripts.build = `${cli} build`;
pkg.scripts.compile = `${cli} compile`;
pkg.scripts.migrate = `${cli} migrate`;
pkg.scripts.deploy = `${cli} deploy`;
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(
  dim("    dev/start/build/compile/migrate/deploy now run THIS checkout's CLI"),
);

// done — tell the user exactly how to start poking at it
const startUrl = empty
  ? "curl http://localhost:8787/alive/hello"
  : "open  http://localhost:8787/             (home page, agents/app.tsx)\n" +
    "          open  http://localhost:8787/counter/demo (counter — two tabs sync live)";

console.log(bold(green("\n✓ sandbox ready\n")));
console.log("  Your throwaway project lives at:\n");
console.log(`    ${bold(cyan(TEMP))}\n`);
console.log("  Start the dev server:\n");
console.log(`    ${bold(`cd ${TEMP}`)}`);
console.log(`    ${bold("bun run dev")}\n`);
console.log("  Then, in another terminal:\n");
console.log(`    ${startUrl}\n`);

if (withCli) {
  console.log("  Or run it on ayjnt's own runtime, which also runs cli.ts:\n");
  console.log(`    ${bold("bun run start")}                       ${dim("# ayjnt run")}`);
  console.log(
    `    ${bold("bun run start tool countWords '{\"text\":\"a b c\"}'")}`,
  );
  console.log(
    `    ${bold("bun run start --allow-host-writes")}     ${dim("# permit the write tool")}\n`,
  );
  console.log("  Then compile the whole thing into one binary:\n");
  console.log(`    ${bold("bun run compile")}                     ${dim("# ~170MB, takes a moment")}`);
  console.log(`    ${bold("./<project-name>")}\n`);
  console.log(
    dim(
      "  The binary needs no Bun, no node_modules and no wrangler — copy it\n" +
        "  anywhere and it still works. `ayjnt deploy` will refuse this project,\n" +
        "  by design, because tools.host.ts cannot run on Cloudflare.\n",
    ),
  );
} else {
  console.log(
    dim(
      "  Re-run with --cli to also seed a root cli.ts and a tools.ts /\n" +
        "  tools.host.ts pair, so you can try `bun run start` and\n" +
        "  `bun run compile`.\n",
    ),
  );
}
console.log(
  dim(
    "  Everything is wired to your working tree:\n" +
      "    • edit src/runtime/** → live on the next request (no rebuild)\n" +
      "    • edit src/cli/** or src/codegen/** → picked up on the next `bun run dev`\n" +
      "    • edit agents/** in the sandbox → the watcher re-runs codegen automatically\n",
  ),
);
console.log(
  dim(
    "  Add agents under agents/<route>/agent.ts, drop an app.tsx beside one for a UI,\n" +
      "  or `curl /__ayjnt/catalog` to see the agent catalog.\n" +
      `  Re-run ${bold("bun run dev:temp")} anytime for a fresh sandbox (it reuses the same path).\n`,
  ),
);
