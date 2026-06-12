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
    // Expected failures (validation, git preflight, …) read best as a
    // single line. The stack is one env var away for the unexpected ones.
    if (process.env["AYJNT_DEBUG"]) {
      console.error(`\nayjnt: ${err.stack ?? err.message}`);
    } else {
      console.error(`\nayjnt: ${err.message}`);
      console.error("(set AYJNT_DEBUG=1 for a stack trace)");
    }
  } else {
    console.error("\nayjnt: unknown error", err);
  }
  process.exit(1);
}
