# ChatAgent

Minimal chat agent demonstrating the framework end-to-end. Each
`/chat/<instance-id>` URL is a separate Durable Object — open
`/chat/room-1` and `/chat/room-2` and you'll see independent message
buffers.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET`  | `/chat/<instance>` | Return `{ messages: [...] }` for the current instance. |
| `POST` | `/chat/<instance>` | Append `{ "text": "..." }` to the message buffer. |

## Example

```sh
curl -X POST http://localhost:8787/chat/lobby \
  -H 'content-type: application/json' \
  -d '{"text":"hello"}'
# { "ok": true, "count": 1 }

curl http://localhost:8787/chat/lobby
# { "messages": [ { "role": "user", "text": "hello" } ] }
```

## State shape

```ts
type ChatState = {
  messages: { role: "user" | "assistant"; text: string }[];
};
```
