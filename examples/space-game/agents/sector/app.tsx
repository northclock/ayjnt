import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { useAgent } from "@ayjnt/sector";

const WORLD = { w: 800, h: 600 };

function pickName(): string {
  const stored = localStorage.getItem("ayjnt-pilot-name");
  if (stored) return stored;
  const name = prompt("Pilot callsign?") ?? "guest";
  const trimmed = name.trim().slice(0, 24) || "guest";
  localStorage.setItem("ayjnt-pilot-name", trimmed);
  return trimmed;
}

function Game() {
  const [name] = useState(pickName);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const agent = useAgent();

  // Track current input flags; we only send when they change to keep the
  // wire quiet. Refs because keyboard handlers shouldn't rerender.
  const inputRef = useRef({ thrust: false, left: false, right: false });
  const lastSentRef = useRef("");

  // Identify on connect.
  useEffect(() => {
    agent.send(JSON.stringify({ kind: "hello", name }));
  }, [agent, name]);

  // Keyboard input.
  useEffect(() => {
    const setKey = (key: string, on: boolean) => {
      const i = inputRef.current;
      let changed = false;
      if (key === "ArrowUp" || key === "w") {
        if (i.thrust !== on) {
          i.thrust = on;
          changed = true;
        }
      } else if (key === "ArrowLeft" || key === "a") {
        if (i.left !== on) {
          i.left = on;
          changed = true;
        }
      } else if (key === "ArrowRight" || key === "d") {
        if (i.right !== on) {
          i.right = on;
          changed = true;
        }
      } else if (key === " " && on) {
        agent.send(JSON.stringify({ kind: "fire" }));
        return;
      }
      if (changed) {
        const payload = JSON.stringify({ kind: "input", ...i });
        if (payload !== lastSentRef.current) {
          agent.send(payload);
          lastSentRef.current = payload;
        }
      }
    };

    const down = (e: KeyboardEvent) => setKey(e.key, true);
    const up = (e: KeyboardEvent) => setKey(e.key, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [agent]);

  // Render loop. We don't requestAnimationFrame the canvas here — we just
  // re-render each time agent state arrives, which is 30Hz. For a smoother
  // look you'd predict locally between server frames.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const state = agent.state;
    if (!state) return;

    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    // Asteroids.
    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 1.5;
    for (const a of state.asteroids) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Bullets.
    ctx.fillStyle = "#fbbf24";
    for (const b of state.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ships.
    for (const s of state.ships) {
      const isMe = s.name === name;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.a);
      ctx.strokeStyle = isMe ? "#22c55e" : "#60a5fa";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, -6);
      ctx.lineTo(-5, 0);
      ctx.lineTo(-8, 6);
      ctx.closePath();
      ctx.stroke();
      if (s.thrust) {
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(-12 - Math.random() * 6, 0);
        ctx.strokeStyle = "#fb923c";
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = isMe ? "#22c55e" : "#9ca3af";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(s.name, s.x, s.y - 16);
    }
  });

  const ships = agent.state?.ships ?? [];

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>SECTOR {agent.name.toUpperCase()}</h1>
        <span style={styles.tag}>{ships.length} pilots</span>
      </header>

      <canvas
        ref={canvasRef}
        width={WORLD.w}
        height={WORLD.h}
        style={styles.canvas}
        tabIndex={0}
      />

      <div style={styles.hud}>
        <div style={styles.controls}>
          <kbd style={styles.kbd}>W / ↑</kbd> thrust ·{" "}
          <kbd style={styles.kbd}>A D</kbd> turn ·{" "}
          <kbd style={styles.kbd}>SPACE</kbd> fire
        </div>
        <table style={styles.scores}>
          <thead>
            <tr>
              <th style={styles.scoreHead}>pilot</th>
              <th style={styles.scoreHead}>kills</th>
              <th style={styles.scoreHead}>deaths</th>
            </tr>
          </thead>
          <tbody>
            {ships
              .slice()
              .sort((a, b) => b.kills - a.kills)
              .map((s) => (
                <tr
                  key={s.id}
                  style={s.name === name ? styles.scoreSelf : undefined}
                >
                  <td>{s.name}</td>
                  <td>{s.kills}</td>
                  <td>{s.deaths}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const styles = {
  main: {
    fontFamily:
      "ui-monospace, SFMono-Regular, 'SF Mono', Consolas, monospace",
    background: "#000",
    color: "#fff",
    minHeight: "100vh",
    padding: 16,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    maxWidth: WORLD.w,
    margin: "0 auto 12px",
  },
  title: { margin: 0, fontSize: 16, letterSpacing: "0.2em" },
  tag: {
    color: "#9ca3af",
    fontSize: 12,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  canvas: {
    display: "block",
    margin: "0 auto",
    border: "1px solid #333",
    background: "#0a0a14",
  },
  hud: {
    maxWidth: WORLD.w,
    margin: "12px auto",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    fontSize: 12,
  },
  controls: { color: "#9ca3af" },
  kbd: {
    background: "#222",
    border: "1px solid #444",
    borderRadius: 3,
    padding: "1px 6px",
    margin: "0 2px",
    color: "#fff",
  },
  scores: {
    borderCollapse: "collapse" as const,
    width: "100%",
    fontSize: 11,
  },
  scoreHead: {
    textAlign: "left" as const,
    color: "#666",
    fontWeight: 400,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    padding: "2px 6px",
  },
  scoreSelf: { color: "#22c55e" },
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<Game />);
