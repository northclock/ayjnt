import { Agent, callable } from "ayjnt";
import { Chess } from "chess.js";

type Provider = "openai" | "gemini" | "claude" | "ollama";
export type PlayerConfig = {
  provider: Provider;
  apiKey?: string;
  instructions?: string;
  baseUrl?: string;
};
type State = {
  fen: string;
  history: string[];
  lastMove: string | null;
  status: string;
  thinking: "w" | "b" | null;
};

export default class MatchAgent extends Agent<State> {
  override initialState: State = {
    fen: new Chess().fen(),
    history: [],
    lastMove: null,
    status: "White to move",
    thinking: null,
  };

  @callable()
  async move(uci: string): Promise<{ ok: boolean; error?: string }> {
    if (this.state.thinking) return { ok: false, error: "An agent is thinking." };
    return this.applyMove(uci);
  }

  @callable()
  async askModel(
    side: "w" | "b",
    config: PlayerConfig,
  ): Promise<{ ok: boolean; move?: string; error?: string }> {
    const chess = new Chess(this.state.fen);
    if (chess.turn() !== side || chess.isGameOver() || this.state.thinking) {
      return { ok: false, error: "It is not that player's turn." };
    }
    this.setState({ ...this.state, thinking: side });
    try {
      const legal = chess.moves({ verbose: true }).map((move) =>
        `${move.from}${move.to}${move.promotion ?? ""}`
      );
      const prompt = [
        `You are playing ${side === "w" ? "White" : "Black"}.`,
        `Position (FEN): ${chess.fen()}`,
        `Legal moves: ${legal.join(", ")}`,
        "Choose exactly one legal move. Return only its UCI string.",
        config.instructions?.trim() || "",
      ].filter(Boolean).join("\n");
      const answer = await callProvider(config, prompt);
      const picked = legal.find((move) =>
        answer.toLowerCase().includes(move.toLowerCase())
      );
      if (!picked) throw new Error(`Provider did not return a legal move: ${answer.slice(0, 120)}`);
      this.setState({ ...this.state, thinking: null });
      const result = this.applyMove(picked);
      return { ...result, move: picked };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ ...this.state, thinking: null, status: message });
      return { ok: false, error: message };
    }
  }

  @callable()
  async reset(): Promise<void> {
    this.setState(this.initialState);
  }

  private applyMove(uci: string): { ok: boolean; error?: string } {
    const chess = new Chess(this.state.fen);
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || "q",
      });
      if (!move) return { ok: false, error: "Illegal move." };
      const status = chess.isCheckmate()
        ? `Checkmate — ${chess.turn() === "w" ? "Black" : "White"} wins`
        : chess.isDraw()
          ? "Draw"
          : `${chess.turn() === "w" ? "White" : "Black"} to move${chess.inCheck() ? " — check" : ""}`;
      this.setState({
        fen: chess.fen(),
        history: chess.history(),
        lastMove: `${move.from}${move.to}`,
        status,
        thinking: null,
      });
      return { ok: true };
    } catch {
      return { ok: false, error: "Illegal move." };
    }
  }
}

async function callProvider(config: PlayerConfig, prompt: string): Promise<string> {
  const key = config.apiKey?.trim();
  if (config.provider !== "ollama" && !key) throw new Error("This provider needs an API key.");

  if (config.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-5-mini", input: prompt }),
    });
    const json = await checkedJson(response) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    return json.output_text ?? json.output?.[0]?.content?.[0]?.text ?? "";
  }
  if (config.provider === "gemini") {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key!)}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) },
    );
    const json = await checkedJson(response) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
  if (config.provider === "claude") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 30, messages: [{ role: "user", content: prompt }] }),
    });
    const json = await checkedJson(response) as { content?: Array<{ text?: string }> };
    return json.content?.[0]?.text ?? "";
  }
  const base = (config.baseUrl || "http://localhost:11434").replace(/\/$/, "");
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "qwen3:8b", stream: false, messages: [{ role: "user", content: prompt }] }),
  });
  const json = await checkedJson(response) as { message?: { content?: string } };
  return json.message?.content ?? "";
}

async function checkedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Provider error ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}
