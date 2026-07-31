import { useAgent } from "@ayjnt/sessions";

export default function Sessions() {
  const registry = useAgent({ name: "default" });
  const sessions = registry.state?.sessions ?? [];
  const tokens = sessions.reduce(
    (sum, session) => sum + session.inputTokens + session.outputTokens,
    0,
  );

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div><small style={styles.eyebrow}>AYJNT CODE</small><h1 style={styles.h1}>Coding sessions</h1></div>
        <div style={styles.usage}><strong>{tokens.toLocaleString()}</strong><span>total tokens</span></div>
      </header>
      <div style={styles.list}>
        {sessions.length === 0 ? (
          <p style={styles.empty}>Start a session with <code>bun run start</code>.</p>
        ) : sessions.map((session) => (
          <a key={session.id} href={`/ayjnt-code/${session.id}`} style={styles.row}>
            <span style={styles.dot}></span>
            <span style={styles.title}><strong>{session.title}</strong><small>{session.id}</small></span>
            <span style={styles.stat}>{session.turns} turns</span>
            <span style={styles.stat}>{(session.inputTokens + session.outputTokens).toLocaleString()} tokens</span>
            <span>→</span>
          </a>
        ))}
      </div>
    </main>
  );
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 980, margin: "0 auto", padding: "56px 24px", color: "#172033" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "end", borderBottom: "1px solid #d9dce1", paddingBottom: 24 },
  eyebrow: { fontFamily: "monospace", color: "#225dd8", letterSpacing: "0.14em" },
  h1: { fontSize: 42, letterSpacing: "-0.04em", margin: "8px 0 0" },
  usage: { display: "flex", flexDirection: "column" as const, textAlign: "right" as const },
  list: { display: "grid", marginTop: 18 },
  row: { display: "grid", gridTemplateColumns: "12px 1fr 90px 110px 20px", gap: 16, alignItems: "center", padding: "18px 10px", borderBottom: "1px solid #e3e5e8", color: "inherit", textDecoration: "none" },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#7be0bd" },
  title: { display: "flex", flexDirection: "column" as const, gap: 4 },
  stat: { fontSize: 12, color: "#697180" },
  empty: { padding: 50, textAlign: "center" as const, color: "#697180" },
};
