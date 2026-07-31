import { useState } from "react";
import { useAgent } from "@ayjnt/lead";

export default function Lead() {
  const agent = useAgent();
  const [question, setQuestion] = useState("What does this project make easier?");
  const [sources, setSources] = useState("https://github.com/northclock/ayjnt");
  const state = agent.state;
  if (!state) return <main style={styles.main}>Connecting…</main>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const urls = sources.split("\n").map((item) => item.trim()).filter(Boolean);
    await agent.call("start", [question, urls]);
  };

  return (
    <main style={styles.main}>
      <header style={styles.header}><div><small style={styles.eyebrow}>MULTI-AGENT</small><h1 style={styles.h1}>Research team</h1></div><span>lead → researcher → reviewer</span></header>
      <form onSubmit={submit} style={styles.form}>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} style={styles.input} required />
        <textarea value={sources} onChange={(event) => setSources(event.target.value)} style={styles.textarea} />
        <button style={styles.primary}>Run research</button>
      </form>
      <section style={styles.runs}>
        {state.runs.map((run) => (
          <article key={run.id} style={styles.card}>
            <div style={styles.cardHead}><h2>{run.question}</h2><span style={styles.stage}>{run.stage}</span></div>
            <div style={styles.pipeline}>
              {["lead", "researcher", "reviewer"].map((name, index) => (
                <div key={name} style={styles.agent}><b>{String(index + 1).padStart(2, "0")}</b><strong>{name}</strong><span>{run.log.filter((item) => item.agent === name).length} events</span></div>
              ))}
            </div>
            <ol style={styles.log}>{run.log.map((entry, index) => <li key={index}><code>{entry.agent}</code>{entry.message}</li>)}</ol>
            {run.brief && <pre style={styles.brief}>{run.brief}</pre>}
            {run.error && <p style={styles.error}>{run.error}</p>}
          </article>
        ))}
      </section>
    </main>
  );
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 980, margin: "0 auto", padding: "42px 22px", color: "#172033" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "end", paddingBottom: 22, borderBottom: "1px solid #dfe2e7" },
  eyebrow: { color: "#225dd8", fontFamily: "monospace", letterSpacing: "0.14em" },
  h1: { margin: "6px 0 0", fontSize: 38 },
  form: { display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, padding: "22px 0" },
  input: { padding: 11, border: "1px solid #d2d7de", borderRadius: 8 },
  textarea: { padding: 11, border: "1px solid #d2d7de", borderRadius: 8, minHeight: 45 },
  primary: { border: 0, borderRadius: 8, background: "#225dd8", color: "white", padding: "0 16px" },
  runs: { display: "grid", gap: 14 },
  card: { border: "1px solid #dfe2e7", borderRadius: 12, padding: 18, background: "#fbfbf8" },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  stage: { background: "#e5ebf6", borderRadius: 99, padding: "6px 8px", fontFamily: "monospace", fontSize: 9 },
  pipeline: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, margin: "17px 0" },
  agent: { display: "grid", gap: 4, padding: 12, background: "#eef1f6", borderRadius: 8 },
  log: { padding: 0, listStyle: "none", fontSize: 12, color: "#5e6775" },
  brief: { whiteSpace: "pre-wrap" as const, lineHeight: 1.6, background: "#172033", color: "#e8ebf1", padding: 17, borderRadius: 8, fontSize: 12 },
  error: { color: "#b94b40" },
};
