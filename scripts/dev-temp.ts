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

// `--blank` for the minimal one-agent starter; default is the richer
// counter-with-UI template (exercises bundling, the typed useAgent hook,
// and live multi-tab state).
const blank = process.argv.includes("--blank");
const template = blank ? "blank" : "with-ui";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

let step = 0;
const say = (msg: string) => console.log(`\n${green(`[${++step}]`)} ${msg}`);

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
if (!blank) newArgs.push("--with-ui");
await run("bun", newArgs, REPO);

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
const cli = `bun run ${path.join(REPO, "bin", "ayjnt.ts")}`;
pkg.scripts.dev = `${cli} dev`;
pkg.scripts.build = `${cli} build`;
pkg.scripts.migrate = `${cli} migrate`;
pkg.scripts.deploy = `${cli} deploy`;
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(dim("    dev/build/migrate/deploy now run THIS checkout's CLI"));

// done — tell the user exactly how to start poking at it
const startUrl = blank
  ? "curl http://localhost:8787/alive/hello"
  : "open  http://localhost:8787/counter/demo   (open two tabs — state syncs live)";

console.log(bold(green("\n✓ sandbox ready\n")));
console.log("  Your throwaway project lives at:\n");
console.log(`    ${bold(cyan(TEMP))}\n`);
console.log("  Start the dev server:\n");
console.log(`    ${bold(`cd ${TEMP}`)}`);
console.log(`    ${bold("bun run dev")}\n`);
console.log("  Then, in another terminal:\n");
console.log(`    ${startUrl}\n`);
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
