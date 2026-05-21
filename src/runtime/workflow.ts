// Zero-config mixin for co-located workflows.
//
// When a `workflow.ts` sits next to an `agent.ts`, the framework already
// knows which workflow binding belongs to which agent — that pairing is
// derived at scan time from the folder layout. Passing the binding name
// as a magic string into `this.runWorkflow("ORDERS_PROCESSING", params)`
// is redundant once the framework knows about the pairing.
//
// `withWorkflow` is the ergonomic shortcut:
//
//   import { Agent } from "agents";
//   import { withWorkflow } from "ayjnt/workflow";
//   import type OrdersProcessing from "./workflow.ts";
//
//   export default class OrdersAgent
//     extends withWorkflow<typeof OrdersProcessing>(Agent)<GeneratedEnv, State>
//   {
//     async placeOrder(req: OrderRequest) {
//       const id = await this.workflow({           // ← typed against
//         orderId: crypto.randomUUID(),            //   OrdersProcessing's
//         sku: req.sku,                            //   Params generic
//         qty: req.qty,
//         customerId: req.customerId,
//       });
//     }
//   }
//
// At the type level, `<typeof OrdersProcessing>` carries the workflow's
// `Params` into the method signature — IntelliSense knows exactly what
// shape `this.workflow(...)` accepts.
//
// At runtime, `withWorkflow(Agent)` returns a subclass with a single
// `workflow(params)` method. The method reads `this.__ayjntWorkflowBinding`
// — a hidden prototype property the codegen patches onto the agent class
// in `.ayjnt/dist/entry.ts` based on the scan-time pairing. The user
// never sees the binding string.
//
// Type-only import of the workflow class is fine even though `workflow.ts`
// already type-imports the agent — `import type` is erased at runtime, so
// the cycle is purely structural.

import type { AgentWorkflow } from "agents/workflows";

/**
 * Extract the `Params` generic from an `AgentWorkflow` subclass.
 *
 * `AgentWorkflow<AgentType, Params, ProgressType, Env>` → `Params`.
 * Falls back to `unknown` if the workflow class isn't parameterized.
 */
export type WorkflowParams<W> = W extends abstract new (
  ...args: never
) => AgentWorkflow<never, infer P, never, never>
  ? P
  : unknown;

/**
 * Loosest possible constructor shape we accept as `Base`. The point of
 * the mixin is to *preserve* TBase's constructor — including generic
 * params — so we never widen further than `Constructor<object>`. The
 * downstream user keeps their `Agent<Env, State>` parameterization.
 *
 * We use `any[]` (not `never[]`) for the constructor params so the
 * intersection in {@link WorkflowMixinReturn} unifies cleanly with the
 * upstream Agent constructor shape — matches how `@cloudflare/voice`'s
 * `withVoice` typing is structured.
 */
type Constructor<T = object> = new (...args: any[]) => T;

/**
 * The members our mixin adds to the resulting class. Spelled out as an
 * explicit interface to satisfy TS6 declaration emit — declaration
 * bundlers refuse to inline anonymous return types from generic
 * function expressions.
 */
export interface WorkflowMixinMembers<W> {
  /**
   * Trigger the co-located workflow. Params shape lifted from the
   * workflow's `Params` generic — IntelliSense knows the exact fields
   * the workflow expects. Returns the workflow instance id.
   */
  workflow(params: WorkflowParams<W>): Promise<string>;
}

/**
 * Return type of {@link withWorkflow}. Intersects the original `TBase`
 * (preserving all generic args like `<Env, State>` so
 * `withWorkflow(Agent)<Env, State>` still type-checks) with a
 * constructor that produces an object with the `workflow` method.
 *
 * Same return-type pattern `@cloudflare/voice`'s `withVoice` uses.
 */
export type WorkflowMixinReturn<TBase extends Constructor, W> = TBase &
  (new (...args: any[]) => WorkflowMixinMembers<W>);

/**
 * Mixin that adds `this.workflow(params)` to an Agent subclass.
 *
 * @template W - The co-located workflow class (`typeof OrdersProcessing`).
 *               Type-only — `withWorkflow` doesn't need a value reference
 *               to the workflow class because the codegen injects the
 *               binding name onto the agent's prototype.
 * @param Base - The base class to mix into. Almost always `Agent` from
 *               the `agents` package, but any constructor works.
 *
 * @example
 * ```ts
 * import { Agent } from "agents";
 * import { withWorkflow } from "ayjnt/workflow";
 * import type OrdersProcessing from "./workflow.ts";
 *
 * export default class OrdersAgent
 *   extends withWorkflow<typeof OrdersProcessing>(Agent)<GeneratedEnv, State>
 * {
 *   async placeOrder(req: OrderRequest) {
 *     const workflowId = await this.workflow({
 *       orderId: crypto.randomUUID(),
 *       sku: req.sku,
 *       qty: req.qty,
 *       customerId: req.customerId,
 *     });
 *     return workflowId;
 *   }
 * }
 * ```
 */
export function withWorkflow<W>() {
  // Curried form. The outer call binds the workflow type so the user
  // can write `withWorkflow<typeof OrdersProcessing>()(Agent)` and TS
  // infers `TBase` from the value arg — without the curry, partial
  // type-argument inference fails (user would have to spell out both
  // `<W, TBase>` or neither).
  return function applyMixin<TBase extends Constructor>(
    Base: TBase,
  ): WorkflowMixinReturn<TBase, W> {
    // `Base as Constructor` discards Base's generic parameters at the
    // runtime level — TypeScript still threads them through via the
    // return-type intersection below. The intersection `TBase &
    // (new () => Members)` is the trick that preserves `<Env, State>`.
    class WithWorkflow extends (Base as unknown as Constructor) {
      workflow(params: WorkflowParams<W>): Promise<string> {
        const binding = (
          this as unknown as { __ayjntWorkflowBinding?: string }
        ).__ayjntWorkflowBinding;
        if (!binding) {
          throw new Error(
            `ayjnt: withWorkflow could not resolve a workflow binding for this agent. ` +
              `Make sure a workflow.ts sits next to agent.ts, then re-run ` +
              `\`ayjnt build\` (or \`bun run dev\`) so the codegen can pair them. ` +
              `If the workflow is intentionally not co-located, use the SDK's ` +
              `this.runWorkflow("BINDING_NAME", params) directly instead.`,
          );
        }
        // `runWorkflow` is provided by the SDK's `Agent` base class. We
        // don't constrain `Base` to `typeof Agent` here so this mixin
        // composes with other ayjnt mixins
        // (`withVoice(withWorkflow<W>()(Agent))` works as expected).
        return (
          this as unknown as {
            runWorkflow: (
              b: string,
              p: WorkflowParams<W>,
            ) => Promise<string>;
          }
        ).runWorkflow(binding, params);
      }
    }

    return WithWorkflow as unknown as WorkflowMixinReturn<TBase, W>;
  };
}
