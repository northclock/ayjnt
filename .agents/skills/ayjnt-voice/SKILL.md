---
name: ayjnt-voice
description: Build streaming voice interaction in an Ayjnt harness. Use for voice agents, STT, TTS, Workers AI voice, `withVoice(Agent)`, or audio-reactive browser interfaces. Covers the current transcriber, TTS, and `onTurn` API plus Ayjnt's route-aware voice hook; use the realtime Gemini example when the browser should own a direct native-audio session.
---

# Build a voice agent

`withVoice(Agent)` is the trigger. The mixin adds the streaming
WebSocket transport, the STT/TTS pipeline, and an `onTurn`
lifecycle hook. Ayjnt's scanner sees `withVoice(` in the source and
generates a client hook wired to ayjnt's URL shape.

## File shape

```ts
// agents/<route>/agent.ts
import { Agent } from "ayjnt";
import {
  withVoice,
  WorkersAIFluxSTT,
  WorkersAITTS,
} from "@cloudflare/voice";

type State = {
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
};

export default class ChatAgent extends withVoice(Agent)<State> {
  override initialState: State = { transcript: [] };

  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);

  // Called once the transcriber detects a complete turn.
  async onTurn(text: string): Promise<string> {
    this.setState({
      transcript: [...this.state.transcript, { role: "user", text }],
    });

    const reply = await this.respondTo(text);

    this.setState({
      transcript: [...this.state.transcript, { role: "assistant", text: reply }],
    });

    return reply; // ← TTS'd back to the client.
  }

  private async respondTo(text: string): Promise<string> {
    // your LLM call here
    return `I heard you say: ${text}`;
  }
}
```

### Rules

- **`extends withVoice(Agent)<…>`** — the mixin call must appear
  verbatim in the source. Aliased imports (`import { withVoice as wv }`)
  aren't detected.
- **`transcriber` and `tts`** are required provider fields unless
  their factory methods are overridden.
- **`onTurn(text, context)`** is the central hook. Its text or text
  stream is synthesized and returned as audio.

## What ayjnt wires up

- Adds an `ai` binding to `wrangler.jsonc` (idempotent — shared with
  the browser-tools feature if both are present).
- Adds `AI: Ai` to the ambient `Ayjnt.GeneratedEnv`.
- Generates a typed `useVoiceAgent` hook in
  `@ayjnt/<agentId>` instead of the normal `useAgent`. The hook calls
  `useAyjntVoiceAgent` from `ayjnt/voice/client`, passing the right
  agent id and route path.

```ts
// .ayjnt/dist/@ayjnt/chat/index.ts (auto-generated)
import { useAyjntVoiceAgent } from "ayjnt/voice/client";

export function useVoiceAgent(opts?: {
  name?: string;
  host?: string;
  enabled?: boolean;
  onReconnect?: () => void;
}) {
  return useAyjntVoiceAgent({
    agent: "chat",
    routePath: "/chat",  // ← ayjnt's URL shape, not /agents/chat-agent/...
    ...opts,
  });
}
```

## Using the hook in your UI

```tsx
// agents/<route>/app.tsx
import { useVoiceAgent } from "@ayjnt/chat";

export default function VoiceUI() {
  const voice = useVoiceAgent({ name: "demo" });

  return (
    <div>
      <button onClick={voice.connected ? voice.stop : voice.start}>
        {voice.connected ? "Stop" : "Talk"}
      </button>
      <p>
        {voice.listening ? "Listening…" :
         voice.speaking ? "Speaking…" : "Idle"}
      </p>
    </div>
  );
}
```

The hook exposes `connected`, `listening`, `speaking`, `error`, and
`start()` / `stop()`. Driving the UI off these props is enough for a
working push-to-talk experience.

## STT and TTS providers

The mixin doesn't pick STT or TTS — the provider fields on the agent
do. The most useful providers from `@cloudflare/voice`:

- `WorkersAIFluxSTT` — streaming STT via Workers AI's Whisper.
- `WorkersAITTS` — Workers AI's TTS endpoint, streams audio frames.

Custom providers: implement the `STTProvider` / `TTSProvider`
interfaces from `@cloudflare/voice` to wire OpenAI, Deepgram,
ElevenLabs, etc.

## Why a custom transport

Upstream `WebSocketVoiceTransport` (from `@cloudflare/voice`) is
backed by PartySocket with `prefix: "agents"` — its URL shape is
`/agents/<kebab>/<name>`. ayjnt's URL shape is
`/<route>/<instance>`. The framework's generated hook uses
`AyjntVoiceTransport` (a raw-WebSocket impl in
`src/runtime/voiceClient.tsx`) that connects to the right URL while
preserving the upstream message protocol.

## Packages

```sh
bun add @cloudflare/voice
```

`agents`, `react`, and Ayjnt's generated environment come from the
framework scaffolding.

## Reference

- [`examples/realtime-voice`](../../../examples/realtime-voice) — a
  Gemini Live voice-to-voice harness with an audio-reactive UI.
- [`src/runtime/voiceClient.tsx`](../../../src/runtime/voiceClient.tsx) —
  `AyjntVoiceTransport` + `useAyjntVoiceAgent`.
- [Cloudflare Voice Agents docs](https://developers.cloudflare.com/agents/api-reference/voice/).
