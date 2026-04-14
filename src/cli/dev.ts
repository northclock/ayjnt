// ayjnt dev — codegen once, then hand the generated wrangler.jsonc to
// `wrangler dev`. Wrangler handles file watching for the worker itself; we
// don't need to re-run codegen unless the file tree under agents/ changes
// structure (which in practice happens rarely, and the user can ctrl-C and
// restart). Watch-on-tree-change is a v0.2 nice-to-have.

import { runBuild } from "./build.ts";
import { parseArgs, runWrangler } from "./util.ts";

export async function dev(argv: string[]): Promise<void> {
  const { cwd, passthrough } = parseArgs(argv);
  const result = await runBuild({ cwd });
  const code = await runWrangler(
    "dev",
    ["--config", result.wranglerPath, ...passthrough],
    cwd,
  );
  if (code !== 0) process.exit(code);
}
