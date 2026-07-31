import { useAgent } from "@ayjnt/ayjnt-code";

export default function Session() {
  const agent = useAgent();
  const state = agent.state;
  if (!state) return <main style={styles.main}>Connecting…</main>;

  return (
    <main style={styles.main}>
      <a href="/" style={styles.back}>← all sessions</a>
      <header style={styles.header}>
        <div><h1 style={styles.h1}>{state.title}</h1><code>{agent.name}</code></div>
        <div style={styles.usage}>{state.inputTokens + state.outputTokens} tokens · {state.turns.length} turns</div>
      </header>
      <section style={styles.thread}>
        {state.turns.map((turn) => (
          <article key={turn.id} style={{ ...styles.turn, ...(turn.role === "user" ? styles.user : {}) }}>
            <span style={styles.role}>{turn.role}</span>
            <p style={styles.copy}>{turn.text}</p>
            <time style={styles.time}>{new Date(turn.at).toLocaleTimeString()}</time>
          </article>
        ))}
        {state.running && <p style={styles.running}>Agent is working…</p>}
      </section>
    </main>
  );
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 820, margin: "0 auto", padding: "44px 24px", color: "#172033" },
  back: { color: "#225dd8", textDecoration: "none", fontSize: 13 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "end", padding: "32px 0 22px", borderBottom: "1px solid #dfe2e7" },
  h1: { margin: "0 0 8px", fontSize: 32, letterSpacing: "-0.04em" },
  usage: { color: "#697180", fontSize: 12 },
  thread: { display: "grid", gap: 18, padding: "28px 0" },
  turn: { maxWidth: "82%", padding: 18, border: "1px solid #dfe2e7", borderRadius: 12 },
  user: { marginLeft: "auto", background: "#e8eefb", borderColor: "#d8e1f4" },
  role: { color: "#225dd8", fontFamily: "monospace", fontSize: 10, textTransform: "uppercase" as const },
  copy: { whiteSpace: "pre-wrap" as const, lineHeight: 1.6, margin: "8px 0" },
  time: { color: "#8a919d", fontSize: 10 },
  running: { color: "#697180", fontFamily: "monospace" },
};
