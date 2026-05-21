import { useVoiceAgent } from "@ayjnt/chat";

/**
 * Tiny voice UI. The generated `useVoiceAgent` hook from `@ayjnt/chat`
 * is pre-bound to `ChatVoice` and ayjnt's URL shape — there's no
 * `basePath` or `agent` argument to thread through.
 *
 * Return shape matches `useVoiceAgent` from `@cloudflare/voice/react`
 * exactly: status, transcript, audioLevel, startCall, endCall,
 * toggleMute, sendText, etc.
 */
export default function VoiceUI() {
  const v = useVoiceAgent();

  const inCall =
    v.status === "listening" ||
    v.status === "thinking" ||
    v.status === "speaking";

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Voice chat</h1>
      <p style={styles.meta}>
        status: <code>{v.status}</code> · audio level:{" "}
        <code>{v.audioLevel.toFixed(2)}</code>
      </p>

      <div style={styles.controls}>
        {!inCall ? (
          <button style={styles.primary} onClick={() => v.startCall()}>
            start call
          </button>
        ) : (
          <>
            <button style={styles.secondary} onClick={() => v.toggleMute()}>
              {v.isMuted ? "unmute" : "mute"}
            </button>
            <button style={styles.danger} onClick={() => v.endCall()}>
              end call
            </button>
          </>
        )}
      </div>

      {v.interimTranscript && (
        <p style={styles.interim}>
          <em>{v.interimTranscript}</em>
        </p>
      )}

      <ol style={styles.transcript}>
        {v.transcript.map((m, i) => (
          <li key={i} style={styles.line}>
            <strong style={styles.role}>{m.role}:</strong> {m.text}
          </li>
        ))}
      </ol>
    </main>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 640,
    margin: "32px auto",
    padding: 24,
  },
  title: { fontSize: 24, margin: 0 },
  meta: { color: "#555", fontSize: 13, marginTop: 4 },
  controls: { display: "flex", gap: 8, margin: "16px 0" },
  primary: {
    padding: "8px 16px",
    background: "#2563eb",
    color: "#fff",
    border: "1px solid #2563eb",
    borderRadius: 4,
    cursor: "pointer",
  },
  secondary: {
    padding: "8px 16px",
    background: "transparent",
    color: "#2563eb",
    border: "1px solid #2563eb",
    borderRadius: 4,
    cursor: "pointer",
  },
  danger: {
    padding: "8px 16px",
    background: "transparent",
    color: "#c44",
    border: "1px solid #c44",
    borderRadius: 4,
    cursor: "pointer",
  },
  interim: {
    fontSize: 14,
    color: "#888",
    fontStyle: "italic" as const,
  },
  transcript: {
    listStyle: "none",
    padding: 0,
    marginTop: 16,
    fontSize: 14,
  },
  line: {
    padding: "8px 0",
    borderBottom: "1px solid #eee",
  },
  role: { textTransform: "capitalize" as const, marginRight: 8 },
};
