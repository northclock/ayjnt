# ayjnt example: ai-chatbot

A streaming chatbot backed by Google Gemini. The Durable Object holds the conversation; the React UI subscribes to state and renders incrementally as `setState` ticks every chunk. No SSE plumbing in the client — the realtime feel comes from state-sync.

```
agents/
  chat/
    agent.ts   ← Gemini stream → setState chunk by chunk
    app.tsx    ← React UI: bubbles + caret + auto-scroll
.dev.vars      ← GOOGLE_API_KEY=...   (gitignored)
```

## Scaffold

```sh
bunx ayjnt new my-chatbot
cd my-chatbot
rm -rf agents/counter
mkdir -p agents/chat
# copy agents/chat/agent.ts and app.tsx from this example
bun install
```

## API key

Get a Gemini key at <https://aistudio.google.com/app/apikey> and write it into `.dev.vars`:

```sh
echo 'GOOGLE_API_KEY=ya29.…' > .dev.vars
```

`.dev.vars` is gitignored and gets injected as `c.env.GOOGLE_API_KEY` for `wrangler dev`. Without a key the example falls back to a slow stub reply so you can verify the UI works in isolation.

For deploys: `wrangler secret put GOOGLE_API_KEY`.

## Run

```sh
bun run dev
open http://localhost:8787/chat/demo
```

Type "tell me a haiku about Cloudflare workers" → the assistant message bubble fills in word by word, with a blinking caret, and the input box is disabled until streaming completes.

## How streaming works without SSE in the client

The agent receives the user message, appends an empty assistant message, and starts streaming Gemini's response in the background via `ctx.waitUntil()`. Every Gemini SSE chunk triggers a `setState` that mutates the in-flight assistant message text. The Agents SDK ships state diffs over the open WebSocket to every connected client, so the UI re-renders with the longer text on each beat.

```
client.send "haiku"
       │
       ▼
  POST /chat/demo  (returns 200 immediately)
       │
       ▼
  agent.setState({ messages: [...prev, { user }, { assistant: "" }] })
       │
       ▼
  ctx.waitUntil(stream Gemini → setState({ text: prev + chunk }) per chunk)
       │
       ▼
  every setState ⇒ CF_AGENT_STATE frame ⇒ React re-renders
```

Two consequences:

- **The HTTP response is fire-and-forget.** The client doesn't read a body. State sync is the result.
- **Multiple tabs see the stream live.** Open the same `/chat/demo` URL in two browser tabs — both see tokens land in real time.

## Pitfalls

- **`ctx.waitUntil`** is mandatory — without it the worker invocation ends after the response and the streaming generator is killed mid-flight.
- **Gemini SSE chunks split JSON across boundaries.** The line-buffer pattern (`buffer.split("\n")` + keep the last partial in the buffer) handles this. Don't `JSON.parse(rawChunk)` and assume it's a complete object.
- **`setState` on every token is fine in dev** but at higher message rates you may want to batch. Gemini-flash chunks at maybe 30 tokens/sec — well under the SDK's effective rate.
- **History grows unbounded.** This example doesn't cap message count or compress old turns. For real use you'd summarise older context to fit Gemini's window.

## Deploy

```sh
wrangler secret put GOOGLE_API_KEY        # one-time
bun run deploy
# https://my-chatbot.<account>.workers.dev/chat/<any-id>
```

Each `/chat/<id>` is an independent Durable Object with its own conversation. Use the id as a session/user identifier.

## See also

- [`examples/with-ui`](../with-ui) for the co-located UI primitive this example builds on
- [`examples/agentic-rag`](../agentic-rag) for adding retrieval to chatbot answers
- [Gemini API streaming docs](https://ai.google.dev/gemini-api/docs/text-generation#stream-generated-text)
