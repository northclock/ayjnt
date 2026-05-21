# ayjnt example: conference

A Zoom-lite multi-participant video call with **live Whisper
transcription per speaker**. Everyone in the room sees the same
running conversation log — colored by speaker — alongside the video
tiles.

```
agents/
└── room/
    ├── agent.ts          ← ConferenceRoom (DO): signaling + STT + state
    ├── peer-mesh.ts      ← WebRTC peer-mesh manager (P2P)
    ├── audio-capture.ts  ← AudioWorklet mic → 16kHz int16 PCM
    └── app.tsx           ← React UI: tiles + transcript + controls
```

## Architecture

```
┌─ each participant's browser ─────────────────────────────────┐
│  getUserMedia → <video> (self)                               │
│  getUserMedia.mic → AudioContext → AudioWorklet              │
│      → downsample 16kHz int16 PCM                            │
│      → ws.send(binary)                                       │
│                                                              │
│  ws (room agent):                                            │
│    ↑ binary PCM frames                                       │
│    ↕ JSON: hello, media-state, webrtc signaling              │
│    ↓ state sync: participants list + transcript              │
│                                                              │
│  WebRTC P2P mesh: one RTCPeerConnection per other peer.      │
│  Signaling relayed through the agent. Media flows direct.    │
└──────────────────────────────────────────────────────────────┘
```

**Per-speaker transcription**: each WebSocket connection has its own
streaming `WorkersAIFluxSTT` session on the server. When the model
finalizes an utterance for connection X, the agent looks up X's
display name and appends an entry to the room's transcript. `setState`
broadcasts the new transcript line to every connected UI — instant
fan-out, no polling.

**Why P2P mesh, not SFU**: simple to wire up, no Cloudflare Realtime
setup, works great for 2–4 participants. Bandwidth scales O(n²); if
you want bigger rooms swap the mesh for [Cloudflare
Realtime](https://developers.cloudflare.com/realtime/) and keep the
agent-driven STT + transcript logic.

**Why server-side STT**: every browser has different audio formats and
noise floors. Running Whisper centrally gives one consistent
transcript model across all participants. Each connection gets its
own `TranscriberSession` because sessions are stateful — can't share
one across speakers.

## What ayjnt wires up

One import of `@cloudflare/voice` anywhere in the workspace flips
the `voice` feature flag, which auto-adds:

```jsonc
// .ayjnt/dist/wrangler.jsonc (generated)
"compatibility_flags": ["nodejs_compat"],
"ai": { "binding": "AI" }
```

…and augments `GeneratedEnv` with `AI: Ai` so `this.env.AI`
autocompletes inside the agent. Drop a co-located `app.tsx` next to
`agent.ts` and the framework bundles the React UI, mounts it at
`/conference/<room>`, and generates a typed `useAgent` hook in
`@ayjnt/room`.

## Try it

```sh
bun install
bun run dev
```

Open two browser tabs (or two devices on the same network) at:

```
http://localhost:8787/conference/standup
http://localhost:8787/conference/standup
```

Pick a display name in each tab, grant camera + mic, and you're in.
Talk — utterances start appearing in the transcript on both sides
within a second or two.

## Controls

| Control | What it does |
|---|---|
| **mute / unmute** | Disables the mic track AND suppresses audio frames so muted speech doesn't reach Whisper. |
| **camera off / on** | Disables the local video track; remote tiles show the speaker's initials in place of video. |
| **share screen** | Acquires `getDisplayMedia` and swaps the video track on every peer connection (no renegotiation — `RTCRtpSender.replaceTrack`). The browser's "Stop sharing" UI restores camera automatically. |
| **clear transcript** | Calls `@callable clearTranscript()` on the agent. Wipes the log for every participant. |

## Wire protocol

**Client → Server (text JSON frames):**

```ts
{ kind: "hello",       displayName: string }
{ kind: "media-state", muted?: boolean, cameraOn?: boolean, screenSharing?: boolean }
{ kind: "webrtc",      to: string, signal: { type: "offer"|"answer", sdp } | { type: "ice", candidate } }
```

**Client → Server (binary frames):** 16kHz mono 16-bit LE PCM audio chunks.

**Server → specific client (text JSON):**

```ts
{ kind: "self",        id: string }              // your own connection id
{ kind: "webrtc-from", from: string, signal }    // relayed signaling
```

**Server → all clients (state sync):** `{ participants, transcript }`
delivered through ayjnt's `useAgent` state-sync layer. Every UI
re-renders on each update.

## File tour

- **`agent.ts`** — `ConferenceRoom extends Agent`. Manages connection
  lifecycle, runs Whisper per connection, broadcasts state. Uses the
  Agents SDK's `Connection` API (`onConnect` / `onMessage` /
  `onClose`) and conn-level state to track display name + flags.

- **`peer-mesh.ts`** — `PeerMesh` class with one `RTCPeerConnection`
  per other participant. Implements MDN's [perfect
  negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation_pattern)
  pattern for collision-safe renegotiation.

- **`audio-capture.ts`** — `AudioWorkletProcessor` (inlined as a
  source string + loaded via Blob URL) batches Float32 samples into
  4096-sample frames. Main-thread linear-resampler converts to 16kHz
  int16, which the agent feeds straight to Whisper.

- **`app.tsx`** — React UI. `useAgent()` for state sync, raw WebSocket
  events for `self` / `webrtc-from` (those bypass the state-sync
  layer), and refs to keep the long-lived `PeerMesh` /
  `AudioCaptureHandle` instances stable across renders.

## Limitations

- **P2P mesh caps at ~4 participants** before O(n²) bandwidth bites.
  Production: swap in [Cloudflare Realtime
  SFU](https://developers.cloudflare.com/realtime/).
- **No TURN server**. Two participants behind strict NATs may fail
  to connect. Add a TURN service (Cloudflare offers one) to the
  `iceServers` array in `peer-mesh.ts`.
- **STT is English-only by default** — change `language: "en"` in
  `agent.ts` to use other Whisper-supported languages.
- **No recording.** The agent holds the transcript in memory + DO
  state (capped at 200 lines). Persist to D1 or R2 if you need a
  durable record.
- **Screen-share audio is dropped.** `getDisplayMedia({ audio: true })`
  is partially supported in browsers; for simplicity this example
  shares video only.

## See also

- [Cloudflare Voice docs](https://developers.cloudflare.com/agents/api-reference/voice/) — covers `WorkersAIFluxSTT` and friends.
- [Perfect negotiation pattern](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation_pattern) — the MDN doc this mesh implements.
- [`examples/voice-agent`](../voice-agent) — the 1:1 voice agent pattern, simpler.
