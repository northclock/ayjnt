import { useAgent } from "@ayjnt/carbon";

/** Visual band per UK NG intensity classification — kept light/dark so the
 *  current-card and bar chart speak the same colour language. */
const BAND_COLORS: Record<string, { bg: string; ink: string }> = {
  "very low": { bg: "#dcfce7", ink: "#14532d" },
  low: { bg: "#bbf7d0", ink: "#166534" },
  moderate: { bg: "#fef9c3", ink: "#713f12" },
  high: { bg: "#fed7aa", ink: "#7c2d12" },
  "very high": { bg: "#fecaca", ink: "#7f1d1d" },
};

const FALLBACK_COLOR = { bg: "#e5e7eb", ink: "#374151" };

function colorFor(index: string | undefined): { bg: string; ink: string } {
  return BAND_COLORS[index ?? ""] ?? FALLBACK_COLOR;
}

export default function CarbonApp() {
  const agent = useAgent();
  const state = agent.state;
  const intervalSeconds = state?.intervalSeconds ?? 0;
  const running = intervalSeconds > 0;
  const current = state?.current ?? null;
  const history = state?.history ?? [];
  const error = state?.error ?? null;

  const start = (intervalSeconds: number) =>
    fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ intervalSeconds }),
    });

  const stop = () =>
    fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ stop: true }),
    });

  const clear = () =>
    fetch(window.location.pathname, { method: "DELETE" });

  // Bar chart scaling. Fall back to 350 (a typical max grid intensity) so
  // the chart doesn't go full-height on the first sample.
  const max = Math.max(350, ...history.map((h) => h.forecast));
  const currentColor = colorFor(current?.index);

  return (
    <main style={styles.main}>
      <header>
        <h1 style={styles.title}>UK Grid Carbon Intensity</h1>
        <p style={styles.meta}>
          instance: <code>{agent.name}</code> ·{" "}
          <span style={{ color: running ? "#15803d" : "#888" }}>
            {running ? `polling every ${intervalSeconds}s` : "stopped"}
          </span>
          {error ? (
            <>
              {" · "}
              <span style={styles.errorInline}>last fetch: {error}</span>
            </>
          ) : null}
        </p>
      </header>

      <section
        style={{
          ...styles.currentCard,
          background: currentColor.bg,
          color: currentColor.ink,
        }}
      >
        {current ? (
          <>
            <div style={styles.currentValue}>
              {current.actual ?? current.forecast}{" "}
              <span style={styles.currentUnit}>gCO₂/kWh</span>
            </div>
            <div style={styles.currentMeta}>
              <strong style={{ textTransform: "uppercase" }}>
                {current.index}
              </strong>{" "}
              · forecast {current.forecast}
              {current.actual !== null ? ` · actual ${current.actual}` : ""}
              <br />
              <small>
                window {fmtTime(current.from)} — {fmtTime(current.to)} ·
                fetched {fmtRelative(current.fetchedAt)}
              </small>
            </div>
          </>
        ) : (
          <div style={styles.currentMeta}>
            no data yet — start polling to fetch the latest grid sample
          </div>
        )}
      </section>

      <div style={styles.controls}>
        <button
          style={styles.btn}
          onClick={() => start(60)}
          disabled={running}
        >
          start (60s)
        </button>
        <button
          style={styles.btn}
          onClick={() => start(15)}
          disabled={running}
        >
          start (15s, demo)
        </button>
        <button
          style={styles.btnStop}
          onClick={stop}
          disabled={!running}
        >
          stop
        </button>
        <button style={styles.btnGhost} onClick={clear}>
          clear history
        </button>
      </div>

      <h2 style={styles.subtitle}>
        forecast history ({history.length}{" "}
        {history.length === 1 ? "sample" : "samples"})
      </h2>
      <div style={styles.bars}>
        {history
          .slice()
          .reverse()
          .map((s) => {
            const c = colorFor(s.index);
            return (
              <div
                key={s.fetchedAt}
                style={{
                  ...styles.bar,
                  height: `${(s.forecast / max) * 100}%`,
                  background: c.bg,
                  borderTop: `2px solid ${c.ink}`,
                }}
                title={`${new Date(s.fetchedAt).toLocaleTimeString()} — forecast ${s.forecast} (${s.index})`}
              />
            );
          })}
      </div>

      <ol style={styles.log}>
        {history.map((s) => {
          const c = colorFor(s.index);
          return (
            <li key={s.fetchedAt} style={styles.logItem}>
              <span style={styles.logTime}>
                {new Date(s.fetchedAt).toLocaleTimeString()}
              </span>
              <span style={{ ...styles.logBand, background: c.bg, color: c.ink }}>
                {s.index}
              </span>
              <span style={styles.logValue}>
                forecast {s.forecast}
                {s.actual !== null ? ` · actual ${s.actual}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtRelative(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 760,
    margin: "32px auto",
    padding: 24,
  },
  title: { fontSize: 26, margin: 0 },
  meta: { color: "#555", fontSize: 13, marginTop: 4 },
  errorInline: { color: "#b91c1c" },
  subtitle: { fontSize: 14, marginTop: 24, color: "#444" },
  currentCard: {
    marginTop: 16,
    padding: 20,
    borderRadius: 8,
    transition: "background 0.4s",
  },
  currentValue: { fontSize: 44, fontWeight: 700, lineHeight: 1 },
  currentUnit: { fontSize: 16, fontWeight: 400, opacity: 0.7 },
  currentMeta: { marginTop: 8, fontSize: 13 },
  controls: { display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" as const },
  btn: {
    padding: "8px 14px",
    border: "1px solid #ccc",
    background: "#f7f7f7",
    cursor: "pointer",
    fontSize: 13,
    borderRadius: 4,
  },
  btnStop: {
    padding: "8px 14px",
    border: "1px solid #c44",
    background: "#fff5f5",
    color: "#c44",
    cursor: "pointer",
    fontSize: 13,
    borderRadius: 4,
  },
  btnGhost: {
    padding: "8px 14px",
    border: "1px dashed #ccc",
    background: "transparent",
    cursor: "pointer",
    fontSize: 13,
    borderRadius: 4,
    color: "#666",
  },
  bars: {
    display: "flex",
    alignItems: "flex-end",
    gap: 2,
    height: 140,
    marginTop: 8,
    background: "#fafafa",
    border: "1px solid #eee",
    padding: 6,
    borderRadius: 4,
  },
  bar: {
    flex: 1,
    minHeight: 2,
    transition: "height 0.4s",
  },
  log: {
    listStyle: "none",
    padding: 0,
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    maxHeight: 280,
    overflow: "auto",
    border: "1px solid #eee",
    borderRadius: 4,
    marginTop: 8,
  },
  logItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "6px 10px",
    borderBottom: "1px solid #f3f3f3",
  },
  logTime: { color: "#888", minWidth: 80 },
  logBand: {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 3,
    minWidth: 70,
    textAlign: "center" as const,
  },
  logValue: { color: "#333" },
};
