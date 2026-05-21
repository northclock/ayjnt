# ayjnt example: voice-agent

A real-time **voice conversational agent** built with the `withVoice`
mixin from `@cloudflare/voice` — STT in, LLM-driven turn handling,
TTS out — and a React UI that drives it.

## What's voice-specific

Two pieces:

1. **`extends withVoice(Agent)`** — the mixin that adds STT/TTS pipeline
   methods (`onTurn`, `speak`, `forceEndCall`, etc.) onto the regular
   Agent base. Ships from `@cloudflare/voice`.
2. **Browser hook** — `useVoiceAgent` from `@cloudflare/voice/react`
   manages mic capture, audio streaming, and conversation state.

Cloudflare's stock setup requires you to wire the URL between them
yourself (the SDK's default partysocket URL — `/agents/<kebab>/<name>`
— doesn't match ayjnt's `/<route>/<instance>`). ayjnt's voice
integration handles that.

## What ayjnt wires up

The single `withVoice(Agent)` source-level token in `agent.ts`
triggers three pieces of codegen:

### 1. `wrangler.jsonc` — `ai` binding

```jsonc
{
  "ai": { "binding": "AI" }
}
```

So `new WorkersAIFluxSTT(this.env.AI)` and `new WorkersAITTS(this.env.AI)`
resolve at runtime.

### 2. `env.d.ts` — typed `AI` field

```ts
type GeneratedEnv = {
  CHAT_VOICE: DurableObjectNamespace<ChatVoice>;
  AI: Ai;
};
```

### 3. Typed `useVoiceAgent` hook

`@ayjnt/<route>` now exports `useVoiceAgent` (not `useAgent`) — pre-bound
to the agent class and to ayjnt's URL shape via a custom
`AyjntVoiceTransport`:

```tsx
import { useVoiceAgent } from "@ayjnt/chat";

const v = useVoiceAgent();   // no agent name, no URL — both pre-wired
v.startCall();               // mic capture + STT + onTurn round-trip
```

The transport bypasses partysocket and opens a raw WebSocket against
`/<route>/<instance>` — same path the worker dispatches against, so
the SDK and the framework agree on routing.

## What the agent looks like

```ts
import { Agent } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS } from "@cloudflare/voice";

export default class ChatVoice extends withVoice(Agent)<Env, State> {
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);

  async onTurn(transcript: string): Promise<string> {
    return `You said: ${transcript}`;        // → TTS → user
  }
}
```

`onTurn` is the one method you have to write. Return a string and the
framework sends it through TTS back to the user. Return an
`AsyncIterable<string>` (e.g. from an LLM streaming call) to stream
the response in real-time.

## What the UI looks like

```tsx
import { useVoiceAgent } from "@ayjnt/chat";

export default function VoiceUI() {
  const v = useVoiceAgent();
  return (
    <main>
      <p>status: {v.status} · level: {v.audioLevel.toFixed(2)}</p>
      <button onClick={() => v.startCall()}>start</button>
      <button onClick={() => v.toggleMute()}>{v.isMuted ? "unmute" : "mute"}</button>
      <button onClick={() => v.endCall()}>end</button>
      <ol>
        {v.transcript.map((m, i) => <li key={i}>{m.role}: {m.content}</li>)}
      </ol>
    </main>
  );
}
```

Returns the same shape as `useVoiceAgent` from
`@cloudflare/voice/react`:

| Field | Type |
|---|---|
| `status` | `"idle" \| "listening" \| "thinking" \| "speaking"` |
| `transcript` | `TranscriptMessage[]` — conversation history |
| `interimTranscript` | `string \| null` — live partial transcript |
| `audioLevel` | `number` (0–1) |
| `isMuted` | `boolean` |
| `startCall()` / `endCall()` / `toggleMute()` | actions |
| `sendText(text)` | inject text without using mic |
| `sendJSON(obj)` | app-level message channel |

## Try it locally

```sh
bun install
bun run dev
# open http://localhost:8787/chat
```

You'll need a Workers AI account for the STT/TTS models to resolve.
For local CDP-only testing without Workers AI, swap in a third-party
provider (Deepgram, ElevenLabs) from
`@cloudflare/voice-deepgram` / `@cloudflare/voice-elevenlabs`.

## Stop using mic

For dictation-only (one-way STT, no responses), swap `withVoice` for
`withVoiceInput` and use `useVoiceInput` instead — same wiring, no
`onTurn`. Not covered by this example.

## See also

- [`src/runtime/voiceClient.tsx`](../../src/runtime/voiceClient.tsx) — the framework's
  `AyjntVoiceTransport` + typed hook wrapper.
- [Cloudflare Agents — Voice docs](https://developers.cloudflare.com/agents/api-reference/voice/).
- [@cloudflare/voice on npm](https://www.npmjs.com/package/@cloudflare/voice).
