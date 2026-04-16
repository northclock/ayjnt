import { Agent, type Connection, type WSMessage } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Color = "w" | "b";
type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";
type Piece = { color: Color; type: PieceType };

/** Square grid, 0..63. row = i / 8 (0 = top = black). */
type Board = (Piece | null)[];

type Move = {
  from: number;
  to: number;
  /** algebraic for display, e.g. "e4". */
  san: string;
  capture?: PieceType;
};

type State = {
  board: Board;
  toMove: Color;
  /** connection.id of each side's player; null while seat is open. */
  white: string | null;
  black: string | null;
  /** display name for each side. */
  whiteName: string | null;
  blackName: string | null;
  history: Move[];
  /** Set when the game ends — null while in progress. */
  result: "white" | "black" | "draw" | null;
};

type ClientFrame =
  | { kind: "hello"; name: string }
  | { kind: "join"; side: Color }
  | { kind: "move"; from: number; to: number }
  | { kind: "reset" };

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/**
 * MatchAgent — one game of chess per /match/<name>. Two players, all the
 * spectators you want. Server validates moves; the client only proposes.
 *
 * Move legality covers basic piece movement + captures + turn order, but
 * (intentionally) skips: castling, en-passant, pawn promotion (auto-Q),
 * check/checkmate detection, draw-by-repetition. Adding those would
 * crowd out the framework lessons. The README points to chess.js if you
 * want a full engine.
 */
export default class MatchAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = freshState();

  override async onConnect(conn: Connection): Promise<void> {
    conn.setState({ name: null });
  }

  override async onMessage(
    conn: Connection,
    message: WSMessage,
  ): Promise<void> {
    if (typeof message !== "string") return;
    const frame = JSON.parse(message) as ClientFrame;
    const connState = conn.state as { name: string | null } | null;

    switch (frame.kind) {
      case "hello": {
        const name = frame.name.trim().slice(0, 24) || "guest";
        conn.setState({ name });
        // Re-bind names if this connection happens to already hold a seat.
        const next = { ...this.state };
        if (next.white === conn.id) next.whiteName = name;
        if (next.black === conn.id) next.blackName = name;
        this.setState(next);
        break;
      }
      case "join": {
        if (!connState?.name) return;
        const name = connState.name;
        const next = { ...this.state };
        if (frame.side === "w") {
          if (next.white && next.white !== conn.id) return;
          // Move out of black if claiming white.
          if (next.black === conn.id) {
            next.black = null;
            next.blackName = null;
          }
          next.white = conn.id;
          next.whiteName = name;
        } else {
          if (next.black && next.black !== conn.id) return;
          if (next.white === conn.id) {
            next.white = null;
            next.whiteName = null;
          }
          next.black = conn.id;
          next.blackName = name;
        }
        this.setState(next);
        break;
      }
      case "move": {
        if (this.state.result) return; // game over
        const side = sideOfConnection(conn.id, this.state);
        if (!side) return; // spectator
        if (side !== this.state.toMove) return; // wrong turn

        const validation = validateMove(
          this.state.board,
          frame.from,
          frame.to,
          side,
        );
        if (!validation.ok) return;

        const piece = this.state.board[frame.from]!;
        const capture = this.state.board[frame.to];
        const board = [...this.state.board];
        // Auto-queen: promote any pawn reaching the back rank.
        const moved =
          piece.type === "P" && (frame.to < 8 || frame.to >= 56)
            ? { ...piece, type: "Q" as const }
            : piece;
        board[frame.to] = moved;
        board[frame.from] = null;

        const move: Move = {
          from: frame.from,
          to: frame.to,
          san: square(frame.to),
          capture: capture?.type,
        };

        // Win condition: capturing the king ends the match. Cheap stand-in
        // for proper checkmate detection.
        const kingCaptured = capture?.type === "K";

        this.setState({
          ...this.state,
          board,
          toMove: side === "w" ? "b" : "w",
          history: [...this.state.history, move],
          result: kingCaptured ? (side === "w" ? "white" : "black") : null,
        });
        break;
      }
      case "reset": {
        // Only seated players may reset, and only after game over (or by
        // both sides agreeing — we keep it simple here: post-game only).
        if (!this.state.result) return;
        const side = sideOfConnection(conn.id, this.state);
        if (!side) return;
        this.setState({
          ...freshState(),
          // Preserve the seating so consecutive games don't require re-joining.
          white: this.state.white,
          black: this.state.black,
          whiteName: this.state.whiteName,
          blackName: this.state.blackName,
        });
        break;
      }
    }
  }

  override async onClose(conn: Connection): Promise<void> {
    // Free up the seat when a player disconnects.
    const next = { ...this.state };
    if (next.white === conn.id) {
      next.white = null;
      next.whiteName = null;
    }
    if (next.black === conn.id) {
      next.black = null;
      next.blackName = null;
    }
    this.setState(next);
  }

  override async onRequest(): Promise<Response> {
    return Response.json({
      instance: this.name,
      toMove: this.state.toMove,
      moves: this.state.history.length,
      result: this.state.result,
    });
  }
}

// -- pure helpers below ---------------------------------------------------

function sideOfConnection(connId: string, state: State): Color | null {
  if (connId === state.white) return "w";
  if (connId === state.black) return "b";
  return null;
}

function square(i: number): string {
  const file = FILES[i % 8]!;
  const rank = 8 - Math.floor(i / 8);
  return `${file}${rank}`;
}

function freshState(): State {
  return {
    board: startingBoard(),
    toMove: "w",
    white: null,
    black: null,
    whiteName: null,
    blackName: null,
    history: [],
    result: null,
  };
}

function startingBoard(): Board {
  // Row 0 = black back rank, row 7 = white back rank.
  const back: PieceType[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  const b: Board = new Array(64).fill(null);
  for (let i = 0; i < 8; i++) {
    b[i] = { color: "b", type: back[i]! };
    b[8 + i] = { color: "b", type: "P" };
    b[48 + i] = { color: "w", type: "P" };
    b[56 + i] = { color: "w", type: back[i]! };
  }
  return b;
}

function validateMove(
  board: Board,
  from: number,
  to: number,
  side: Color,
): { ok: boolean; reason?: string } {
  if (from < 0 || from > 63 || to < 0 || to > 63) {
    return { ok: false, reason: "out of bounds" };
  }
  const piece = board[from];
  if (!piece || piece.color !== side) {
    return { ok: false, reason: "not your piece" };
  }
  const target = board[to];
  if (target && target.color === side) {
    return { ok: false, reason: "own piece in target" };
  }

  const fr = Math.floor(from / 8);
  const fc = from % 8;
  const tr = Math.floor(to / 8);
  const tc = to % 8;
  const dr = tr - fr;
  const dc = tc - fc;
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);

  switch (piece.type) {
    case "P": {
      const dir = side === "w" ? -1 : 1;
      const startRank = side === "w" ? 6 : 1;
      // Forward 1 — empty.
      if (dc === 0 && dr === dir && !target) return { ok: true };
      // Forward 2 from start — empty path.
      if (
        dc === 0 &&
        fr === startRank &&
        dr === 2 * dir &&
        !target &&
        !board[from + 8 * dir]
      )
        return { ok: true };
      // Diagonal capture.
      if (adc === 1 && dr === dir && target && target.color !== side)
        return { ok: true };
      return { ok: false, reason: "illegal pawn move" };
    }
    case "N": {
      if ((adr === 2 && adc === 1) || (adr === 1 && adc === 2))
        return { ok: true };
      return { ok: false, reason: "illegal knight move" };
    }
    case "B":
      if (adr === adc && pathClear(board, from, to, dr, dc)) return { ok: true };
      return { ok: false, reason: "illegal bishop move" };
    case "R":
      if ((dr === 0 || dc === 0) && pathClear(board, from, to, dr, dc))
        return { ok: true };
      return { ok: false, reason: "illegal rook move" };
    case "Q":
      if (
        (dr === 0 || dc === 0 || adr === adc) &&
        pathClear(board, from, to, dr, dc)
      )
        return { ok: true };
      return { ok: false, reason: "illegal queen move" };
    case "K":
      if (adr <= 1 && adc <= 1) return { ok: true };
      return { ok: false, reason: "illegal king move" };
  }
}

function pathClear(
  board: Board,
  from: number,
  to: number,
  dr: number,
  dc: number,
): boolean {
  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);
  const fr = Math.floor(from / 8);
  const fc = from % 8;
  const tr = Math.floor(to / 8);
  const tc = to % 8;
  let r = fr + stepR;
  let c = fc + stepC;
  while (!(r === tr && c === tc)) {
    if (board[r * 8 + c]) return false;
    r += stepR;
    c += stepC;
  }
  return true;
}
