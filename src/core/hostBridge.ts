// The workerd → host bridge protocol.
//
// One module, imported by both sides, so the wire format can't drift:
//
//   - the WORKER side (src/runtime/tools.ts, bundled into the worker) builds
//     requests and reads responses
//   - the HOST side (src/cli/hostTools.ts, running in Bun) serves them
//
// Transport is a Miniflare `serviceBindings` entry whose value is a plain
// function. Miniflare runs that function in the host process and exposes it to
// the worker as an ordinary Fetcher, so `env.__AYJNT_HOST.fetch(...)` in
// workerd lands on Bun code. workerd already speaks Cap'n Proto to that
// loopback internally, which is why there is no capnweb or Cap'n Proto
// dependency here — the capability channel already exists and we only need a
// payload format on top of it.
//
// The payload is JSON because these are LLM tool calls: arguments arrive as
// JSON from the model and results go back into the model's context as JSON.
// Streaming, callback arguments, or promise pipelining would justify reaching
// for capnweb; tool calls do not.

/** Service binding name for the host bridge. Provisioned by the local runtime,
 *  never by user config. */
export const HOST_BRIDGE_BINDING = "__AYJNT_HOST";

/** JSON binding carrying the host tool manifest (name/description/schema per
 *  tool). Populated at boot by the host, which is the only side able to import
 *  a `tools.host.ts`. */
export const HOST_TOOLS_BINDING = "__AYJNT_HOST_TOOLS";

/** Origin used for bridge requests. Arbitrary — the service binding ignores
 *  the host portion — but a stable value makes host-side logs readable. */
export const HOST_BRIDGE_ORIGIN = "http://ayjnt-host";

/** Path for a tool invocation. */
export const HOST_BRIDGE_INVOKE_PATH = "/tools/invoke";

/** What a host tool may do. Gates execution: `read` runs freely, while
 *  `write` and `exec` require a project opt-in or an interactive confirm,
 *  because the arguments originate from model output. */
export type SideEffects = "read" | "write" | "exec";

/** One host tool as advertised to the worker. `inputSchema` is JSON Schema —
 *  converted from the author's schema on the host, since the worker can't
 *  import the tool module. */
export type HostToolDescriptor = {
  /** Route of the owning agent, e.g. "/research". */
  route: string;
  /** Export name in tools.host.ts. */
  name: string;
  /** Name the model sees. Namespaced per route so two agents can each have a
   *  `search` tool without colliding. */
  toolName: string;
  description: string;
  sideEffects: SideEffects;
  /** JSON Schema for the tool's input. */
  inputSchema: unknown;
};

export type HostInvokeRequest = {
  route: string;
  name: string;
  input: unknown;
};

export type HostInvokeResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/** Tool name the model sees for a host tool. Route segments are flattened with
 *  underscores to satisfy provider-side tool-name charset rules
 *  (`^[a-zA-Z0-9_-]+$`). */
export function hostToolName(route: string, exportName: string): string {
  const flat = route.slice(1).replace(/\//g, "_");
  return flat ? `${flat}__${exportName}` : exportName;
}
