import {
  Agent as CloudflareAgent,
} from "agents";
import type { AgentWorkflow as CloudflareAgentWorkflow } from "agents/workflows";
import {
  Session,
  SessionManager,
} from "agents/experimental/memory/session";
import { getAgent, type GetAgentOptions } from "./rpc.ts";

declare global {
  /**
   * Project-specific types filled in by `.ayjnt/env.d.ts`.
   *
   * Keeping these interfaces in a global namespace lets authors write
   * `Agent<State>` without importing a generated environment type. The
   * generated declarations merge into these empty framework defaults.
   */
  namespace Ayjnt {
    interface GeneratedEnv extends Cloudflare.Env {}
    interface WorkflowRegistry {}
  }
}

type AgentConstructor<Instance = unknown> = {
  readonly prototype: Instance;
  readonly name?: string;
} & Function;
export interface AgentResolver {
  <Instance extends object>(
    agentClass: AgentConstructor<Instance>,
    name?: string,
    options?: GetAgentOptions,
  ): Promise<Instance>;
  <T extends Rpc.DurableObjectBranded | undefined>(
    namespace: DurableObjectNamespace<T>,
    name: string,
    options?: GetAgentOptions,
  ): Promise<DurableObjectStub<T>>;
}

type WorkflowConstructor = abstract new (...args: never[]) => unknown;
type WorkflowParams<Workflow> =
  Workflow extends abstract new (...args: never[]) => CloudflareAgentWorkflow<
    infer _Agent,
    infer Params,
    infer _Progress,
    infer _Env
  >
    ? Params
    : unknown;
type RegisteredWorkflowParams<Origin> = {
  [Route in keyof Ayjnt.WorkflowRegistry]:
    Ayjnt.WorkflowRegistry[Route] extends {
      agent: infer AgentType;
      workflow: infer Workflow extends WorkflowConstructor;
    }
      ? Origin extends AgentType
        ? WorkflowParams<Workflow>
        : never
      : never;
}[keyof Ayjnt.WorkflowRegistry];
type CoLocatedWorkflowParams<Origin> =
  [RegisteredWorkflowParams<Origin>] extends [never]
    ? unknown
    : RegisteredWorkflowParams<Origin>;

/**
 * Ayjnt's agent base class.
 *
 * This is deliberately a thin subclass of Cloudflare's `Agent`. Everything
 * the upstream class provides—including durable state, SQLite, scheduling,
 * workflows, callable methods, WebSockets, and sub-agents—remains available
 * without an Ayjnt-specific replacement API.
 *
 * Ayjnt only adds conveniences that are useful inside a harness:
 * typed peer-agent lookup, co-located workflow dispatch, and sessions.
 */
export abstract class Agent<
  State = unknown,
  Props extends Record<string, unknown> = Record<string, unknown>,
> extends CloudflareAgent<Ayjnt.GeneratedEnv, State, Props> {
  private readonly __ayjntAgentBindings?: ReadonlyMap<Function, string>;
  private readonly __ayjntWorkflowBinding?: string;

  /**
   * Resolve another top-level agent instance by its class.
   *
   * The class value provides autocomplete at author time and is also the
   * runtime-safe lookup key for the generated Durable Object binding.
   *
   * @example
   * `await this.agent(InventoryAgent, "primary")`
   */
  protected get agent(): AgentResolver {
    return ((
      target: Function | DurableObjectNamespace,
      name = "default",
      options?: GetAgentOptions,
    ) => this.resolveAgent(target, name, options)) as AgentResolver;
  }

  private resolveAgent(
    classOrNamespace: Function | DurableObjectNamespace,
    name = "default",
    options?: GetAgentOptions,
  ): Promise<unknown> {
    if (typeof classOrNamespace !== "function") {
      return getAgent(classOrNamespace, name, options);
    }

    const binding = this.__ayjntAgentBindings?.get(classOrNamespace);
    if (!binding) {
      throw new Error(
        `ayjnt: ${classOrNamespace.name || "the supplied class"} is not in ` +
          `the generated agent registry. Default-export it from an agent.ts ` +
          `file and re-run \`ayjnt build\`.`,
      );
    }
    const namespace = (this.env as Record<string, unknown>)[binding];
    if (!namespace) {
      throw new Error(
        `ayjnt: generated binding "${binding}" for ` +
          `${classOrNamespace.name || "the supplied class"} ` +
          `is missing from the runtime environment.`,
      );
    }
    return getAgent(
      namespace as DurableObjectNamespace,
      name,
      options,
    );
  }

  /**
   * Start the workflow co-located beside this agent.
   *
   * Its parameter type is inferred from the generated workflow registry; no
   * binding string or `withWorkflow` mixin is required.
   */
  protected workflow(
    params: CoLocatedWorkflowParams<this>,
  ): Promise<string> {
    if (!this.__ayjntWorkflowBinding) {
      throw new Error(
        "ayjnt: this agent has no co-located workflow.ts. Add one beside " +
          "agent.ts and re-run `ayjnt build`, or use runWorkflow() for a " +
          "workflow that is intentionally not co-located.",
      );
    }
    return this.runWorkflow(this.__ayjntWorkflowBinding, params);
  }

  /**
   * Create a durable conversation session backed by this agent's SQLite
   * database. Pass an id when one agent instance owns multiple sessions.
   *
   * Cloudflare currently marks the Session API as experimental; Ayjnt keeps
   * that status and returns the upstream Session unchanged.
   */
  protected createSession(sessionId?: string): Session {
    const session = Session.create(this);
    return sessionId ? session.forSession(sessionId) : session;
  }

  /**
   * Create a manager for multiple durable sessions within this agent.
   *
   * The returned object is Cloudflare's SessionManager, not an Ayjnt fork.
   */
  protected createSessionManager(): SessionManager {
    return SessionManager.create(this);
  }
}

export { CloudflareAgent };
export type { AgentConstructor, CoLocatedWorkflowParams };
