// Public runtime API — what user code imports via `import { ... } from "ayjnt"`.
//
// Kept thin. Most framework work lives in codegen; this module is the small
// surface of helpers user code calls directly.

export const VERSION = "0.5.7";

// Ayjnt's thin Cloudflare Agent subclass and the unwrapped escape hatch.
export { Agent, CloudflareAgent } from "./agent.ts";

// Common upstream primitives stay available from one import source. Ayjnt
// does not change their runtime behavior.
export {
  callable,
  getCurrentAgent,
  getSubAgentByName,
  routeAgentEmail,
  routeAgentRequest,
  routeSubAgentRequest,
} from "agents";
export type {
  AgentGetOptions,
  CallableMetadata,
  Connection,
  ConnectionContext,
  Schedule,
  ScheduleCriteria,
  StreamingResponse,
  SubAgentClass,
  SubAgentStub,
} from "agents";

// Middleware types for user-authored middleware.ts files.
export type { Context, Middleware, Next } from "./middleware.ts";

// Typed inter-agent RPC.
export { getAgent } from "./rpc.ts";

// Deprecated compatibility helper for projects created before co-located
// `this.workflow(params)` became part of Ayjnt's Agent base. Runtime workflow
// classes live under `ayjnt/workflows` because they execute inside workerd.
export { withWorkflow } from "./workflow.ts";
