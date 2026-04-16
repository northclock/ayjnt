# ayjnt example: chess

Two-player chess. The Durable Object owns the board and validates every move server-side; the React UI only proposes. Spectators can watch but not move.

```
agents/
  match/
    agent.ts   ← board state, move validation, turn enforcement, win/loss
    app.tsx    ← board UI (unicode pieces) + seat-claim + move history
```

## Scaffold

```sh
bunx ayjnt new my-chess --with-ui
cd my-chess
rm -rf agents/counter
mkdir -p agents/match
# copy agents/match/agent.ts and app.tsx from this example
bun install
```

## Run

```sh
bun run dev
open http://localhost:8787/match/saturday    # tab 1 — name "alice", click ♔ white
open http://localhost:8787/match/saturday    # tab 2 — name "bob",  click ♚ black
open http://localhost:8787/match/saturday    # tab 3 — spectator, can't move
```

## The "constrain mutations server-side" pattern

Every interesting bit of state lives in the agent. Clients send *intent* (`{ kind: "move", from: 12, to: 28 }`) — the server decides whether it's legal, applies it, broadcasts the new board.

```
client UI                 server (DO)
─────────                 ───────────
click e2 → click e4
                          on "move":
       ─{ from: 52, to: 36 }─►   sideOfConnection(connId) = "w"  ✓
                                 toMove === "w"                  ✓
                                 validateMove(board, 52, 36, "w") ✓
                                 board[36] = pawn; board[52] = null
                                 toMove = "b"
                                 setState(...)
       ◄─CF_AGENT_STATE──        broadcast new board
re-render board
```

This means:

- **Clients can't cheat** — sending `{ from: 4, to: 60 }` to teleport the king is rejected by `validateMove`.
- **Wrong turn rejected** — black moving on white's turn is dropped silently. The client could grey out, but defense in depth.
- **Spectators are free** — they connect, see state, can't `move`.

## Seat claiming

Seats are tracked by `connection.id`. The first connection that sends `{ kind: "join", side: "w" }` becomes white. Re-joining as the same side is idempotent. Switching sides moves you (and frees the other seat). On `onClose`, the seat opens up automatically.

We could store seats as per-connection state too, but it's easier to broadcast (so spectators see who's playing) when it lives in agent state.

## Validation scope

The validator covers piece movement + captures + turn order. **Skipped on purpose** to keep the example readable:

- castling
- en passant
- pawn promotion (auto-queens any pawn reaching the back rank)
- check / checkmate detection (game ends when the king is captured — cheap stand-in)
- draw by repetition / 50-move rule

If you want a complete engine, drop in [chess.js](https://github.com/jhlywa/chess.js) — replace `validateMove` with a `chess.move(...)` call and store FEN instead of a board array.

## Pitfalls

- **Reset only works post-game.** If both players want to abort mid-game you'd need an offer/accept handshake. Single-side reset would be unfair.
- **No replay if you reload.** State persists in the DO, but if you reload the tab your connection id changes — the seat opens up. Real apps would track players by an auth identity instead of connection id.
- **Auto-promote to queen** is fine for fast play but limits promotion-to-knight tactics. Add a follow-up frame `{ kind: "promote", to: "N" }` for full play.

## Deploy

```sh
bun run deploy
# share /match/<game-id> with a friend
```

## See also

- [`examples/space-game`](../space-game) for realtime vs turn-based trade-offs
- [`examples/with-ui`](../with-ui) for the co-located UI primitive this builds on
- [chess.js](https://github.com/jhlywa/chess.js) if you want a full rules engine
