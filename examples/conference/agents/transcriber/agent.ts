import { Agent, type Connection, type WSMessage } from "agents";
import { getAgent } from "ayjnt/rpc";
import { WorkersAIFluxSTT, type TranscriberSession } from "@cloudflare/voice";
import type { GeneratedEnv } from "@ayjnt/env";
import type ConferenceRoom from "../room/agent.ts";

/** Frames the client sends. The `bind` frame arrives once on connect and
 *  tells us which room + participantId to attribute utterances to.
 *  After that, binary frames are 16kHz mono int16 PCM — fed to STT. */
type ClientFrame = {
  kind: "bind";
  roomId: string;
  participantId: string;
  displayName: string;
};

/** Per-connection state. Stashed via `conn.setState({...})` so the
 *  Agents SDK ships it with every message — no side map needed. */
type ConnState = {
  roomId: string | null;
  participantId: string | null;
  displayName: string | null;
};

/**
 * Transcriber — one DO instance per user.
 *
 * Each participant in a conference call opens TWO WebSockets:
 *   1. To their `ConferenceRoom` agent — state sync, signaling relay.
 *   2. To this `Transcriber` agent — audio stream + STT.
 *
 * Why the split: one Whisper session per speaker means one STT pipeline
 * per DO, isolated from every other speaker's audio. Each Transcriber
 * forwards finalized utterances to the room via typed inter-agent RPC
 * (`getAgent<ConferenceRoom>(env.CONFERENCE_ROOM, roomId).recordUtterance(...)`).
 * The room ties the utterance back to a known participant by id — so
 * there are never "Unknown speaker" entries in the transcript.
 *
 * It's not the most efficient architecture (you could fold STT back
 * into the room DO and key sessions on connection id), but the split
 * makes the agents compose, and it's a clean place to show ayjnt's
 * inter-agent RPC pattern.
 *
 * Lifecycle:
 *   - onConnect           → empty conn state
 *   - first `bind` frame  → stash identity, spin up Whisper session
 *   - binary PCM frames   → feed STT session
 *   - STT onUtterance     → RPC to room.recordUtterance(...)
 *   - onClose             → close STT session
 */
export default class Transcriber extends Agent<GeneratedEnv> {
  /** Per-connection STT sessions. Non-serializable, so they live on the
   *  agent instance (not in DO state). Cleaned up in `onClose`. */
  private sessions = new Map<string, TranscriberSession>();

  override async onConnect(conn: Connection): Promise<void> {
    conn.setState({
      roomId: null,
      participantId: null,
      displayName: null,
    } satisfies ConnState);
  }

  override async onMessage(
    conn: Connection,
    message: WSMessage,
  ): Promise<void> {
    // Binary frames → STT. Only forward if a session exists (i.e. the
    // client already sent `bind`).
    if (message instanceof ArrayBuffer) {
      const session = this.sessions.get(conn.id);
      if (session) session.feed(message);
      return;
    }
    if (typeof message !== "string") return;

    const frame = JSON.parse(message) as ClientFrame;
    if (frame.kind !== "bind") return;

    // Validate + stash identity on the connection.
    const roomId = frame.roomId.slice(0, 80).trim();
    const participantId = frame.participantId.slice(0, 64).trim();
    const displayName = frame.displayName.slice(0, 60).trim();
    if (!roomId || !participantId || !displayName) return;
    conn.setState({ roomId, participantId, displayName });

    // Spin up the Whisper session for this connection. `onUtterance`
    // fires once Whisper finalizes a turn — we forward to the room
    // there, NOT on interim text (interim is noisy and would spam the
    // transcript).
    const session = new WorkersAIFluxSTT(this.env.AI).createSession({
      language: "en",
      onUtterance: (text: string) => {
        // Inter-agent RPC. Don't await — the audio pipeline shouldn't
        // backpressure on the room DO's response, and the RPC itself
        // is fire-and-forget from this side's perspective (room appends
        // to state, broadcasts, done).
        this.forwardUtterance(conn, text).catch((err) =>
          console.error("[transcriber] forward failed", err),
        );
      },
    });
    this.sessions.set(conn.id, session);
  }

  override async onClose(conn: Connection): Promise<void> {
    const session = this.sessions.get(conn.id);
    if (session) {
      try {
        session.close();
      } catch {
        // Already closed; ignore.
      }
      this.sessions.delete(conn.id);
    }
  }

  /** Type-safe inter-agent RPC into the room DO. The `ConferenceRoom`
   *  type comes from a `import type` so we don't pull worker-only
   *  modules into the transcriber's bundle. */
  private async forwardUtterance(
    conn: Connection,
    text: string,
  ): Promise<void> {
    const s = conn.state as ConnState | null;
    if (!s || !s.roomId || !s.participantId) return;

    // `getAgent` returns a typed DO stub. The room's `recordUtterance`
    // method is a public TypeScript method on the class — it doesn't
    // need `@callable` because we're calling it via the DO RPC channel,
    // not from a browser. Errors propagate back through the await.
    const room = await getAgent<ConferenceRoom>(
      this.env.CONFERENCE_ROOM,
      s.roomId,
    );
    await room.recordUtterance(s.participantId, text);
  }
}
