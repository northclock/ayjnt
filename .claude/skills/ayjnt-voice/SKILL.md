---
name: ayjnt-voice
description: Build a voice agent — streaming speech-to-text + text-to-speech over WebSocket via @cloudflare/voice. Use when the user asks to "make the agent talk", "add voice", "build a voice assistant", "use Workers AI for voice", or "add STT/TTS". Wraps the agent class in `withVoice(Agent)`, plugs in Workers AI STT + TTS providers, and generates a typed `useVoiceAgent` hook that respects ayjnt's URL shape (not the upstream PartySocket prefix).
---

# Build a voice agent

`withVoice(Agent)` is the trigger. The mixin adds the streaming
WebSocket transport, the STT/TTS pipeline, and an `onTranscript`
lifecycle hook. ayjnt's scanner sees `withVoice(` in the source and
generates a client hook wired to ayjnt's URL shape.

## File shape

```ts
// agents/<route>/agent.ts
import { Agent } from "agents";
import { withVoice } from "@cloudflare/voice";
import { WorkersAIFluxSTT, WorkersAITTS } from "@cloudflare/voice/providers";
import type { GeneratedEnv } from "@ayjnt/env";

type State = {
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
};

export default class ChatAgent extends withVoice(Agent)<GeneratedEnv, State> {
  override initialState: State = { transcript: [] };

  // Required by withVoice: provide STT + TTS instances.
  voice = {
    stt: new WorkersAIFluxSTT({ binding: this.env.AI }),
    tts: new WorkersAITTS({ binding: this.env.AI }),
  };

  // Called once a full utterance is recognized.
  async onTranscript(text: string): Promise<string> {
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
- **`voice = { stt, tts }`** is a required instance field. The mixin
  reads it on init.
- **`onTranscript(text)`** is the central hook. Whatever string it
  returns gets sent to the TTS engine and streamed back as audio.
  Return `undefined` to skip the TTS pass.

## What ayjnt wires up

- Adds an `ai` binding to `wrangler.jsonc` (idempotent — shared with
  the browser-tools feature if both are present).
- Adds `AI: Ai` to `GeneratedEnv`.
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

The mixin doesn't pick STT or TTS — the `voice` field on the agent
does. The most useful providers from
`@cloudflare/voice/providers`:

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

`agents`, `react`, and `@ayjnt/env` come from the framework
scaffolding.

## Reference

- [`examples/voice-agent`](../../../examples/voice-agent) — ChatAgent
  with Workers AI STT + TTS and the UI from this skill.
- [`src/runtime/voiceClient.tsx`](../../../src/runtime/voiceClient.tsx) —
  `AyjntVoiceTransport` + `useAyjntVoiceAgent`.
- [Cloudflare Voice Agents docs](https://developers.cloudflare.com/agents/api-reference/voice/).
