import { useEffect, useRef } from "react";
import { useAgent } from "@ayjnt/navigator";

const W = 480;
const H = 320;
const SCALE = 3; // sector units → pixels

export default function Navigator() {
  const agent = useAgent();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const state = agent.state;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !state) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0a0f1e";
    ctx.fillRect(0, 0, W, H);

    // Grid.
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Origin / base.
    const base = world(0, 0);
    ctx.fillStyle = "#60a5fa";
    ctx.beginPath();
    ctx.arc(base.x, base.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.fillText("BASE", base.x + 6, base.y + 3);

    // Target.
    if (state.target) {
      const t = world(state.target.x, state.target.y);
      ctx.strokeStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(t.x, t.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fbbf24";
      ctx.fillText("TARGET", t.x + 10, t.y + 3);
    }

    // Trail.
    ctx.strokeStyle = "#334155";
    ctx.beginPath();
    state.trail.forEach((p, i) => {
      const w = world(p.x, p.y);
      if (i === 0) ctx.moveTo(w.x, w.y);
      else ctx.lineTo(w.x, w.y);
    });
    ctx.stroke();

    // Current position.
    const pos = world(state.position.x, state.position.y);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(Math.atan2(state.heading.y, state.heading.x));
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }, [state]);

  if (!state) return <main style={styles.main}>connecting…</main>;

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>crew station</div>
          <h1 style={styles.title}>navigator — {agent.name}</h1>
        </div>
        <a href={`/commander/${agent.name}`} style={styles.back}>
          ← commander
        </a>
      </header>

      <canvas ref={canvas} width={W} height={H} style={styles.canvas} />

      <div style={styles.readouts}>
        <Readout label="POS" value={fmt(state.position)} />
        <Readout
          label="TGT"
          value={state.target ? fmt(state.target) : "—"}
        />
        <Readout label="FUEL" value={`${state.fuel.toFixed(1)}%`} />
        <Readout label="SPEED" value={state.speed.toFixed(2)} />
        <Readout label="STATUS" value={state.arrived ? "ARRIVED" : "EN-ROUTE"} />
      </div>
    </main>
  );

  function world(x: number, y: number) {
    return { x: W / 2 + x * SCALE, y: H / 2 - y * SCALE };
  }
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.readout}>
      <div style={styles.readoutLabel}>{label}</div>
      <div style={styles.readoutValue}>{value}</div>
    </div>
  );
}

function fmt(v: { x: number; y: number; z: number }): string {
  return `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
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
    maxWidth: W,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: "0.3em",
    textTransform: "uppercase" as const,
    color: "#64748b",
  },
  title: { margin: 0, fontSize: 18, color: "#22c55e" },
  back: { color: "#60a5fa", textDecoration: "none", fontSize: 12 },
  canvas: { border: "1px solid #1f2937" },
  readouts: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 8,
    maxWidth: W,
    marginTop: 12,
  },
  readout: {
    background: "#111827",
    border: "1px solid #1f2937",
    padding: 8,
    borderRadius: 4,
  },
  readoutLabel: {
    fontSize: 9,
    letterSpacing: "0.2em",
    color: "#64748b",
  },
  readoutValue: { fontSize: 14, color: "#22c55e", marginTop: 4 },
};
