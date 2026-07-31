import { useState } from "react";
import { useAgent } from "@ayjnt/monitor";

export default function Monitor() {
  const agent = useAgent();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("https://api.github.com/repos/northclock/ayjnt");
  const [kind, setKind] = useState<"once" | "interval" | "cron">("interval");
  const [value, setValue] = useState("60");
  const state = agent.state;
  if (!state) return <main style={styles.main}>Connecting…</main>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cadence = kind === "once"
      ? { kind, delaySeconds: Number(value) }
      : kind === "interval"
        ? { kind, everySeconds: Number(value) }
        : { kind, expression: value };
    await agent.call("create", [label, url, cadence]);
    setLabel("");
  };

  return (
    <main style={styles.main}>
      <header style={styles.header}><div><small style={styles.eyebrow}>SCHEDULER</small><h1 style={styles.h1}>Endpoint monitor</h1></div><span>{state.monitors.length} active</span></header>
      <form onSubmit={submit} style={styles.form}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" style={styles.input} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={{ ...styles.input, flex: 1 }} required />
        <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setValue(e.target.value === "cron" ? "0 * * * *" : "60"); }} style={styles.input}>
          <option value="once">Once after</option><option value="interval">Every</option><option value="cron">Cron</option>
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Cadence value" style={{ ...styles.input, width: 120 }} />
        <button style={styles.primary}>Add</button>
      </form>
      <section style={styles.grid}>
        {state.monitors.map((monitor) => {
          const latest = state.runs.find((run) => run.monitorId === monitor.id);
          return (
            <article key={monitor.id} style={styles.card}>
              <div style={styles.cardTop}><span style={{ ...styles.dot, background: latest?.ok ? "#55c99d" : latest ? "#ef766a" : "#d5d9df" }}></span><strong>{monitor.label}</strong><code style={styles.code}>{monitor.cadence.kind}</code></div>
              <a href={monitor.url} style={styles.url}>{monitor.url}</a>
              {latest ? (
                <div style={styles.result}><b>{latest.status || "ERR"}</b><span>{latest.durationMs}ms</span><p>{latest.preview}</p><time>{new Date(latest.at).toLocaleString()}</time></div>
              ) : <p style={styles.waiting}>Waiting for first run.</p>}
              <div style={styles.actions}><button onClick={() => agent.call("runNow", [monitor.id])}>Run now</button><button onClick={() => agent.call("remove", [monitor.id])}>Remove</button></div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 1080, margin: "0 auto", padding: "42px 22px", color: "#172033" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "end", paddingBottom: 22, borderBottom: "1px solid #dfe2e7" },
  eyebrow: { color: "#225dd8", fontFamily: "monospace", letterSpacing: "0.14em" },
  h1: { margin: "6px 0 0", fontSize: 38 },
  form: { display: "flex", flexWrap: "wrap" as const, gap: 8, padding: "22px 0" },
  input: { padding: "10px 11px", border: "1px solid #d1d6dd", borderRadius: 8, background: "white" },
  primary: { padding: "10px 17px", border: 0, borderRadius: 8, background: "#225dd8", color: "white" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 13 },
  card: { border: "1px solid #dde1e6", borderRadius: 12, padding: 17, background: "#fbfbf8" },
  cardTop: { display: "flex", gap: 9, alignItems: "center" },
  dot: { width: 9, height: 9, borderRadius: "50%" },
  code: { marginLeft: "auto", fontSize: 10, color: "#697180" },
  url: { display: "block", margin: "11px 0", color: "#225dd8", fontSize: 11, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" },
  result: { background: "#f1f2ee", borderRadius: 8, padding: 12, fontSize: 12 },
  waiting: { color: "#818894", fontSize: 12 },
  actions: { display: "flex", gap: 6, marginTop: 12 },
};
