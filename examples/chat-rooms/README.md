# ayjnt example: chat-rooms

Multi-user realtime chat with one Durable Object per room. Covers WebSocket lifecycle (`onConnect` / `onMessage` / `onClose`), broadcasting ephemeral events, presence tracking via per-connection state, and the trade-off between persistent state-sync and transient broadcasts.

```
agents/
  room/
    agent.ts   ← onConnect/onMessage/onClose, broadcast() for typing
    app.tsx    ← React UI: history, presence, typing indicator
```

## Scaffold

```sh
bunx ayjnt new my-chat
cd my-chat
rm -rf agents/counter
mkdir -p agents/room
# copy agents/room/agent.ts and app.tsx from this example
bun install
```

## Run

```sh
bun run dev
open http://localhost:8787/room/general    # tab 1 — pick name "alice"
open http://localhost:8787/room/general    # tab 2 — pick name "bob"
open http://localhost:8787/room/random     # different room, fully isolated
```

Type in one tab → message appears in the other within ~50ms. Start typing without sending → "alice is typing…" appears in bob's tab and clears on send or after 2.5s.

## How the two channels work together

State sync (via `setState`) and broadcast (via `this.broadcast`) cover different needs.

| Channel | Used for | Persisted? | Available to new connections? |
|---|---|---|---|
| `setState({ messages, members })` | history, presence | yes | yes — sent on connect |
| `this.broadcast(JSON.stringify(...))` | typing indicators | no | no — only live sockets |

If you tried to drive typing indicators through `setState`, two things would break: every new connection would see "alice is typing" frozen in time, and every keystroke would re-snapshot the entire `messages` array.

## Wire frames

The agent and UI agree on a tiny JSON envelope:

```ts
type ClientFrame =
  | { kind: "hello"; name: string }    // identify on connect
  | { kind: "say"; text: string }      // post a message
  | { kind: "typing"; on: boolean };   // typing indicator pulse

type ServerFrame =
  | { kind: "typing"; from: string; on: boolean };
```

`hello` runs once on socket open. `say` and `typing` are user-driven. The server only ever broadcasts `typing` — chat history reaches the UI through state sync.

## Per-connection state

`conn.setState({ name })` stashes data scoped to a single websocket. The agent reads it back via `(conn.state as ...)?.name` to validate `say` and `typing` frames against the connection's identity. Per-connection state survives hibernation but is destroyed when the socket closes.

## Pitfalls

- **`onMessage` ignores binary.** This example only handles strings; binary frames (`ArrayBuffer`) are silently dropped. Real-world chat usually transports JSON over text frames, so that's fine — but if you wire up images later, branch on `typeof message`.
- **Broadcast doesn't include the sender by default.** Pass the sender's id in the `without` array (second arg) to skip the echo round-trip.
- **`setState` ships the whole state object on every change.** Keep history bounded — this example caps at 100. A 10k-message room would re-broadcast the entire array on every new line.

## Deploy

```sh
bun run deploy
# Each /room/<id> is its own Durable Object on the edge — Cloudflare
# routes by id, so room hot-spots don't fight each other.
```

## See also

- [`examples/with-ui`](../with-ui) for the smaller co-located UI pattern
- [`examples/scheduled-tasks`](../scheduled-tasks) for combining schedules with chat (e.g. recurring announcements)
