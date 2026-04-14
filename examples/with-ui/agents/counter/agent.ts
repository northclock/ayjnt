import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { count: number };

/**
 * A counter agent with state that syncs live to any connected UI. Each
 * `/counter/:id` URL is a separate DO — open two browser tabs pointing at
 * `/counter/room-1` and the `+` button in one tab updates the other.
 */
export default class CounterAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { count: 0 };

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
