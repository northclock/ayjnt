import { useState } from "react";
import { useAgent } from "@ayjnt/support";

type LogEntry = { from: string; subject: string; at: number };

/**
 * SupportUI — dashboard for the SupportAgent's reply log.
 *
 * Production traffic flows through `onEmail(message)` (Cloudflare
 * Email Routing → worker `email()` handler → `routeAgentEmail` →
 * SupportAgent). That path can't easily be exercised in `bun run dev`,
 * so the UI uses `simulateInboundEmail(from, subject)` — a
 * `@callable` method that mirrors the same setState write the real
 * `onEmail` performs.
 *
 * Either way, the log updates here in real time via the WebSocket
 * state broadcast.
 */
export default function SupportUI() {
  const agent = useAgent();
  const log: LogEntry[] = (agent.state as { log?: LogEntry[] })?.log ?? [];

  const [from, setFrom] = useState("test@example.com");
  const [subject, setSubject] = useState("Question about pricing");
  const [busy, setBusy] = useState(false);

  async function onSimulate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await agent.call("simulateInboundEmail", [from, subject]);
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!confirm("Clear the reply log?")) return;
    await agent.call("clearLog", []);
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Support inbox</h1>
      <p style={styles.meta}>
        instance: <code>{agent.name}</code>
        <br />
        Real inbound traffic comes through Cloudflare Email Routing →{" "}
        <code>onEmail()</code>. For local dev, simulate one below.
      </p>

      <form onSubmit={onSimulate} style={styles.form}>
        <label style={styles.field}>
          <span style={styles.label}>From</span>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            type="email"
            style={styles.input}
            required
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={styles.input}
            required
          />
        </label>
        <button style={styles.primary} disabled={busy} type="submit">
          {busy ? "sending…" : "simulate inbound"}
        </button>
      </form>

      <div style={styles.subheader}>
        <h2 style={styles.subtitle}>Replied to ({log.length})</h2>
        {log.length > 0 && (
          <button style={styles.linkBtn} onClick={onClear} type="button">
            clear log
          </button>
        )}
      </div>

      {log.length === 0 ? (
        <p style={styles.empty}>
          No emails processed yet. Simulate one above, or send real
          email to your routed address once deployed.
        </p>
      ) : (
        <ul style={styles.list}>
          {log.map((m, i) => (
            <li key={`${m.at}-${i}`} style={styles.row}>
              <span style={styles.from}>{m.from}</span>
              <span style={styles.subject}>{m.subject}</span>
              <span style={styles.time}>
                {new Date(m.at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 720,
    margin: "32px auto",
    padding: 24,
  },
  title: { fontSize: 24, margin: 0 },
  subtitle: { fontSize: 16, margin: 0 },
  meta: { color: "#555", fontSize: 13, lineHeight: 1.6, marginTop: 8 },
  form: {
    display: "grid",
    gridTemplateColumns: "1.2fr 2fr auto",
    gap: 8,
    alignItems: "end",
    margin: "24px 0 8px",
  },
  field: { display: "flex", flexDirection: "column" as const, gap: 4 },
  label: { fontSize: 11, color: "#666", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  input: {
    padding: "8px 10px",
    fontSize: 14,
    border: "1px solid #d4d4d8",
    borderRadius: 4,
    fontFamily: "inherit",
  },
  primary: {
    padding: "8px 16px",
    fontSize: 14,
    background: "#2563eb",
    color: "#fff",
    border: "1px solid #2563eb",
    borderRadius: 4,
    cursor: "pointer",
    height: 36,
  },
  subheader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 24,
    marginBottom: 8,
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#6b7280",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "underline",
  },
  list: { listStyle: "none", padding: 0, margin: 0 },
  row: {
    display: "grid",
    gridTemplateColumns: "1.5fr 2.5fr auto",
    gap: 12,
    alignItems: "center",
    padding: "10px 4px",
    borderBottom: "1px solid #eee",
    fontSize: 14,
  },
  from: { fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#374151" },
  subject: {},
  time: { color: "#999", fontSize: 12, fontFamily: "ui-monospace, monospace" },
  empty: { color: "#999", fontSize: 14, fontStyle: "italic" as const, lineHeight: 1.5 },
};
