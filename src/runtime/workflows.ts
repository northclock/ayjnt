import { AgentWorkflow as CloudflareAgentWorkflow } from "agents/workflows";
import type { Agent as CloudflareAgent } from "agents";
import { WorkflowEntrypoint } from "cloudflare:workers";

/**
 * Ayjnt workflow base for a workflow co-located with an agent.
 *
 * The originating agent and binding are known from the file layout, so the
 * public generic surface starts with workflow Params rather than making the
 * author repeat the agent class. Progress, callbacks, approvals, retries, and
 * state synchronization remain implemented by the upstream SDK.
 */
export abstract class AgentWorkflow<
  Params = unknown,
  Progress = import("agents/workflows").DefaultProgress,
  Env extends Cloudflare.Env = Ayjnt.GeneratedEnv,
> extends CloudflareAgentWorkflow<
  CloudflareAgent<Env>,
  Params,
  Progress,
  Env
> {}

/**
 * Base for a plain Cloudflare Workflow that does not need an originating
 * Agent. Prefer AgentWorkflow when the workflow must report progress or
 * call back into an agent.
 */
export abstract class Workflow<
  Params = unknown,
  Env extends Cloudflare.Env = Ayjnt.GeneratedEnv,
> extends WorkflowEntrypoint<Env, Params> {}

export { CloudflareAgentWorkflow, WorkflowEntrypoint };
export type {
  AgentWorkflowEvent,
  AgentWorkflowStep,
  DefaultProgress,
  RunWorkflowOptions,
  WaitForApprovalOptions,
  WorkflowInfo,
  WorkflowStatus,
} from "agents/workflows";
