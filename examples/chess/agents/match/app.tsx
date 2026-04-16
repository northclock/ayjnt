import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { useAgent } from "@ayjnt/match";

const GLYPH: Record<string, string> = {
  wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
  bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function pickName(): string {
  const stored = localStorage.getItem("ayjnt-chess-name");
  if (stored) return stored;
  const name = prompt("Display name?") ?? "guest";
  const trimmed = name.trim().slice(0, 24) || "guest";
  localStorage.setItem("ayjnt-chess-name", trimmed);
  return trimmed;
}

function Match() {
  const [name] = useState(pickName);
  const [selected, setSelected] = useState<number | null>(null);
  const agent = useAgent();

  useEffect(() => {
    agent.send(JSON.stringify({ kind: "hello", name }));
  }, [agent, name]);

  const state = agent.state;
  if (!state) return <main style={styles.loading}>connecting…</main>;

  const join = (side: "w" | "b") =>
    agent.send(JSON.stringify({ kind: "join", side }));
  const reset = () => agent.send(JSON.stringify({ kind: "reset" }));

  // We don't know our own connection id, but the server echoes our name on
  // the seat we're holding, so compare names to figure out which side we are.
  const mySide =
    state.whiteName === name ? "w" : state.blackName === name ? "b" : null;
  const myTurn = mySide && mySide === state.toMove && !state.result;

  const click = (i: number) => {
    if (state.result) return;
    if (!myTurn) return;
    if (selected === null) {
      const piece = state.board[i];
      if (piece && piece.color === mySide) setSelected(i);
      return;
    }
    if (selected === i) {
      setSelected(null);
      return;
    }
    agent.send(JSON.stringify({ kind: "move", from: selected, to: i }));
    setSelected(null);
  };

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>match — {agent.name}</h1>
        <div style={styles.seats}>
          <SeatPill
            color="w"
            seatedName={state.whiteName}
            you={mySide === "w"}
            onJoin={() => join("w")}
          />
          <SeatPill
            color="b"
            seatedName={state.blackName}
            you={mySide === "b"}
            onJoin={() => join("b")}
          />
        </div>
      </header>

      <div style={styles.status}>
        {state.result
          ? state.result === "draw"
            ? "draw"
            : `${state.result} wins`
          : `${state.toMove === "w" ? "white" : "black"} to move${
              myTurn ? " — your move" : ""
            }`}
      </div>

      <div style={styles.board}>
        {state.board.map((piece, i) => {
          const r = Math.floor(i / 8);
          const c = i % 8;
          const dark = (r + c) % 2 === 1;
          const isSelected = selected === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => click(i)}
              style={{
                ...styles.sq,
                background: dark ? "#b58863" : "#f0d9b5",
                ...(isSelected ? styles.sqSelected : null),
              }}
            >
              {piece && (
                <span style={piece.color === "w" ? styles.wPiece : styles.bPiece}>
                  {GLYPH[piece.color + piece.type]}
                </span>
              )}
              {c === 0 && <span style={styles.rankLabel}>{8 - r}</span>}
              {r === 7 && <span style={styles.fileLabel}>{FILES[c]}</span>}
            </button>
          );
        })}
      </div>

      <ol style={styles.history}>
        {state.history.map((m, i) => (
          <li key={i} style={styles.move}>
            {Math.floor(i / 2) + 1}.{i % 2 === 0 ? "" : ".."} {m.san}
            {m.capture ? "×" : ""}
          </li>
        ))}
      </ol>

      {state.result && mySide && (
        <button style={styles.reset} onClick={reset}>
          new game
        </button>
      )}
    </main>
  );
}

function SeatPill({
  color,
  seatedName,
  you,
  onJoin,
}: {
  color: "w" | "b";
  seatedName: string | null;
  you: boolean;
  onJoin: () => void;
}) {
  const open = !seatedName;
  return (
    <button
      style={{
        ...styles.seat,
        background: color === "w" ? "#fff" : "#222",
        color: color === "w" ? "#222" : "#fff",
        ...(you ? styles.seatYou : null),
        ...(open ? styles.seatOpen : null),
      }}
      onClick={open ? onJoin : undefined}
      disabled={!open}
    >
      {color === "w" ? "♔ white" : "♚ black"}:{" "}
      {seatedName ?? "click to take seat"}
    </button>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 520,
    margin: "24px auto",
    padding: 16,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { margin: 0, fontSize: 18 },
  seats: { display: "flex", gap: 6 },
  seat: {
    border: "1px solid #ccc",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    cursor: "default",
  },
  seatYou: { outline: "2px solid #1d4ed8" },
  seatOpen: { cursor: "pointer", borderStyle: "dashed" as const },
  status: { fontSize: 14, color: "#444", margin: "12px 0 4px", minHeight: 20 },
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(8, 56px)",
    gridTemplateRows: "repeat(8, 56px)",
    border: "2px solid #333",
  },
  sq: {
    position: "relative" as const,
    border: "none",
    padding: 0,
    fontSize: 36,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  },
  sqSelected: {
    boxShadow: "inset 0 0 0 3px #fbbf24",
  },
  wPiece: { color: "#fff", textShadow: "0 0 1px #000, 0 1px 2px rgba(0,0,0,.4)" },
  bPiece: { color: "#000", textShadow: "0 0 1px #fff" },
  rankLabel: {
    position: "absolute" as const,
    top: 2,
    left: 4,
    fontSize: 10,
    color: "rgba(0,0,0,.45)",
  },
  fileLabel: {
    position: "absolute" as const,
    bottom: 2,
    right: 4,
    fontSize: 10,
    color: "rgba(0,0,0,.45)",
  },
  history: {
    listStyle: "none",
    padding: 0,
    margin: "16px 0",
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "4px 12px",
    fontFamily: "ui-monospace, monospace",
    fontSize: 13,
    color: "#555",
  },
  move: {},
  reset: {
    marginTop: 12,
    padding: "10px 16px",
    background: "#1d4ed8",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
  },
  loading: {
    fontFamily: "system-ui, sans-serif",
    textAlign: "center" as const,
    padding: 40,
    color: "#666",
  },
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<Match />);
