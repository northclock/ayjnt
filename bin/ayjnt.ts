#!/usr/bin/env bun
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
