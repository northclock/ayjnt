import {
  AgentClient as CloudflareAgentClient,
  type AgentClientOptions as CloudflareAgentClientOptions,
} from "agents/client";

export type AyjntAgentClientOptions<State = unknown> = Omit<
  CloudflareAgentClientOptions<State>,
  "agent" | "basePath" | "name"
> & {
  /** Ayjnt route prefix, for example `/support` or `/projects/reviewer`. */
  route: string;
  /** Agent instance name appended to the route. Defaults to `default`. */
  name?: string;
  /**
   * Class name used for client identity metadata. Routing is controlled by
   * `route`, so this does not need to match the URL.
   */
  agent?: string;
};

/**
 * Build the custom basePath expected by Ayjnt's file-based router.
 */
export function agentBasePath(route: string, name = "default"): string {
  const normalized = route.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new Error("ayjnt: AgentClient route must contain at least one path segment");
  }
  return `${normalized}/${encodeURIComponent(name)}`;
}

/**
 * Browser client for an Ayjnt route.
 *
 * This subclasses Cloudflare's AgentClient and only translates Ayjnt's
 * file-based route plus instance name into the upstream `basePath` option.
 * State sync, callable RPC, reconnect behavior, and `ready` are all provided
 * by the Cloudflare client.
 */
export class AgentClient<
  AgentT = unknown,
  State = AgentT extends { get state(): infer S } ? S : AgentT,
> extends CloudflareAgentClient<AgentT, State> {
  constructor(options: AyjntAgentClientOptions<State>) {
    const {
      route,
      name = "default",
      agent = "AyjntAgent",
      ...upstream
    } = options;
    super({
      ...upstream,
      agent,
      basePath: agentBasePath(route, name),
    });
  }
}

export { CloudflareAgentClient };
export type { CloudflareAgentClientOptions };
