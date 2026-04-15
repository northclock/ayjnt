// No shebang in source — we never invoke this file directly via the
// kernel. In framework dev we always run it as `bun run bin/ayjnt.ts`
// (explicit interpreter, shebang ignored). In published builds, bunup
// stamps `#!/usr/bin/env node` onto dist/ayjnt.js (see bunup.config.ts),
// which is what `npx ayjnt` / `bunx ayjnt` end up executing.
import { run } from "../src/cli/index.ts";

try {
  await run(process.argv.slice(2));
} catch (err) {
  if (err instanceof Error) {
    console.error(`\nayjnt: ${err.message}`);
  } else {
    console.error("\nayjnt: unknown error", err);
  }
  process.exit(1);
}
