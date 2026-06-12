// Typed inter-agent RPC.
//
// Thin wrapper over getAgentByName from the Agents SDK. The SDK's generic
// parameter order is `<Env, T extends Agent<Env>>` which makes explicit
// type args awkward at the call site — `getAgentByName<Env, ChatAgent>(...)`
// forces the user to thread Env through just to specify the class.
//
// This wrapper inverts it: `getAgent<ChatAgent>(env.CHAT_AGENT, id)`. T is
// the first (and only) generic the caller usually needs, inferred through
// the namespace, and the return type is a typed stub with method autocomplete.
//
// Under the hood: idFromName → get → setName. The setName step keeps
// `this.name` correct on the target DO so its CF_AGENT_IDENTITY messages
// (and any code keying off `this.name`) look the same whether the agent
// is called externally via HTTP or from another agent via getAgent.

import { getAgentByName } from "agents";

/** Placement / routing options forwarded verbatim to the SDK's
 *  getAgentByName (jurisdiction, locationHint, props, …). */
export type GetAgentOptions = Parameters<typeof getAgentByName>[2];

/**
 * Fetch a typed DurableObject stub for an agent instance by name. The
 * returned stub exposes every public method on T, plus .fetch() for raw
 * HTTP-over-DO calls.
 *
 * @example
 *   const chat = await getAgent<ChatAgent>(this.env.CHAT_AGENT, userId);
 *   await chat.sendMessage("hello");
 *
 *   // pin to a jurisdiction:
 *   const eu = await getAgent<ChatAgent>(ns, id, { jurisdiction: "eu" });
 */
export async function getAgent<
  T extends Rpc.DurableObjectBranded | undefined,
>(
  namespace: DurableObjectNamespace<T>,
  name: string,
  options?: GetAgentOptions,
): Promise<DurableObjectStub<T>> {
  // The SDK's typing constrains T to extend Agent<Env>. We deliberately
  // loosen it to `Rpc.DurableObjectBranded` — the minimum shape the
  // Workers DO runtime actually requires — so the call site reads cleanly
  // as `getAgent<InventoryAgent>(ns, id)`. The runtime behavior is
  // identical and TS still catches misuse via the namespace type.
  return (await (getAgentByName as unknown as (
    ns: DurableObjectNamespace<T>,
    n: string,
    o?: GetAgentOptions,
  ) => Promise<DurableObjectStub<T>>)(namespace, name, options));
}
