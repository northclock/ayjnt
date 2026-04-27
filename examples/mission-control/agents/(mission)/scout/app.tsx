import { useAgent } from "@ayjnt/scout";

export default function Scout() {
  const agent = useAgent();
  const state = agent.state;

  const scan = () =>
    fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ action: "scan" }),
    });
  const clear = () =>
    fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ action: "clear" }),
    });

  if (!state) return <main style={styles.main}>connecting…</main>;

  const threatPct = Math.round(state.threatLevel * 100);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>crew station</div>
          <h1 style={styles.title}>scout — {agent.name}</h1>
        </div>
        <a href={`/commander/${agent.name}`} style={styles.back}>
          ← commander
        </a>
      </header>

      <div style={styles.panel}>
        <div style={styles.threatBox}>
          <div style={styles.eyebrow}>threat level</div>
          <div
            style={{
              ...styles.threatVal,
              color:
                threatPct > 70 ? "#dc2626" : threatPct > 40 ? "#d97706" : "#22c55e",
            }}
          >
            {threatPct}%
          </div>
          <div style={styles.bar}>
            <div
              style={{
                ...styles.barFill,
                width: `${threatPct}%`,
                background:
                  threatPct > 70 ? "#dc2626" : threatPct > 40 ? "#d97706" : "#22c55e",
              }}
            />
          </div>
          <div style={styles.controls}>
            <button
              style={styles.btnGo}
              onClick={scan}
              disabled={state.scanning}
            >
              {state.scanning ? "scanning…" : "scan now"}
            </button>
            <button style={styles.btnGhost} onClick={clear}>
              clear log
            </button>
          </div>
        </div>

        <div style={styles.contacts}>
          <div style={styles.eyebrow}>contacts ({state.contacts.length})</div>
          <ul style={styles.list}>
            {state.contacts.length === 0 && (
              <li style={styles.empty}>no contacts</li>
            )}
            {state.contacts.map((c) => (
              <li key={c.id} style={styles.contact}>
                <span
                  style={{
                    ...styles.pill,
                    ...kindStyle(c.kind),
                  }}
                >
                  {c.kind}
                </span>
                <span style={styles.distance}>
                  {c.distance.toFixed(1)} units @ {((c.bearing * 180) / Math.PI).toFixed(0)}°
                </span>
                <span
                  style={{
                    ...styles.sev,
                    color:
                      c.severity > 0.7 ? "#dc2626" : c.severity > 0.4 ? "#d97706" : "#9ca3af",
                  }}
                >
                  sev {(c.severity * 100).toFixed(0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

function kindStyle(k: string) {
  switch (k) {
    case "hostile":
      return { background: "#450a0a", color: "#fca5a5" };
    case "asteroid":
      return { background: "#1e293b", color: "#94a3b8" };
    case "debris":
      return { background: "#1e1b4b", color: "#a5b4fc" };
    case "signal":
      return { background: "#064e3b", color: "#6ee7b7" };
    default:
      return {};
  }
}

const styles = {
  main: {
    fontFamily: "ui-monospace, monospace",
    background: "#0a0f1e",
    color: "#e5e7eb",
    minHeight: "100vh",
    padding: 20,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "end",
    marginBottom: 16,
    maxWidth: 640,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: "0.3em",
    textTransform: "uppercase" as const,
    color: "#64748b",
  },
  title: { margin: 0, fontSize: 18, color: "#22c55e" },
  back: { color: "#60a5fa", textDecoration: "none", fontSize: 12 },
  panel: {
    display: "grid",
    gridTemplateColumns: "240px 1fr",
    gap: 16,
    maxWidth: 640,
  },
  threatBox: {
    background: "#111827",
    border: "1px solid #1f2937",
    padding: 16,
    borderRadius: 4,
  },
  threatVal: { fontSize: 48, fontWeight: 700, margin: "8px 0" },
  bar: {
    height: 6,
    background: "#1f2937",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: { height: "100%", transition: "width 0.3s" },
  controls: { display: "flex", gap: 6, marginTop: 16 },
  btnGo: {
    padding: "6px 12px",
    background: "#059669",
    color: "white",
    border: "none",
    borderRadius: 3,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  btnGhost: {
    padding: "6px 12px",
    background: "transparent",
    color: "#9ca3af",
    border: "1px solid #374151",
    borderRadius: 3,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
  },
  contacts: {
    background: "#111827",
    border: "1px solid #1f2937",
    padding: 12,
    borderRadius: 4,
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: "8px 0 0",
    maxHeight: 260,
    overflowY: "auto" as const,
  },
  contact: {
    display: "grid",
    gridTemplateColumns: "70px 1fr auto",
    gap: 8,
    padding: "4px 0",
    borderBottom: "1px solid #1f2937",
    alignItems: "center",
    fontSize: 12,
  },
  pill: {
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    textAlign: "center" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
  },
  distance: { color: "#94a3b8" },
  sev: { fontSize: 11 },
  empty: { color: "#64748b", padding: 16, textAlign: "center" as const },
};
