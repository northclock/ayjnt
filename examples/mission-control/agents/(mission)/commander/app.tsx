import { useAgent } from "@ayjnt/commander";

export default function Commander() {
  const agent = useAgent();
  const state = agent.state;
  const missionId = agent.name;

  const startStop = async () => {
    await fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({
        action: state?.running ? "stop" : "start",
      }),
    });
  };

  const reset = () =>
    fetch(window.location.pathname, { method: "DELETE" });

  if (!state) return <main style={styles.main}>connecting…</main>;

  const nav = state.crew.navigator;
  const scout = state.crew.scout;
  const eng = state.crew.engineer;

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>mission control</div>
          <h1 style={styles.title}>{missionId}</h1>
          <div style={styles.meta}>
            {state.objective} · cycle {state.cycle} ·{" "}
            <span style={styles.phase}>{state.phase.toUpperCase()}</span>
          </div>
        </div>
        <div style={styles.controls}>
          <button
            style={state.running ? styles.btnStop : styles.btnGo}
            onClick={startStop}
          >
            {state.running ? "pause" : "engage"}
          </button>
          <button style={styles.btnGhost} onClick={reset} disabled={state.running}>
            reset
          </button>
        </div>
      </header>

      <div style={styles.grid}>
        <a href={`/navigator/${missionId}`} style={styles.card}>
          <div style={styles.cardHead}>navigator ↗</div>
          <div style={styles.statLarge}>
            {nav ? `${round(nav.fuel)}%` : "—"}
          </div>
          <div style={styles.statLabel}>fuel</div>
          <div style={styles.sub}>
            {nav
              ? nav.arrived
                ? `arrived @ ${fmt(nav.position)}`
                : `en route → ${nav.target ? fmt(nav.target) : "—"}`
              : "—"}
          </div>
        </a>
        <a href={`/scout/${missionId}`} style={styles.card}>
          <div style={styles.cardHead}>scout ↗</div>
          <div
            style={{
              ...styles.statLarge,
              color: scout && scout.threatLevel > 0.6 ? "#dc2626" : undefined,
            }}
          >
            {scout ? `${Math.round(scout.threatLevel * 100)}%` : "—"}
          </div>
          <div style={styles.statLabel}>threat</div>
          <div style={styles.sub}>
            {scout ? `${scout.contacts.length} contact(s)` : "—"}
          </div>
        </a>
        <a href={`/engineer/${missionId}`} style={styles.card}>
          <div style={styles.cardHead}>engineer ↗</div>
          <div
            style={{
              ...styles.statLarge,
              color:
                eng && eng.aggregate < 50 ? "#dc2626" : eng && eng.aggregate < 80 ? "#d97706" : undefined,
            }}
          >
            {eng ? `${eng.aggregate}%` : "—"}
          </div>
          <div style={styles.statLabel}>health</div>
          <div style={styles.sub}>
            {eng ? `${eng.repairs} repair(s)` : "—"}
          </div>
        </a>
      </div>

      <section style={styles.logSection}>
        <h2 style={styles.subtitle}>mission log</h2>
        <ol style={styles.log}>
          {state.log
            .slice()
            .reverse()
            .map((e, i) => (
              <li
                key={i}
                style={{
                  ...styles.logItem,
                  color: levelColor(e.level),
                }}
              >
                <span style={styles.time}>
                  {new Date(e.at).toLocaleTimeString()}
                </span>
                {e.text}
              </li>
            ))}
        </ol>
      </section>
    </main>
  );
}

function fmt(v: { x: number; y: number; z: number }): string {
  return `${round(v.x)}, ${round(v.y)}, ${round(v.z)}`;
}
function round(n: number): number {
  return Math.round(n * 10) / 10;
}
function levelColor(level: "info" | "warn" | "ok"): string {
  if (level === "warn") return "#d97706";
  if (level === "ok") return "#059669";
  return "#4b5563";
}

const styles = {
  main: {
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    maxWidth: 960,
    margin: "24px auto",
    padding: 16,
    color: "#111",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    borderBottom: "1px solid #e5e7eb",
    paddingBottom: 16,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: "0.3em",
    textTransform: "uppercase" as const,
    color: "#9ca3af",
  },
  title: { fontSize: 28, margin: "4px 0" },
  meta: { fontSize: 12, color: "#6b7280" },
  phase: { color: "#1d4ed8", fontWeight: 600, letterSpacing: "0.1em" },
  controls: { display: "flex", gap: 8, alignItems: "center" },
  btnGo: {
    padding: "8px 14px",
    background: "#059669",
    color: "white",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  btnStop: {
    padding: "8px 14px",
    background: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  btnGhost: {
    padding: "8px 14px",
    background: "transparent",
    color: "#6b7280",
    border: "1px solid #d1d5db",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 12,
    marginTop: 16,
  },
  card: {
    display: "block",
    padding: 16,
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    textDecoration: "none",
    color: "inherit",
    transition: "background 0.15s",
  },
  cardHead: {
    fontSize: 11,
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    color: "#6b7280",
  },
  statLarge: { fontSize: 40, fontWeight: 700, margin: "4px 0" },
  statLabel: {
    fontSize: 10,
    letterSpacing: "0.15em",
    textTransform: "uppercase" as const,
    color: "#9ca3af",
  },
  sub: { fontSize: 12, color: "#4b5563", marginTop: 8 },
  logSection: { marginTop: 24 },
  subtitle: {
    fontSize: 11,
    letterSpacing: "0.25em",
    textTransform: "uppercase" as const,
    color: "#6b7280",
    margin: 0,
  },
  log: {
    listStyle: "none",
    padding: 0,
    margin: "8px 0 0",
    fontSize: 12,
    maxHeight: 260,
    overflowY: "auto" as const,
    background: "#fafafa",
    border: "1px solid #e5e7eb",
    borderRadius: 4,
  },
  logItem: {
    padding: "4px 10px",
    borderBottom: "1px solid #f3f4f6",
    display: "flex",
    gap: 12,
  },
  time: { color: "#9ca3af", minWidth: 80 },
};
