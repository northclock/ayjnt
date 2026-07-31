import { useState } from "react";
import { useAgent } from "@ayjnt/review";

export default function Review() {
  const agent = useAgent();
  const [topic, setTopic] = useState("Ayjnt project update");
  const [source, setSource] = useState("https://github.com/northclock/ayjnt");
  const state = agent.state;
  if (!state) return <main style={styles.main}>Connecting…</main>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await agent.call("prepare", [topic, source]);
  };

  return (
    <main style={styles.main}>
      <header style={styles.header}><div><small style={styles.eyebrow}>DURABLE WORKFLOW</small><h1 style={styles.h1}>Human review queue</h1></div><span>{state.items.filter((item) => item.status === "awaiting-approval").length} awaiting you</span></header>
      <form onSubmit={submit} style={styles.form}>
        <input value={topic} onChange={(event) => setTopic(event.target.value)} style={styles.input} required />
        <input value={source} onChange={(event) => setSource(event.target.value)} style={{ ...styles.input, flex: 1 }} required />
        <button style={styles.primary}>Prepare draft</button>
      </form>
      <section style={styles.queue}>
        {state.items.map((item) => (
          <article key={item.id} style={styles.card}>
            <div style={styles.cardHead}><div><strong>{item.topic}</strong><a href={item.sourceUrl}>{item.sourceUrl}</a></div><Status value={item.status} /></div>
            {item.draft && <pre style={styles.draft}>{item.draft}</pre>}
            {item.checks && <ul style={styles.checks}>{item.checks.map((check) => <li key={check}>✓ {check}</li>)}</ul>}
            {item.status === "awaiting-approval" && (
              <div style={styles.actions}>
                <button onClick={() => agent.call("decide", [item.id, "approved"])} style={styles.approve}>Approve</button>
                <button onClick={() => agent.call("decide", [item.id, "rejected"])} style={styles.reject}>Reject</button>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}

function Status({ value }: { value: string }) {
  return <span style={{ ...styles.status, background: value === "approved" ? "#d9f4e9" : value === "rejected" ? "#fbe0dc" : value === "awaiting-approval" ? "#fff0bf" : "#e5ebf6" }}>{value}</span>;
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: "42px 22px", color: "#172033" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "end", paddingBottom: 22, borderBottom: "1px solid #dfe2e7" },
  eyebrow: { color: "#225dd8", fontFamily: "monospace", letterSpacing: "0.14em" },
  h1: { margin: "6px 0 0", fontSize: 38 },
  form: { display: "flex", gap: 8, padding: "22px 0" },
  input: { padding: 10, border: "1px solid #d2d7de", borderRadius: 8 },
  primary: { border: 0, borderRadius: 8, background: "#225dd8", color: "white", padding: "0 16px" },
  queue: { display: "grid", gap: 14 },
  card: { border: "1px solid #dfe2e7", borderRadius: 12, padding: 18, background: "#fbfbf8" },
  cardHead: { display: "flex", justifyContent: "space-between", gap: 20 },
  status: { padding: "6px 8px", borderRadius: 99, fontFamily: "monospace", fontSize: 9 },
  draft: { whiteSpace: "pre-wrap" as const, lineHeight: 1.6, background: "#f0f1ed", borderRadius: 8, padding: 15, fontFamily: "system-ui", fontSize: 13 },
  checks: { listStyle: "none", padding: 0, color: "#46765f", fontSize: 12 },
  actions: { display: "flex", gap: 8 },
  approve: { border: 0, borderRadius: 7, padding: "9px 14px", background: "#55c99d" },
  reject: { border: "1px solid #e18479", borderRadius: 7, padding: "9px 14px", background: "transparent", color: "#b94b40" },
};
