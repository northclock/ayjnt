// Public runtime API — what user code imports via `import { ... } from "ayjnt"`.
//
// Kept thin. Most framework work lives in codegen; this module is the small
// surface of helpers user code calls directly.

export const VERSION = "0.1.0";

// Re-export the Agent base class so `import { Agent } from "ayjnt"` works.
// One import source means the user never has to remember whether a symbol
// is "ours" or "Cloudflare's".
export { Agent } from "agents";

// Middleware types for user-authored middleware.ts files.
export type { Context, Middleware, Next } from "./middleware.ts";

// Typed inter-agent RPC.
export { getAgent } from "./rpc.ts";
