# ayjnt example: basic

One agent, no UI. Proves the end-to-end build pipeline.

```
agents/
  chat/
    agent.ts   ← export default class ChatAgent extends Agent
```

Setup:

```sh
bun install
```

Build + inspect generated config:

```sh
bun run build
cat .ayjnt/dist/wrangler.jsonc
cat .ayjnt/dist/entry.ts
```

Run locally (needs Cloudflare account via `wrangler login`):

```sh
bun run dev
# POST to http://localhost:8787/chat/<any-instance-id>
```

Deploy:

```sh
bun run deploy
```
