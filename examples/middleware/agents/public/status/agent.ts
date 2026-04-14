import { Agent } from "agents";

type Env = Record<string, never>;

/**
 * Public status endpoint — reachable at /public/status/:id with no auth.
 * Only the root middleware runs for this agent (logging + timing).
 */
export default class StatusAgent extends Agent<Env, { pings: number }> {
  override initialState = { pings: 0 };

  override async onRequest(): Promise<Response> {
    this.setState({ pings: this.state.pings + 1 });
    return Response.json({
      instance: this.name,
      pings: this.state.pings,
      message: "no auth required — you're hitting the public route",
    });
  }
}
