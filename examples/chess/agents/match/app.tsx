import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { useAgent } from "@ayjnt/match";
import type { PlayerConfig } from "./agent";

const glyphs: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};
type Mode = "human-white" | "human-black" | "agents";

export default function Match() {
  const agent = useAgent();
  const [mode, setMode] = useState<Mode>("human-white");
  const [selected, setSelected] = useState<string | null>(null);
  const [white, setWhite] = useState<PlayerConfig>({ provider: "openai" });
  const [black, setBlack] = useState<PlayerConfig>({ provider: "gemini" });
  const state = agent.state;
  const chess = useMemo(() => new Chess(state?.fen), [state?.fen]);

  const humanSide = mode === "human-white" ? "w" : mode === "human-black" ? "b" : null;
  useEffect(() => {
    if (!state || state.thinking || chess.isGameOver() || chess.turn() === humanSide) return;
    const config = chess.turn() === "w" ? white : black;
    const timer = window.setTimeout(() => {
      void agent.call("askModel", [chess.turn(), config]);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [agent, black, chess, humanSide, state, white]);

  if (!state) return <main style={styles.main}>Connecting…</main>;
  const board = chess.board().flat();
  const click = async (index: number) => {
    if (chess.turn() !== humanSide || state.thinking) return;
    const square = `${"abcdefgh"[index % 8]}${8 - Math.floor(index / 8)}`;
    if (!selected) {
      const piece = board[index];
      if (piece?.color === humanSide) setSelected(square);
      return;
    }
    await agent.call("move", [`${selected}${square}`]);
    setSelected(null);
  };

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div><small style={styles.eyebrow}>CHESS ARENA</small><h1 style={styles.h1}>{agent.name}</h1></div>
        <select value={mode} onChange={(event) => setMode(event.target.value as Mode)} style={styles.select}>
          <option value="human-white">Play as White</option>
          <option value="human-black">Play as Black</option>
          <option value="agents">Two agents</option>
        </select>
      </header>
      <div style={styles.layout}>
        <section>
          <div style={styles.status}>{state.thinking ? `${state.thinking === "w" ? "White" : "Black"} is thinking…` : state.status}</div>
          <div style={styles.board}>
            {board.map((piece, index) => {
              const square = `${"abcdefgh"[index % 8]}${8 - Math.floor(index / 8)}`;
              return (
                <button key={square} onClick={() => click(index)} style={{
                  ...styles.square,
                  background: (Math.floor(index / 8) + index) % 2 ? "#5573a9" : "#e7e7df",
                  outline: selected === square ? "3px solid #ff9254" : "none",
                }}>
                  {piece ? glyphs[piece.color + piece.type] : ""}
                </button>
              );
            })}
          </div>
        </section>
        <aside style={styles.sidebar}>
          <Player title="White" value={white} onChange={setWhite} disabled={humanSide === "w"} />
          <Player title="Black" value={black} onChange={setBlack} disabled={humanSide === "b"} />
          <button onClick={() => agent.call("reset", [])} style={styles.reset}>New game</button>
          <ol style={styles.moves}>{state.history.map((move, index) => <li key={index}>{index + 1}. {move}</li>)}</ol>
        </aside>
      </div>
    </main>
  );
}

function Player({ title, value, onChange, disabled }: {
  title: string; value: PlayerConfig; onChange: (value: PlayerConfig) => void; disabled: boolean;
}) {
  return (
    <fieldset style={{ ...styles.player, opacity: disabled ? 0.45 : 1 }} disabled={disabled}>
      <legend>{title} {disabled ? "· human" : "· agent"}</legend>
      <select value={value.provider} onChange={(event) => onChange({ ...value, provider: event.target.value as PlayerConfig["provider"] })} style={styles.select}>
        <option value="openai">OpenAI</option><option value="gemini">Gemini</option>
        <option value="claude">Claude</option><option value="ollama">Ollama</option>
      </select>
      {value.provider === "ollama" ? (
        <input placeholder="http://localhost:11434" value={value.baseUrl ?? ""} onChange={(event) => onChange({ ...value, baseUrl: event.target.value })} style={styles.input} />
      ) : (
        <input type="password" placeholder={`${value.provider} API key`} value={value.apiKey ?? ""} onChange={(event) => onChange({ ...value, apiKey: event.target.value })} style={styles.input} />
      )}
      <textarea placeholder="Additional playing style…" value={value.instructions ?? ""} onChange={(event) => onChange({ ...value, instructions: event.target.value })} style={styles.textarea} />
    </fieldset>
  );
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 1050, margin: "0 auto", padding: "30px 20px", color: "#172033" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 24 },
  eyebrow: { color: "#225dd8", fontFamily: "monospace", letterSpacing: "0.16em" },
  h1: { margin: "5px 0 0", fontSize: 32 },
  layout: { display: "grid", gridTemplateColumns: "minmax(420px, 640px) 1fr", gap: 25 },
  status: { minHeight: 24, color: "#697180", fontSize: 13 },
  board: { display: "grid", gridTemplateColumns: "repeat(8, 1fr)", aspectRatio: "1", border: "8px solid #172033" },
  square: { border: 0, display: "grid", placeItems: "center", fontSize: "clamp(28px, 5vw, 54px)", padding: 0, cursor: "pointer" },
  sidebar: { display: "grid", gap: 13, alignContent: "start" },
  player: { display: "grid", gap: 8, border: "1px solid #d8dce2", borderRadius: 10, padding: 14 },
  select: { padding: "9px 10px", borderRadius: 7, border: "1px solid #cfd4dc", background: "white" },
  input: { padding: 9, borderRadius: 7, border: "1px solid #cfd4dc" },
  textarea: { padding: 9, borderRadius: 7, border: "1px solid #cfd4dc", minHeight: 62, resize: "vertical" as const },
  reset: { padding: 10, background: "#172033", color: "white", border: 0, borderRadius: 8 },
  moves: { maxHeight: 160, overflow: "auto", columns: 2, fontFamily: "monospace", fontSize: 11, color: "#697180" },
};
