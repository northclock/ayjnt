import { Agent } from "agents";

type Env = Record<string, never>;

/**
 * Admin users endpoint — reachable at /admin/users/:id only with a valid
 * Authorization header. Both the root middleware (log + timing) and the
 * admin middleware (auth gate) run before this handler.
 */
export default class AdminUsersAgent extends Agent<Env, { visits: number }> {
  override initialState = { visits: 0 };

  override async onRequest(): Promise<Response> {
    this.setState({ visits: this.state.visits + 1 });
    return Response.json({
      instance: this.name,
      visits: this.state.visits,
      message: "you passed the admin gate",
    });
  }
}
