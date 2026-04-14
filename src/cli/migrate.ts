// ayjnt migrate — preview the diff. Doesn't write anything, doesn't run
// wrangler. Useful for reviewing what an `ayjnt build` would do.

import { diffMigrations, formatDiff, readLockfile } from "../codegen/migrations.ts";
import { scan } from "../codegen/scan.ts";
import { parseArgs } from "./util.ts";

export async function migrate(argv: string[]): Promise<void> {
  const { cwd } = parseArgs(argv);
  const manifest = await scan(cwd);
  const lockfile = await readLockfile(cwd);
  const diff = diffMigrations(lockfile, manifest);
  console.log(formatDiff(diff));
  if (diff.nextEntry) {
    console.log("\nRun `ayjnt build` to stage this migration in .ayjnt/migrations.json.");
  }
}
