# Realtime voice harness

A voice-to-voice interface backed by Gemini Live. The center sphere moves with
audio output and turns green while Gemini is listening.

```sh
bun install
bun run dev
```

Open `/voice/demo`, paste a Gemini API key, and start talking. The key is kept
in browser memory and used for a direct low-latency WebSocket session. That is
appropriate for this local example. A deployed client should ask its backend
for a short-lived Gemini ephemeral token instead of receiving a long-lived API
key.

Audio input is 16-bit PCM at 16kHz; Gemini native audio output is played at
24kHz. The Ayjnt agent keeps durable session counters while the browser owns the
ephemeral realtime media connection.
