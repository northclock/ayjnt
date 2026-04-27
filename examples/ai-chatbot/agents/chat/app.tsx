import { useEffect, useRef, useState } from "react";
import { useAgent } from "@ayjnt/chat";

export default function Chat() {
  const agent = useAgent();
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement | null>(null);

  const messages = agent.state?.messages ?? [];
  const streaming = agent.state?.streaming ?? false;
  const streamingId = agent.state?.streamingId;

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    await fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  };

  const reset = () =>
    fetch(window.location.pathname, { method: "DELETE" });

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>chat — {agent.name}</h1>
        <button style={styles.reset} onClick={reset} disabled={streaming}>
          new conversation
        </button>
      </header>

      <div ref={scroller} style={styles.scroller}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            ask anything — gemini-2.0-flash, conversation persisted in DO state
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              ...styles.bubble,
              ...(m.role === "user" ? styles.userBubble : styles.botBubble),
            }}
          >
            <div style={styles.role}>{m.role}</div>
            <div style={styles.text}>
              {m.text || (m.id === streamingId ? "▍" : "")}
              {m.id === streamingId && m.text && (
                <span style={styles.caret}>▍</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <form
        style={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          style={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={streaming ? "thinking…" : "ask something…"}
          disabled={streaming}
          autoFocus
        />
        <button
          style={{
            ...styles.send,
            ...(streaming || !draft.trim() ? styles.sendDisabled : null),
          }}
          type="submit"
          disabled={streaming || !draft.trim()}
        >
          send
        </button>
      </form>
    </main>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 720,
    margin: "0 auto",
    padding: 16,
    height: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    boxSizing: "border-box" as const,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 12,
    borderBottom: "1px solid #eee",
  },
  title: { margin: 0, fontSize: 20 },
  reset: {
    padding: "6px 12px",
    fontSize: 12,
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: 6,
    cursor: "pointer",
  },
  scroller: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "16px 0",
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  empty: {
    textAlign: "center" as const,
    color: "#999",
    padding: 60,
    fontSize: 13,
  },
  bubble: {
    maxWidth: "80%",
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 1.5,
  },
  userBubble: {
    background: "#1d4ed8",
    color: "white",
    alignSelf: "flex-end" as const,
  },
  botBubble: {
    background: "#f3f4f6",
    color: "#111",
    alignSelf: "flex-start" as const,
  },
  role: {
    fontSize: 10,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    opacity: 0.6,
    marginBottom: 4,
  },
  text: { whiteSpace: "pre-wrap" as const },
  caret: {
    display: "inline-block",
    marginLeft: 2,
    color: "#888",
    animation: "blink 1s steps(1) infinite",
  },
  form: {
    display: "flex",
    gap: 8,
    paddingTop: 12,
    borderTop: "1px solid #eee",
  },
  input: {
    flex: 1,
    padding: "10px 12px",
    border: "1px solid #ccc",
    borderRadius: 6,
    fontSize: 14,
    outline: "none",
  },
  send: {
    padding: "10px 18px",
    background: "#1d4ed8",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
  },
  sendDisabled: { background: "#9ca3af", cursor: "not-allowed" },
};
