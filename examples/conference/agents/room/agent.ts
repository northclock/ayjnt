import {
  Agent,
  callable,
  type Connection,
  type WSMessage,
} from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

/** Public-facing participant record. Lives in DO state so every UI sees it. */
type Participant = {
  /** Stable id minted by the client and shared between the room agent and
   *  the user's own Transcriber agent. NOT the underlying WebSocket id —
   *  using a shared id means utterances RPC'd in from a Transcriber can
   *  attribute themselves to a known participant in this room. */
  id: string;
  displayName: string;
  joinedAt: number;
  muted: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
};

/** One line of the conversation log. */
type TranscriptEntry = {
  id: string;
  participantId: string;
  displayName: string;
  text: string;
  at: number;
};

type State = {
  /** Every currently-connected participant. Derived from
   *  `getConnections()` whenever it changes — never written directly
   *  from outside the agent. */
  participants: Participant[];
  /** Newest-at-end conversation log. Capped at 200 lines so DO state
   *  stays small. Persisted state syncs to new clients automatically. */
  transcript: TranscriptEntry[];
};

const TRANSCRIPT_LIMIT = 200;

/** Per-connection state we tuck onto `conn.setState({...})`. */
type ConnState = {
  /** The client's self-minted participant id (shared with their
   *  Transcriber agent). Null until they send `hello`. */
  participantId: string | null;
  displayName: string | null;
  muted: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
};

/** Wire protocol — JSON frames from the client. (Audio doesn't pass
 *  through this agent at all — it flows to the Transcriber instead.) */
type ClientFrame =
  | {
      kind: "hello";
      participantId: string;
      displayName: string;
    }
  | {
      kind: "media-state";
      muted?: boolean;
      cameraOn?: boolean;
      screenSharing?: boolean;
    }
  | {
      kind: "webrtc";
      to: string;
      signal: WebRTCSignal;
    };

/** WebRTC signaling payloads relayed through the agent. */
type WebRTCSignal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit | null };

/** Server → client frames not in state sync. */
type ServerFrame = {
  kind: "webrtc-from";
  from: string;
  signal: WebRTCSignal;
};

/**
 * ConferenceRoom — one DO per room (e.g. `/conference/standup-monday`).
 *
 * Responsibilities:
 *   1. Track connected participants in shared state, broadcast to all
 *      UIs via the WebSocket state sync.
 *   2. Relay WebRTC signaling (offer/answer/ICE) between participants
 *      so they can establish direct P2P media connections without
 *      leaking IPs through the agent.
 *   3. Hold the shared transcript. Each user's Transcriber agent RPCs
 *      `recordUtterance(participantId, text)` here when its Whisper
 *      session finalizes an utterance — the room verifies the speaker
 *      against its participants table and appends to the log.
 *
 * This agent does NOT do speech-to-text itself. STT runs in a separate
 * per-user `Transcriber` DO so each participant gets their own STT
 * session (and so the transcript never has "Unknown" entries — every
 * utterance is attributable to a participant the room knows about).
 * It's not the most resource-efficient split (you could fold it back
 * into one DO), but the architecture demonstrates that ayjnt agents
 * compose cleanly via typed RPC.
 *
 * Why P2P mesh for media: simple to wire up, no Cloudflare Realtime SFU
 * setup required, works well for ~2–4 participants. Bandwidth scales
 * O(n²) so don't push past a handful of users.
 */
export default class ConferenceRoom extends Agent<GeneratedEnv, State> {
  override initialState: State = { participants: [], transcript: [] };

  override async onConnect(conn: Connection): Promise<void> {
    // No identity yet — they send participantId + displayName in `hello`.
    conn.setState({
      participantId: null,
      displayName: null,
      muted: false,
      cameraOn: true,
      screenSharing: false,
    } satisfies ConnState);
  }

  override async onMessage(
    conn: Connection,
    message: WSMessage,
  ): Promise<void> {
    // The room agent doesn't receive audio frames — those go straight
    // to the participant's Transcriber agent. Drop any binary frames
    // that show up here as a safety net.
    if (message instanceof ArrayBuffer) return;
    if (typeof message !== "string") return;

    const frame = JSON.parse(message) as ClientFrame;
    switch (frame.kind) {
      case "hello": {
        const displayName = frame.displayName.slice(0, 60).trim();
        const participantId = frame.participantId.slice(0, 64).trim();
        if (!displayName || !participantId) return;
        conn.setState({
          ...(conn.state as ConnState),
          participantId,
          displayName,
        });
        this.refreshParticipants();
        break;
      }
      case "media-state": {
        const prev = conn.state as ConnState;
        conn.setState({
          ...prev,
          muted: frame.muted ?? prev.muted,
          cameraOn: frame.cameraOn ?? prev.cameraOn,
          screenSharing: frame.screenSharing ?? prev.screenSharing,
        });
        this.refreshParticipants();
        break;
      }
      case "webrtc": {
        // Pure relay — look up the target connection by participantId
        // and forward the signal tagged with sender's participantId.
        const target = this.connectionByParticipantId(frame.to);
        if (!target) return;
        const senderId = (conn.state as ConnState).participantId;
        if (!senderId) return;
        const out: ServerFrame = {
          kind: "webrtc-from",
          from: senderId,
          signal: frame.signal,
        };
        target.send(JSON.stringify(out));
        break;
      }
    }
  }

  override async onClose(_conn: Connection): Promise<void> {
    this.refreshParticipants();
  }

  /**
   * Inter-agent RPC entry point — called by Transcriber DOs when their
   * Whisper session finalizes an utterance. The room verifies the
   * participantId is currently in the room (no zombie utterances from
   * a transcriber that didn't get the close signal) and appends to the
   * shared transcript.
   *
   * Public method on the DO class — `getAgent<ConferenceRoom>(env.CONFERENCE_ROOM, roomId)`
   * returns a stub with `recordUtterance` typed.
   */
  async recordUtterance(participantId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const participant = this.state.participants.find(
      (p) => p.id === participantId,
    );
    // Drop utterances from a participant who isn't currently connected.
    // Common case: their WS closed mid-utterance and the STT session
    // flushed one final result. We don't want orphan lines in the log.
    if (!participant) return;

    const entry: TranscriptEntry = {
      id: crypto.randomUUID(),
      participantId,
      displayName: participant.displayName,
      text: trimmed,
      at: Date.now(),
    };
    this.setState({
      ...this.state,
      transcript: [...this.state.transcript, entry].slice(-TRANSCRIPT_LIMIT),
    });
  }

  /** @callable surface for the UI — wipe the transcript for everyone. */
  @callable({ description: "Clear the conversation transcript." })
  async clearTranscript(): Promise<void> {
    this.setState({ ...this.state, transcript: [] });
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  /** Look up the connection currently bound to a given participantId. */
  private connectionByParticipantId(id: string): Connection | undefined {
    for (const c of this.getConnections()) {
      if ((c.state as ConnState | null)?.participantId === id) return c;
    }
    return undefined;
  }

  /** Re-derive participants from connection state, broadcast if changed. */
  private refreshParticipants(): void {
    const next: Participant[] = [];
    for (const c of this.getConnections()) {
      const s = c.state as ConnState | null;
      if (!s || !s.participantId || !s.displayName) continue;
      next.push({
        id: s.participantId,
        displayName: s.displayName,
        joinedAt: this.findJoinedAt(s.participantId) ?? Date.now(),
        muted: s.muted,
        cameraOn: s.cameraOn,
        screenSharing: s.screenSharing,
      });
    }
    next.sort((a, b) => a.joinedAt - b.joinedAt);
    if (sameParticipants(next, this.state.participants)) return;
    this.setState({ ...this.state, participants: next });
  }

  private findJoinedAt(id: string): number | undefined {
    return this.state.participants.find((p) => p.id === id)?.joinedAt;
  }
}

function sameParticipants(a: Participant[], b: Participant[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.displayName !== y.displayName ||
      x.muted !== y.muted ||
      x.cameraOn !== y.cameraOn ||
      x.screenSharing !== y.screenSharing
    ) {
      return false;
    }
  }
  return true;
}
