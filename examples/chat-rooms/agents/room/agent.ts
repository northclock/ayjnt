import { Agent, type Connection, type WSMessage } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Message = {
  id: string;
  from: string;
  text: string;
  at: number;
};

type State = {
  /** Last 100 messages. State sync ships these to new connections too. */
  messages: Message[];
  /** Display names of currently-connected presences. */
  members: string[];
};

/** ClientFrame: every payload a connected user sends. Keep small + obvious. */
type ClientFrame =
  | { kind: "hello"; name: string }
  | { kind: "say"; text: string }
  | { kind: "typing"; on: boolean };

/** ServerFrame: ephemeral events that aren't worth persisting in state.
 *  Persistent stuff (members, last 100 messages) goes via setState. */
type ServerFrame = { kind: "typing"; from: string; on: boolean };

const HISTORY_LIMIT = 100;

/**
 * RoomAgent — one DO per chat room. Each /room/general, /room/random, etc.
 * is an independent room with its own message history and presence list.
 *
 * State sync delivers history + member list automatically (any client
 * connected via useAgent gets the State). Live typing notifications go
 * through broadcast() because they shouldn't pollute persisted state.
 */
export default class RoomAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { messages: [], members: [] };

  /** Map a websocket connection id → display name, kept in connection state. */
  override async onConnect(conn: Connection): Promise<void> {
    // We don't know the user's name yet — they send it in `hello`. Until
    // then, treat them as anonymous for presence display purposes.
    conn.setState({ name: null });
  }

  override async onMessage(
    conn: Connection,
    message: WSMessage,
  ): Promise<void> {
    if (typeof message !== "string") return;
    const frame = JSON.parse(message) as ClientFrame;

    switch (frame.kind) {
      case "hello": {
        conn.setState({ name: frame.name });
        this.refreshMembers();
        break;
      }
      case "say": {
        const name = (conn.state as { name: string | null } | null)?.name;
        if (!name) return; // Refuse messages from unidentified connections.
        const text = frame.text.trim();
        if (!text || text.length > 1000) return;

        const next: Message = {
          id: crypto.randomUUID(),
          from: name,
          text,
          at: Date.now(),
        };
        this.setState({
          ...this.state,
          messages: [...this.state.messages, next].slice(-HISTORY_LIMIT),
        });
        break;
      }
      case "typing": {
        const name = (conn.state as { name: string | null } | null)?.name;
        if (!name) return;
        const out: ServerFrame = { kind: "typing", from: name, on: frame.on };
        // Don't echo to the sender — they already know they're typing.
        this.broadcast(JSON.stringify(out), [conn.id]);
        break;
      }
    }
  }

  override async onClose(_conn: Connection): Promise<void> {
    this.refreshMembers();
  }

  /** Recompute the canonical members list from currently connected sockets. */
  private refreshMembers(): void {
    const names = new Set<string>();
    for (const c of this.getConnections()) {
      const name = (c.state as { name: string | null } | null)?.name;
      if (name) names.add(name);
    }
    const members = Array.from(names).sort();
    // Avoid pointless re-broadcasts when nothing changed.
    if (
      members.length === this.state.members.length &&
      members.every((n, i) => n === this.state.members[i])
    ) {
      return;
    }
    this.setState({ ...this.state, members });
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
