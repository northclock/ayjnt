// Build config for shipping ayjnt to npm.
//
// We want the published tarball to work in three places:
//
//   1. Bun consumers (`bun add ayjnt`) — read .ts source directly via the
//      `"bun"` exports condition. No build required at consumer install
//      time. Matches our dev workflow.
//
//   2. Node consumers (`npm install ayjnt` + plain Node) — read compiled
//      .js + .d.ts from dist/, picked up via the `"import"` condition.
//
//   3. `npx ayjnt` / `bunx ayjnt` — execute the bin. Source has no
//      shebang (we always invoke via `bun run bin/ayjnt.ts` in dev), so
//      we stamp `#!/usr/bin/env node` onto the compiled CLI here. Node
//      can run JS, Bun can also run JS, so the node shebang is the
//      portable choice.
//
// The CLI imports from src/cli/* and src/codegen/* — those get bundled
// into dist/ayjnt.js. The runtime exports stay separate so consumers
// only pull in what they import.

import { defineConfig } from "bunup";

const external = [
  // Peer-ish deps the consumer brings themselves. Don't bundle.
  "agents",
  "wrangler",
  "react",
  "react-dom",
  // AI SDK + zod are optional peers, used only by the tools runtime.
  "ai",
  "zod",
  // Local runtime: only reached by `ayjnt run` / a compiled binary, and
  // resolved from the consumer's install (or aliased at compile time).
  "miniflare",
  "workerd",
  // Cloudflare-specific module namespace, runtime-resolved by workerd.
  /^cloudflare:/,
];

export default defineConfig([
  {
    name: "runtime",
    entry: [
      "src/runtime/index.ts",
      "src/runtime/rpc.ts",
      "src/runtime/middleware.ts",
      "src/runtime/router.ts",
      "src/runtime/browser.ts",
      "src/runtime/voiceClient.tsx",
      "src/runtime/workflow.ts",
    ],
    outDir: "dist",
    format: ["esm"],
    target: "node",
    dts: true,
    clean: true,
    external,
  },
  {
    // The newer runtime entries live in their own block rather than joining
    // "runtime" above. Past eight entries in a single block, bunup starts
    // preserving the full source structure — emitting dist/src/runtime/*.js
    // instead of flat dist/*.js — which silently invalidates every
    // ./dist/*.js path in package.json's exports map. Splitting keeps each
    // block's output flat. Verified by bisection; re-check the dist layout if
    // you add entries here.
    name: "runtime-tools",
    entry: ["src/runtime/cliContext.ts", "src/runtime/tools.ts"],
    outDir: "dist",
    format: ["esm"],
    target: "node",
    dts: true,
    clean: false,
    external,
  },
  {
    // The local runtime, reached through the `ayjnt/internal/*` exports by the
    // bootstrap that `ayjnt compile` generates. Not public API — it's exported
    // only because a compiled binary's entry module has to import it by
    // specifier like any other consumer.
    //
    // Separate from the "runtime" block because these use Bun APIs (Bun.file,
    // Bun.spawn, Bun.pathToFileURL) and so must be compiled for `bun`, not
    // `node`. They're Bun-only by nature: `ayjnt run` and compiled binaries
    // both execute under Bun.
    name: "internal",
    entry: ["src/cli/run.ts", "src/cli/host.ts"],
    outDir: "dist",
    format: ["esm"],
    target: "bun",
    dts: true,
    clean: false,
    external,
  },
  {
    // Named "bin", not "cli": bunup keys some internal bookkeeping off the
    // block name, and a block called "cli" alongside a `src/runtime/cli.ts`
    // entry makes it emit the runtime into `dist/src/runtime/` instead of
    // flat `dist/`, silently breaking every `./dist/*.js` path in
    // package.json's exports map.
    name: "bin",
    entry: ["bin/ayjnt.ts"],
    outDir: "dist",
    format: ["esm"],
    // The CLI uses Bun APIs (Bun.file, Bun.write, Bun.build for app.tsx
    // bundling, Bun.Glob for the scanner). Compiling for `bun` keeps
    // those native and avoids polyfill bloat. We then ship a `bun`
    // shebang so the OS picks the right interpreter.
    target: "bun",
    // CLI is bundled into a single dist/ayjnt.js — keeps the npm install
    // smaller than shipping every src/cli + src/codegen file separately.
    dts: false,
    // Bunup's clean defaults to `true` per-entry, which wipes the runtime
    // files emitted by the previous config. Disable it explicitly so the
    // runtime + CLI both survive in dist/.
    clean: false,
    external,
    // npm-installed CLIs need a shebang on the bin so the OS knows what
    // to exec. Source has none (we run via `bun run` in dev); add it
    // here for the published artifact. The CLI is Bun-only at runtime
    // because of the Bun.* APIs above, so we shebang Bun. Node users
    // hit a "bun: command not found" error from the OS rather than a
    // confusing "Bun is not defined" runtime crash.
    banner: "#!/usr/bin/env bun",
  },
]);
