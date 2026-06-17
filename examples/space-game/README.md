# ayjnt example: space-game

A multiplayer asteroid-field shooter. One Durable Object owns the world (ships, bullets, asteroids), runs a 30Hz physics tick, and broadcasts the entire state every frame. Clients send keyboard inputs and render the canvas from state.

```
agents/
  sector/
    agent.ts   ← physics loop, broadcast world state, collision, scoring
    app.tsx    ← canvas renderer + keyboard input
```

## Scaffold

```sh
bunx ayjnt new my-space
cd my-space
rm -rf agents/counter
mkdir -p agents/sector
# copy agents/sector/agent.ts and app.tsx from this example
bun install
```

## Run

```sh
bun run dev
open http://localhost:8787/sector/7-G    # tab 1 — pilot "alice"
open http://localhost:8787/sector/7-G    # tab 2 — pilot "bob"
open http://localhost:8787/sector/9      # different sector, isolated game
```

Controls: <kbd>W</kbd>/<kbd>↑</kbd> thrust · <kbd>A</kbd>/<kbd>D</kbd> turn · <kbd>SPACE</kbd> fire.

## Architecture

The DO owns the *authoritative* simulation. Clients are *display + input*. This avoids cheating, simplifies state-sync, and matches how real multiplayer games work:

```
client #1  ──input──▶  ┌─────────────┐  state every frame  ──▶  client #1
client #2  ──input──▶  │ sector DO   │  state every frame  ──▶  client #2
client #3  ──input──▶  │  - physics  │  state every frame  ──▶  client #3
                       │  - hits     │
                       │  - scoring  │
                       └─────────────┘
                              ▲
                       30 Hz tick (setInterval)
```

The physics loop runs as a `setInterval` *inside the DO*. The DO is alive as long as there's at least one open WebSocket, so the loop survives request boundaries. When the last pilot disconnects, the loop stops; on the next `onConnect`, `ensureLoop()` restarts it.

## State sync vs broadcast

This example uses **state sync only**. Every tick is a `setState({ ships, bullets, asteroids, ... })`. The Agents SDK ships a state diff over every open WebSocket — clients re-render from the new state.

| | Used here | Alternative |
|---|---|---|
| `setState(world)` | ✅ — entire world snapshot per tick | broadcast(`{type:"tick", delta}`) |
| `broadcast(...)` | for one-off events (kill feed, etc.) | not used in this example |

State sync is the simplest possible wire format. At 12 ships and 30Hz, the state object is ~4-6KB per frame uncompressed. For a real shipping game you'd want delta encoding and binary frames. Cloudflare WebSockets do gzip on text frames automatically, so state sync stays viable longer than you'd expect.

## Per-connection vs world state

The world (ships, bullets, asteroids) lives in `this.state`. Per-pilot data (input flags, last-shot timestamp) lives *also* in the world state, indexed by `connection.id`. We don't use `connection.setState()` here because input changes need to be visible to the physics loop, not just the connection that sent them.

## Pitfalls

- **`setInterval` inside a DO is fine but you must clean up.** `stopLoop()` runs in `onClose` when the last pilot leaves, otherwise the alarm cost adds up.
- **No client-side prediction.** Movement is laggy proportional to round-trip latency. For a real game, predict locally and reconcile from server frames.
- **`setState` with unchanged contents still ships a frame.** This example always sets — fine for 30Hz ticks where almost everything moves, wasteful at lower rates. Compare-then-set if you have idle frames.
- **Asteroids reset on cold start.** The first connection re-seeds them in `seedAsteroids()`. State persistence works (Cloudflare keeps the DO state on disk) — the seed only kicks in if state is empty.

## Deploy

```sh
bun run deploy
# /sector/<any-name> on the deployed worker is its own game
```

## See also

- [`examples/chat-rooms`](../chat-rooms) for `broadcast()` for ephemeral per-event messages
- [`examples/chess`](../chess) for turn-based vs realtime trade-offs
- [Cloudflare Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
