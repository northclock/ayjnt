import { Agent } from "agents";

type Env = Record<string, never>;

/**
 * CatalogAgent — the host for the React UI in app.tsx. Has no real
 * state of its own; the UI fetches `/__ayjnt/catalog` directly and
 * renders the tree from there.
 *
 * We still need an agent.ts because an agent folder is what gives a
 * route an HTML shell — `app.tsx` is bound to its sibling `agent.ts`.
 */
export default class CatalogAgent extends Agent<Env, Record<string, never>> {
  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name });
  }
}
