import { createRoot } from "react-dom/client";
import { useAgent } from "@ayjnt/heartbeat";

function Heartbeat() {
  const agent = useAgent();
  const ticks = agent.state?.ticks ?? [];
  const intervalSeconds = agent.state?.intervalSeconds ?? 0;
  const running = intervalSeconds > 0;

  const start = (s: number) =>
    fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ intervalSeconds: s }),
    });

  const stop = () =>
    fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ stop: true }),
    });

  const max = Math.max(100, ...ticks.map((t) => t.load));

  return (
    <main style={styles.main}>
      <header>
        <h1 style={styles.title}>heartbeat</h1>
        <div style={styles.meta}>
          instance: <code>{agent.name}</code> · status:{" "}
          <strong style={{ color: running ? "#2c8045" : "#888" }}>
            {running ? `ticking every ${intervalSeconds}s` : "stopped"}
          </strong>
        </div>
      </header>

      <div style={styles.controls}>
        <button style={styles.btn} onClick={() => start(2)} disabled={running}>
          start 2s
        </button>
        <button style={styles.btn} onClick={() => start(5)} disabled={running}>
          start 5s
        </button>
        <button style={styles.btnStop} onClick={stop} disabled={!running}>
          stop
        </button>
      </div>

      <h2 style={styles.subtitle}>load history ({ticks.length} ticks)</h2>
      <div style={styles.bars}>
        {ticks
          .slice()
          .reverse()
          .map((t) => (
            <div
              key={t.n}
              style={{
                ...styles.bar,
                height: `${(t.load / max) * 100}%`,
              }}
              title={`${new Date(t.at).toLocaleTimeString()} — ${t.load}%`}
            />
          ))}
      </div>

      <ol style={styles.log}>
        {ticks.map((t) => (
          <li key={t.n} style={styles.logItem}>
            <span style={styles.logTime}>
              {new Date(t.at).toLocaleTimeString()}
            </span>
            <span style={styles.logN}>#{t.n}</span>
            <span>load: {t.load}%</span>
          </li>
        ))}
      </ol>
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
  title: { fontSize: 28, margin: 0 },
  subtitle: { fontSize: 14, marginTop: 24, color: "#444" },
  meta: { color: "#666", fontSize: 13, marginTop: 4 },
  controls: { display: "flex", gap: 8, marginTop: 16 },
  btn: {
    padding: "8px 14px",
    border: "1px solid #ccc",
    background: "#f7f7f7",
    cursor: "pointer",
    fontSize: 13,
  },
  btnStop: {
    padding: "8px 14px",
    border: "1px solid #c44",
    background: "#fff5f5",
    color: "#c44",
    cursor: "pointer",
    fontSize: 13,
  },
  bars: {
    display: "flex",
    alignItems: "flex-end",
    gap: 2,
    height: 120,
    marginTop: 8,
    background: "#fafafa",
    border: "1px solid #eee",
    padding: 6,
  },
  bar: {
    flex: 1,
    background: "#3b82f6",
    minHeight: 2,
    transition: "height 0.3s",
  },
  log: {
    listStyle: "none",
    padding: 0,
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    maxHeight: 280,
    overflow: "auto",
    border: "1px solid #eee",
  },
  logItem: {
    display: "flex",
    gap: 12,
    padding: "4px 8px",
    borderBottom: "1px solid #f3f3f3",
  },
  logTime: { color: "#888", minWidth: 80 },
  logN: { color: "#3b82f6", minWidth: 36 },
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<Heartbeat />);
