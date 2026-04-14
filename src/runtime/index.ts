// Public runtime API — what user code imports via `import { ... } from "ayjnt"`.
//
// Kept intentionally thin: mostly re-exports from the Agents SDK so users have
// a single import source, plus framework-specific helpers as they land.

export const VERSION = "0.0.1";

// Filled in as framework functionality lands:
//   export { Agent, type Connection, type ConnectionContext } from "agents";
//   export { defineConfig } from "./config.ts";
