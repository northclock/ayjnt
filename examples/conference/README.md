# ayjnt example: conference

A Zoom-lite multi-participant video call with **live Whisper
transcription per speaker**, built as **two collaborating agents**:

- `ConferenceRoom` — one DO per room. Tracks participants, relays
  WebRTC signaling, holds the shared transcript.
- `Transcriber` — one DO per user. Receives that user's audio frames,
  runs a streaming Whisper session, and forwards finalized utterances
  to the room via typed inter-agent RPC.

The two-agent split is intentional: it shows ayjnt agents composing
cleanly. A single-DO version is shorter (and the architecture diagram
under "Limitations" sketches it) — pick whichever fits your app.

```
agents/
├── room/
│   ├── agent.ts         ← ConferenceRoom (state + signaling + transcript)
│   ├── peer-mesh.ts     ← WebRTC peer-mesh manager (P2P)
│   ├── audio-capture.ts ← AudioWorklet mic → 16kHz int16 PCM
│   └── app.tsx          ← React UI: tiles + transcript + controls
└── transcriber/
    └── agent.ts         ← Transcriber (per-user Whisper → room RPC)
```

## Architecture

```
┌─ each participant's browser ───────────────────────────────────────┐
│  ws #1 → ConferenceRoom (room state, signaling, transcript)       │
│    ↑ hello, media-state, webrtc                                   │
│    ↓ webrtc-from, state sync (participants + transcript)          │
│                                                                   │
│  ws #2 → Transcriber (per-user STT)                               │
│    ↑ bind (once), then binary 16kHz int16 PCM                     │
│    on utterance:                                                  │
│      Transcriber → getAgent<ConferenceRoom>(env, roomId)          │
│                  → room.recordUtterance(participantId, text)      │
│                                                                   │
│  WebRTC P2P mesh: direct media between participants.              │
└───────────────────────────────────────────────────────────────────┘
```

**Stable `participantId`** minted by the client on join is the shared
key — both agents know the user by the same id, so the room can
attribute every utterance to a known participant. No "Unknown
speaker" entries.

**Per-speaker transcription**: each Transcriber's STT session sees one
person's audio. The room's transcript is the merge.

**Why P2P mesh for media, not SFU**: simple, no Cloudflare Realtime
setup, works well for 2–4 participants. Bandwidth scales O(n²); past
~4 you want an SFU.

## What ayjnt wires up

One import of `@cloudflare/voice` anywhere in the workspace flips the
`voice` feature flag, which auto-adds:

```jsonc
// .ayjnt/dist/wrangler.jsonc (generated)
"compatibility_flags": ["nodejs_compat"],
"ai": { "binding": "AI" }
```

Both agents land in `wrangler.jsonc`'s `durable_objects.bindings` and
the migrations lockfile:

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "CONFERENCE_ROOM", "class_name": "ConferenceRoom" },
    { "name": "TRANSCRIBER",     "class_name": "Transcriber"     }
  ]
}
```

`GeneratedEnv` gets `CONFERENCE_ROOM`, `TRANSCRIBER`, `AI`, and
`ASSETS` (the last only because the room has a co-located `app.tsx`).

## Try it

```sh
bun install
bun run dev
```

Open two tabs (or two devices on the same network) at:

```
http://localhost:8787/room/standup
http://localhost:8787/room/standup
```

Pick a display name in each tab, grant camera + mic. Talk —
utterances appear in the transcript on both sides within a second.

## Inter-agent RPC — the key bit

The Transcriber forwards utterances to the room with one line:

```ts
// agents/transcriber/agent.ts
import { getAgent } from "ayjnt/rpc";
import type ConferenceRoom from "../room/agent.ts";

const room = await getAgent<ConferenceRoom>(this.env.CONFERENCE_ROOM, roomId);
await room.recordUtterance(participantId, text);
```

`getAgent<T>` returns a typed DO stub. `recordUtterance` is a plain
public method on the `ConferenceRoom` class — no decorator needed
because we're calling it via the Durable Object RPC channel (not from
a browser). Errors thrown in the room propagate back through the
`await`.

The `import type ConferenceRoom from "../room/agent.ts"` is type-only:
the worker-only modules `ConferenceRoom` imports (`@cloudflare/voice`,
`agents`) don't leak into the Transcriber bundle.

## Controls

| Control | What it does |
|---|---|
| **mute / unmute** | Disables mic track AND suppresses outgoing audio frames so muted speech doesn't reach Whisper. |
| **camera off / on** | Disables local video track; remote tiles show the speaker's initials. |
| **share screen** | Acquires `getDisplayMedia` and swaps the video track on every peer connection (no renegotiation — `RTCRtpSender.replaceTrack`). |
| **clear transcript** | Calls `@callable clearTranscript()` on the room. Wipes the log for every participant. |

## Wire protocol

### WS #1: client → ConferenceRoom (JSON only — no binary)

```ts
{ kind: "hello",       participantId: string, displayName: string }
{ kind: "media-state", muted?: boolean, cameraOn?: boolean, screenSharing?: boolean }
{ kind: "webrtc",      to: string, signal: { type: "offer"|"answer", sdp } | { type: "ice", candidate } }
```

ConferenceRoom → client:

```ts
{ kind: "webrtc-from", from: string, signal: ... }     // relayed signaling
// + state sync via ayjnt's useAgent layer: { participants, transcript }
```

### WS #2: client → Transcriber

```ts
{ kind: "bind", roomId: string, participantId: string, displayName: string }   // once on open
```

…then binary frames carrying 16kHz mono 16-bit LE PCM.

### Transcriber → ConferenceRoom (DO RPC, no WebSocket)

```ts
room.recordUtterance(participantId: string, text: string): Promise<void>
```

## File tour

- **`agents/room/agent.ts`** — `ConferenceRoom extends Agent`.
  Connection lifecycle + signaling relay + `recordUtterance` RPC entry
  point. No STT — it lives entirely in the Transcriber.

- **`agents/transcriber/agent.ts`** — `Transcriber extends Agent`.
  Per-connection Whisper session, fed by binary WS frames. On
  utterance, `getAgent<ConferenceRoom>` for the typed stub, then
  `room.recordUtterance(...)`.

- **`agents/room/peer-mesh.ts`** — `PeerMesh` with one
  `RTCPeerConnection` per other participant. Implements MDN's
  [perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation_pattern)
  pattern.

- **`agents/room/audio-capture.ts`** — `AudioWorkletProcessor`
  (inlined as a source string + loaded via Blob URL) batches Float32
  samples into 4096-sample frames. Linear resampler converts to
  16kHz int16, ready for the Transcriber.

- **`agents/room/app.tsx`** — React UI. `useAgent()` from `@ayjnt/room`
  for state sync to the room, a raw `WebSocket` to the Transcriber
  for the audio stream.

## Limitations & "what would I change for production"

- **P2P mesh caps at ~4 participants** before O(n²) bandwidth bites.
  Production: swap in [Cloudflare Realtime
  SFU](https://developers.cloudflare.com/realtime/) and keep the
  agent-driven transcript logic.
- **Two-agent split costs an extra WebSocket per user.** Could fold
  STT back into the room DO (one DO, audio frames keyed on
  `conn.id`). The split is here to teach inter-agent RPC; a real
  product would pick whichever fits its concurrency story.
- **No TURN server**. Add a TURN service (Cloudflare offers one) to
  the `iceServers` array in `peer-mesh.ts` for strict NAT users.
- **STT is English-only by default** — change `language: "en"` in
  `agents/transcriber/agent.ts`.
- **No recording.** Transcript lives in memory + DO state (capped at
  200 lines). Persist to D1 / R2 for a durable record.
- **Screen-share audio is dropped.** Browsers' `getDisplayMedia` audio
  is partially supported; example shares video only.

## See also

- [`examples/voice-agent`](../voice-agent) — single-user `withVoice`
  pattern.
- [`examples/inter-agent`](../inter-agent) — the simpler typed RPC
  example (`getAgent<T>` between two agents).
- [Cloudflare Voice docs](https://developers.cloudflare.com/agents/api-reference/voice/) —
  `WorkersAIFluxSTT` and friends.
