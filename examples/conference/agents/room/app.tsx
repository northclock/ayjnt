import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgent } from "@ayjnt/room";
import { PeerMesh, type SignalPayload } from "./peer-mesh.ts";
import { startAudioCapture, type AudioCaptureHandle } from "./audio-capture.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Wire-protocol mirror of the agent files (kept here, not imported from the
// agent file, because app.tsx is bundled for the browser and agent.ts uses
// worker-only modules like `agents`/`@cloudflare/voice` that don't resolve
// in a browser bundle).
// ─────────────────────────────────────────────────────────────────────────────

type Participant = {
  id: string;
  displayName: string;
  joinedAt: number;
  muted: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
};

type TranscriptEntry = {
  id: string;
  participantId: string;
  displayName: string;
  text: string;
  at: number;
};

type RoomState = {
  participants: Participant[];
  transcript: TranscriptEntry[];
};

type RoomServerFrame = {
  kind: "webrtc-from";
  from: string;
  signal: SignalPayload;
};

/**
 * ConferenceUI — Zoom-lite. Multi-participant video call with live Whisper
 * transcription per speaker.
 *
 * Architecture (two agents in play):
 *
 *   ┌─ this client ────────────────────────────────────────────────┐
 *   │  ws #1 → ConferenceRoom (room agent)                         │
 *   │    ↑ hello, media-state, webrtc signaling                    │
 *   │    ↓ webrtc-from, state sync (participants + transcript)     │
 *   │                                                              │
 *   │  ws #2 → Transcriber (per-user STT agent)                    │
 *   │    ↑ bind (once), then binary 16kHz int16 PCM                │
 *   │    On utterance: Transcriber → RPC → ConferenceRoom          │
 *   │                                                              │
 *   │  WebRTC mesh: P2P media between participants.                │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Stable participantId minted on join is the shared key — both agents
 * know the user by the same id, so the transcript never has unknown
 * speakers.
 */
export default function ConferenceUI() {
  const agent = useAgent();
  const state = (agent.state ?? {
    participants: [],
    transcript: [],
  }) as RoomState;

  // ───────────────────────────────────────────────────────────────────────
  // Identity. participantId is the shared key between this client, the
  // ConferenceRoom (`/conference/<roomId>`), and the user's Transcriber
  // DO (`/transcriber/<participantId>`).
  // ───────────────────────────────────────────────────────────────────────
  const participantId = useMemo(() => crypto.randomUUID(), []);
  const roomId = agent.name; // `useAgent` carries the instance id.
  const [displayName, setDisplayName] = useState("");
  const [joined, setJoined] = useState(false);

  // ───────────────────────────────────────────────────────────────────────
  // Media — local stream + flags.
  // ───────────────────────────────────────────────────────────────────────
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-peer remote streams keyed by peer's participantId.
  const [peerStreams, setPeerStreams] = useState<Record<string, MediaStream>>(
    {},
  );

  // Long-lived handles kept in refs so they survive renders.
  const meshRef = useRef<PeerMesh | null>(null);
  const transcriberWsRef = useRef<WebSocket | null>(null);
  const audioHandleRef = useRef<AudioCaptureHandle | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  // Live `muted` flag accessible from the audio-capture closure without
  // re-creating the pipeline whenever the user toggles mute.
  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // ───────────────────────────────────────────────────────────────────────
  // Intercept room WebSocket messages so the WebRTC signaling layer can
  // see the `webrtc-from` frames. (State-sync frames bypass this and
  // arrive via `agent.state` directly.)
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!joined) return;
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let frame: RoomServerFrame;
      try {
        frame = JSON.parse(event.data) as RoomServerFrame;
      } catch {
        return;
      }
      if (frame.kind === "webrtc-from") {
        meshRef.current?.onSignal(frame.from, frame.signal);
      }
    };
    agent.addEventListener("message", onMessage);
    return () => agent.removeEventListener("message", onMessage);
  }, [agent, joined]);

  // ───────────────────────────────────────────────────────────────────────
  // Instantiate the peer mesh once we've joined. Stable `participantId`
  // = key for perfect-negotiation collision resolution.
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!joined) return;
    const mesh = new PeerMesh({
      selfId: participantId,
      sendSignal: (toPeerId, signal) => {
        agent.send(JSON.stringify({ kind: "webrtc", to: toPeerId, signal }));
      },
      onPeerStream: (peerId, stream) => {
        setPeerStreams((prev) =>
          prev[peerId] === stream ? prev : { ...prev, [peerId]: stream },
        );
      },
      onPeerGone: (peerId) => {
        setPeerStreams((prev) => {
          if (!(peerId in prev)) return prev;
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
      },
    });
    meshRef.current = mesh;
    return () => {
      mesh.close();
      meshRef.current = null;
    };
  }, [joined, participantId, agent]);

  // Re-attach local stream to peer mesh whenever it changes.
  useEffect(() => {
    meshRef.current?.setLocalStream(localStream);
  }, [localStream]);

  // Connect to / disconnect from peers based on participants list.
  useEffect(() => {
    if (!meshRef.current) return;
    const knownIds = new Set(state.participants.map((p) => p.id));
    for (const p of state.participants) {
      if (p.id !== participantId) meshRef.current.ensurePeer(p.id);
    }
    for (const peerId of Object.keys(peerStreams)) {
      if (!knownIds.has(peerId)) meshRef.current.removePeer(peerId);
    }
  }, [state.participants, participantId, peerStreams]);

  // ───────────────────────────────────────────────────────────────────────
  // Join flow — gum, send hello to room, open Transcriber WS, start audio.
  // ───────────────────────────────────────────────────────────────────────
  const onJoin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = displayName.trim();
      if (!name) return;
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { width: 640, height: 480 },
        });
        setLocalStream(stream);
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;

        // Tell the room who we are. From here on, the room sees this
        // participant by `participantId`, displays `displayName`, and
        // can route WebRTC signaling.
        agent.send(
          JSON.stringify({ kind: "hello", participantId, displayName: name }),
        );

        // Open the second WebSocket — to the user's personal
        // Transcriber DO. The transcriber URL is keyed by
        // participantId (one DO instance per participant).
        const ws = openTranscriberWs(participantId);
        transcriberWsRef.current = ws;
        ws.addEventListener("open", () => {
          ws.send(
            JSON.stringify({
              kind: "bind",
              roomId,
              participantId,
              displayName: name,
            }),
          );
        });

        // Audio pipeline → send binary frames to the Transcriber, NOT
        // the room. The transcriber feeds them to Whisper and
        // RPC-forwards finalized utterances to the room.
        const micTrack = stream.getAudioTracks()[0];
        if (micTrack) {
          audioHandleRef.current = await startAudioCapture(
            micTrack,
            (chunk) => {
              if (mutedRef.current) return;
              if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
            },
          );
        }

        setJoined(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't access camera or microphone.",
        );
      }
    },
    [agent, displayName, participantId, roomId],
  );

  // ───────────────────────────────────────────────────────────────────────
  // Controls — mute / camera / screen share.
  // ───────────────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const next = !muted;
    setMuted(next);
    for (const t of localStream.getAudioTracks()) t.enabled = !next;
    agent.send(JSON.stringify({ kind: "media-state", muted: next }));
  }, [agent, localStream, muted]);

  const toggleCamera = useCallback(() => {
    if (!localStream) return;
    const next = !cameraOn;
    setCameraOn(next);
    for (const t of localStream.getVideoTracks()) t.enabled = next;
    agent.send(JSON.stringify({ kind: "media-state", cameraOn: next }));
  }, [agent, localStream, cameraOn]);

  const toggleScreenShare = useCallback(async () => {
    if (!localStream) return;
    try {
      if (!screenSharing) {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        const screenTrack = display.getVideoTracks()[0];
        if (!screenTrack) return;
        screenTrackRef.current = screenTrack;
        meshRef.current?.replaceVideoTrack(screenTrack);
        // Rebuild the local stream so the self-tile reflects the
        // screen too — React's <video srcObject={...}> doesn't
        // auto-refresh when a track is swapped.
        const next = new MediaStream();
        next.addTrack(screenTrack);
        for (const t of localStream.getAudioTracks()) next.addTrack(t);
        setLocalStream(next);
        setScreenSharing(true);
        // User clicked the browser's native "Stop sharing" UI button.
        screenTrack.onended = () => {
          void revertToCamera();
        };
        agent.send(JSON.stringify({ kind: "media-state", screenSharing: true }));
      } else {
        await revertToCamera();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      setError(err instanceof Error ? err.message : "Screen share failed.");
    }
  }, [agent, localStream, screenSharing]);

  const revertToCamera = useCallback(async () => {
    if (!localStream) return;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;

    const camera = cameraTrackRef.current;
    if (camera && camera.readyState === "live") {
      meshRef.current?.replaceVideoTrack(camera);
      const next = new MediaStream();
      next.addTrack(camera);
      for (const t of localStream.getAudioTracks()) next.addTrack(t);
      setLocalStream(next);
    } else {
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        const newCam = fresh.getVideoTracks()[0];
        if (!newCam) return;
        cameraTrackRef.current = newCam;
        meshRef.current?.replaceVideoTrack(newCam);
        const next = new MediaStream();
        next.addTrack(newCam);
        for (const t of localStream.getAudioTracks()) next.addTrack(t);
        setLocalStream(next);
      } catch {
        // Couldn't re-acquire camera — leave video off.
      }
    }
    setScreenSharing(false);
    agent.send(JSON.stringify({ kind: "media-state", screenSharing: false }));
  }, [agent, localStream]);

  const clearTranscript = useCallback(() => {
    if (!confirm("Clear the transcript for everyone in the room?")) return;
    void agent.call("clearTranscript", []);
  }, [agent]);

  // ───────────────────────────────────────────────────────────────────────
  // Cleanup on unmount.
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      audioHandleRef.current?.stop();
      audioHandleRef.current = null;
      transcriberWsRef.current?.close();
      transcriberWsRef.current = null;
      if (localStream) {
        for (const track of localStream.getTracks()) track.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────
  if (!joined) {
    return (
      <main style={styles.lobby}>
        <h1 style={styles.title}>Conference</h1>
        <p style={styles.lobbyMeta}>
          room: <code>{roomId}</code>
          <br />
          Pick a display name to join. Audio is transcribed live with a
          per-user Whisper agent — everyone sees the same conversation
          log, attributed by speaker.
        </p>
        <form onSubmit={onJoin} style={styles.lobbyForm}>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            style={styles.input}
            required
            maxLength={60}
            autoFocus
          />
          <button type="submit" style={styles.primary}>
            join
          </button>
        </form>
        {error && <p style={styles.error}>{error}</p>}
      </main>
    );
  }

  const others = state.participants.filter((p) => p.id !== participantId);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.titleSmall}>
          Conference / <code style={styles.room}>{roomId}</code>
        </h1>
        <div style={styles.controls}>
          <button onClick={toggleMute} style={muted ? styles.btnActive : styles.btn}>
            {muted ? "unmute" : "mute"}
          </button>
          <button
            onClick={toggleCamera}
            style={!cameraOn ? styles.btnActive : styles.btn}
          >
            {cameraOn ? "camera off" : "camera on"}
          </button>
          <button
            onClick={toggleScreenShare}
            style={screenSharing ? styles.btnActive : styles.btn}
          >
            {screenSharing ? "stop sharing" : "share screen"}
          </button>
        </div>
      </header>

      {error && <p style={styles.error}>{error}</p>}

      <section style={styles.body}>
        <div style={styles.tilesArea}>
          <div style={styles.tiles}>
            <VideoTile
              stream={localStream}
              displayName={displayName + " (you)"}
              muted
              participant={state.participants.find(
                (p) => p.id === participantId,
              )}
            />
            {others.map((p) => (
              <VideoTile
                key={p.id}
                stream={peerStreams[p.id] ?? null}
                displayName={p.displayName}
                participant={p}
              />
            ))}
          </div>
          {others.length === 0 && (
            <p style={styles.hint}>
              You're the only one here. Open this URL in another tab or
              share with a teammate to join.
            </p>
          )}
        </div>

        <aside style={styles.transcriptPane}>
          <div style={styles.transcriptHeader}>
            <h2 style={styles.transcriptTitle}>
              Transcript ({state.transcript.length})
            </h2>
            {state.transcript.length > 0 && (
              <button onClick={clearTranscript} style={styles.linkBtn}>
                clear
              </button>
            )}
          </div>
          <TranscriptList
            entries={state.transcript}
            selfId={participantId}
          />
        </aside>
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Open a WebSocket to this user's Transcriber DO instance. The URL
 *  shape is ayjnt's standard `/<route>/<instance>` — `/transcriber/<participantId>`
 *  means "the transcriber instance owned by this participant". */
function openTranscriberWs(participantId: string): WebSocket {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${proto}//${location.host}/transcriber/${participantId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoTile
// ─────────────────────────────────────────────────────────────────────────────

function VideoTile({
  stream,
  displayName,
  muted,
  participant,
}: {
  stream: MediaStream | null;
  displayName: string;
  muted?: boolean;
  participant?: Participant;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  const videoOff =
    participant && !participant.cameraOn && !participant.screenSharing;

  return (
    <div style={styles.tile}>
      {videoOff ? (
        <div style={styles.videoOff}>
          <span style={styles.videoOffInitials}>{initialsOf(displayName)}</span>
        </div>
      ) : (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          style={styles.video}
        />
      )}
      <div style={styles.tileFooter}>
        <span style={styles.tileName}>
          {displayName}
          {participant?.screenSharing ? " · sharing" : ""}
        </span>
        {participant?.muted && <span style={styles.mutedBadge}>muted</span>}
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  return name
    .replace(/\(you\)$/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// TranscriptList
// ─────────────────────────────────────────────────────────────────────────────

function TranscriptList({
  entries,
  selfId,
}: {
  entries: TranscriptEntry[];
  selfId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const slack = 32;
    stickyRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
  }, []);

  useEffect(() => {
    if (!ref.current || !stickyRef.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries.length]);

  const colorFor = useMemo(() => {
    const cache = new Map<string, string>();
    return (id: string): string => {
      let cached = cache.get(id);
      if (cached) return cached;
      let hash = 0;
      for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
      }
      const hue = Math.abs(hash) % 360;
      cached = `hsl(${hue}, 70%, 35%)`;
      cache.set(id, cached);
      return cached;
    };
  }, []);

  if (entries.length === 0) {
    return (
      <p style={styles.empty}>
        Transcript is empty. Start speaking — each user's Transcriber
        agent forwards utterances here as Whisper finalizes them.
      </p>
    );
  }

  return (
    <div ref={ref} onScroll={onScroll} style={styles.transcriptScroll}>
      {entries.map((e) => (
        <div key={e.id} style={styles.transcriptLine}>
          <span
            style={{
              ...styles.transcriptSpeaker,
              color: colorFor(e.participantId),
            }}
          >
            {e.displayName}
            {e.participantId === selfId ? " (you)" : ""}
          </span>
          <span style={styles.transcriptText}>{e.text}</span>
          <span style={styles.transcriptTime}>
            {new Date(e.at).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = {
  lobby: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 480,
    margin: "80px auto",
    padding: 24,
    textAlign: "center" as const,
  },
  title: { fontSize: 28, marginBottom: 8 },
  lobbyMeta: {
    color: "#555",
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 24,
  },
  lobbyForm: { display: "flex", gap: 8, justifyContent: "center" },
  input: {
    padding: "10px 12px",
    fontSize: 15,
    border: "1px solid #d4d4d8",
    borderRadius: 6,
    fontFamily: "inherit",
    flex: 1,
  },
  primary: {
    padding: "10px 20px",
    fontSize: 15,
    background: "#2563eb",
    color: "#fff",
    border: "1px solid #2563eb",
    borderRadius: 6,
    cursor: "pointer",
  },

  main: {
    fontFamily: "system-ui, sans-serif",
    height: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    padding: 0,
    margin: 0,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 20px",
    borderBottom: "1px solid #e5e7eb",
    background: "#fafafa",
  },
  titleSmall: { fontSize: 16, margin: 0, fontWeight: 600 },
  room: { fontSize: 14, color: "#555", fontFamily: "ui-monospace, monospace" },
  controls: { display: "flex", gap: 8 },
  btn: {
    padding: "6px 12px",
    fontSize: 13,
    background: "#fff",
    border: "1px solid #d4d4d8",
    borderRadius: 6,
    cursor: "pointer",
  },
  btnActive: {
    padding: "6px 12px",
    fontSize: 13,
    background: "#dc2626",
    color: "#fff",
    border: "1px solid #dc2626",
    borderRadius: 6,
    cursor: "pointer",
  },
  error: {
    color: "#991b1b",
    background: "#fef2f2",
    padding: "8px 12px",
    margin: "8px 20px",
    borderLeft: "3px solid #dc2626",
    fontSize: 13,
  },

  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  tilesArea: {
    flex: 2,
    padding: 16,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    overflow: "auto",
    minWidth: 0,
  },
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 12,
  },
  tile: {
    background: "#0f172a",
    borderRadius: 8,
    overflow: "hidden",
    aspectRatio: "4 / 3",
    position: "relative" as const,
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    transform: "scaleX(-1)",
  },
  videoOff: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1e293b",
  },
  videoOffInitials: { fontSize: 64, color: "#94a3b8", fontWeight: 600 },
  tileFooter: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: "8px 12px",
    background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)",
    color: "#fff",
    fontSize: 13,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tileName: { fontWeight: 500 },
  mutedBadge: {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 10,
    background: "#dc2626",
    color: "#fff",
    fontWeight: 600,
  },
  hint: { color: "#666", fontSize: 13, fontStyle: "italic" as const },

  transcriptPane: {
    flex: 1,
    minWidth: 280,
    maxWidth: 420,
    borderLeft: "1px solid #e5e7eb",
    background: "#fafafa",
    display: "flex",
    flexDirection: "column" as const,
  },
  transcriptHeader: {
    padding: "12px 16px",
    borderBottom: "1px solid #e5e7eb",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  transcriptTitle: { fontSize: 14, margin: 0, fontWeight: 600 },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#6b7280",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "underline",
  },
  transcriptScroll: {
    flex: 1,
    overflow: "auto",
    padding: "8px 16px 16px",
  },
  transcriptLine: {
    padding: "8px 0",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    lineHeight: 1.5,
    display: "grid",
    gridTemplateColumns: "1fr auto",
    columnGap: 8,
    rowGap: 2,
  },
  transcriptSpeaker: {
    fontWeight: 600,
    fontSize: 12,
    gridColumn: "1 / 2",
  },
  transcriptText: {
    gridColumn: "1 / 2",
    color: "#1f2937",
  },
  transcriptTime: {
    gridColumn: "2 / 3",
    gridRow: "1 / 2",
    fontSize: 11,
    color: "#9ca3af",
    fontFamily: "ui-monospace, monospace",
    alignSelf: "start",
  },
  empty: {
    padding: 16,
    color: "#9ca3af",
    fontSize: 13,
    fontStyle: "italic" as const,
    lineHeight: 1.6,
  },
};
