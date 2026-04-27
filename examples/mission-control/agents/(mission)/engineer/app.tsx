import { useAgent } from "@ayjnt/engineer";

const SYSTEMS = ["power", "lifeSupport", "comms", "hull", "drill"] as const;

export default function Engineer() {
  const agent = useAgent();
  const state = agent.state;

  const repair = (system: string) =>
    fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ action: "repair", system }),
    });

  if (!state) return <main style={styles.main}>connecting…</main>;

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>crew station</div>
          <h1 style={styles.title}>engineer — {agent.name}</h1>
        </div>
        <a href={`/commander/${agent.name}`} style={styles.back}>
          ← commander
        </a>
      </header>

      <div style={styles.summary}>
        <div>
          <div style={styles.eyebrow}>aggregate health</div>
          <div
            style={{
              ...styles.stat,
              color:
                state.aggregate < 50 ? "#dc2626" : state.aggregate < 80 ? "#d97706" : "#22c55e",
            }}
          >
            {state.aggregate}%
          </div>
        </div>
        <div>
          <div style={styles.eyebrow}>repairs this mission</div>
          <div style={styles.stat}>{state.repairs}</div>
        </div>
      </div>

      <div style={styles.grid}>
        {SYSTEMS.map((s) => {
          const h = state.systems[s];
          const busy = state.repairing === s;
          return (
            <div key={s} style={styles.system}>
              <div style={styles.sysName}>{labelOf(s)}</div>
              <div
                style={{
                  ...styles.sysStat,
                  color:
                    h < 30 ? "#dc2626" : h < 60 ? "#d97706" : "#22c55e",
                }}
              >
                {h.toFixed(0)}%
              </div>
              <div style={styles.bar}>
                <div
                  style={{
                    ...styles.barFill,
                    width: `${h}%`,
                    background:
                      h < 30 ? "#dc2626" : h < 60 ? "#d97706" : "#22c55e",
                  }}
                />
              </div>
              <button
                style={busy ? styles.btnBusy : styles.btnRepair}
                onClick={() => repair(s)}
                disabled={!!state.repairing || h === 100}
              >
                {busy
                  ? "repairing…"
                  : h === 100
                    ? "nominal"
                    : "repair"}
              </button>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function labelOf(name: string) {
  return name === "lifeSupport" ? "life support" : name;
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
    maxWidth: 720,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: "0.3em",
    textTransform: "uppercase" as const,
    color: "#64748b",
  },
  title: { margin: 0, fontSize: 18, color: "#22c55e" },
  back: { color: "#60a5fa", textDecoration: "none", fontSize: 12 },
  summary: {
    display: "flex",
    gap: 48,
    padding: 16,
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 4,
    maxWidth: 720,
  },
  stat: { fontSize: 32, fontWeight: 700, marginTop: 4 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: 8,
    marginTop: 16,
    maxWidth: 720,
  },
  system: {
    padding: 12,
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 4,
  },
  sysName: {
    fontSize: 10,
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    color: "#64748b",
  },
  sysStat: { fontSize: 24, fontWeight: 700, margin: "4px 0" },
  bar: {
    height: 4,
    background: "#1f2937",
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: { height: "100%", transition: "width 0.3s" },
  btnRepair: {
    marginTop: 10,
    width: "100%",
    padding: "6px 0",
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
  btnBusy: {
    marginTop: 10,
    width: "100%",
    padding: "6px 0",
    background: "#374151",
    color: "#9ca3af",
    border: "none",
    borderRadius: 3,
    cursor: "default",
    fontFamily: "inherit",
    fontSize: 11,
  },
};
