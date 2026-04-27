import { useEffect, useRef, useState } from "react";
import { useAgent } from "@ayjnt/room";

type ServerFrame = { kind: "typing"; from: string; on: boolean };

function pickName(): string {
  const stored = localStorage.getItem("ayjnt-chat-name");
  if (stored) return stored;
  const name = prompt("Pick a display name") ?? "guest";
  const trimmed = name.trim().slice(0, 24) || "guest";
  localStorage.setItem("ayjnt-chat-name", trimmed);
  return trimmed;
}

export default function Room() {
  const [name] = useState(pickName);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState<Record<string, number>>({});
  const scroller = useRef<HTMLDivElement | null>(null);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

  const agent = useAgent({
    onMessage: (raw: MessageEvent) => {
      // The state-sync messages from the SDK go through too — only inspect
      // ours (envelope is JSON with a `kind` field).
      try {
        const msg = JSON.parse(raw.data as string) as ServerFrame;
        if (msg.kind === "typing") {
          if (msg.on) {
            setTyping((t) => ({ ...t, [msg.from]: Date.now() }));
            // Auto-clear after 2.5s in case `typing:false` never arrives.
            clearTimeout(typingTimers.current[msg.from]);
            typingTimers.current[msg.from] = setTimeout(() => {
              setTyping((t) => {
                const next = { ...t };
                delete next[msg.from];
                return next;
              });
            }, 2500);
          } else {
            setTyping((t) => {
              const next = { ...t };
              delete next[msg.from];
              return next;
            });
          }
        }
      } catch {
        /* not our envelope, ignore */
      }
    },
  });

  // Identify ourselves once the socket is open. agent.send is queued by the
  // SDK if the socket isn't ready yet, so this is safe to call eagerly.
  useEffect(() => {
    agent.send(JSON.stringify({ kind: "hello", name }));
  }, [agent, name]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [agent.state?.messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    agent.send(JSON.stringify({ kind: "say", text }));
    agent.send(JSON.stringify({ kind: "typing", on: false }));
    setDraft("");
  };

  const onChange = (text: string) => {
    setDraft(text);
    agent.send(JSON.stringify({ kind: "typing", on: text.length > 0 }));
  };

  const messages = agent.state?.messages ?? [];
  const members = agent.state?.members ?? [];
  const typingNames = Object.keys(typing).filter((n) => n !== name);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>#{agent.name}</h1>
          <div style={styles.meta}>
            you: <strong>{name}</strong> · {members.length} online
          </div>
        </div>
        <ul style={styles.members}>
          {members.map((m) => (
            <li
              key={m}
              style={{
                ...styles.memberPill,
                ...(m === name ? styles.memberPillSelf : null),
              }}
            >
              {m}
            </li>
          ))}
        </ul>
      </header>

      <div ref={scroller} style={styles.scroller}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            no messages yet — say hi to start the room
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={styles.row}>
            <div style={styles.from}>{m.from}</div>
            <div style={styles.bubble}>{m.text}</div>
            <div style={styles.time}>
              {new Date(m.at).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>

      <div style={styles.typingHint}>
        {typingNames.length > 0
          ? `${typingNames.join(", ")} ${
              typingNames.length === 1 ? "is" : "are"
            } typing…`
          : "\u00a0"}
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
          onChange={(e) => onChange(e.target.value)}
          placeholder={`message #${agent.name}…`}
          autoFocus
        />
        <button style={styles.send} type="submit">
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
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    boxSizing: "border-box" as const,
  },
  header: {
    borderBottom: "1px solid #eee",
    paddingBottom: 12,
    marginBottom: 8,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  title: { margin: 0, fontSize: 22 },
  meta: { color: "#666", fontSize: 13, marginTop: 2 },
  members: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 4,
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  memberPill: {
    background: "#f0f0f0",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 12,
  },
  memberPillSelf: { background: "#dbeafe", color: "#1d4ed8" },
  scroller: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "8px 0",
  },
  empty: {
    textAlign: "center" as const,
    color: "#999",
    padding: 40,
    fontSize: 13,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "100px 1fr 80px",
    gap: 8,
    padding: "6px 0",
    alignItems: "baseline",
  },
  from: {
    color: "#555",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "right" as const,
  },
  bubble: { fontSize: 14 },
  time: {
    color: "#aaa",
    fontSize: 11,
    fontFamily: "ui-monospace, monospace",
  },
  typingHint: {
    color: "#888",
    fontSize: 12,
    fontStyle: "italic" as const,
    minHeight: 16,
    padding: "0 8px",
  },
  form: {
    display: "flex",
    gap: 8,
    borderTop: "1px solid #eee",
    paddingTop: 12,
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
};
