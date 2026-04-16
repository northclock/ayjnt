# ayjnt example: agentic-rag

A two-agent retrieval pipeline. The QA agent decomposes a question into 2-3 subqueries, fans out retrievals to the Index agent over typed RPC, then composes a grounded answer. Both LLM steps run on Cloudflare Workers AI; embeddings are stored in DO state (replace with [Vectorize](https://developers.cloudflare.com/vectorize/) at scale).

```
agents/
  index/
    agent.ts    ← bge-base-en embeddings, in-memory cosine search
  qa/
    agent.ts    ← plan(llama) → retrieve(rpc) → compose(llama)
  shared.ts     ← Workers AI HTTP helper (no AI binding needed)
client.ts       ← demo: index → ask → see plan/evidence/answer
```

## Scaffold

```sh
bunx ayjnt new my-rag
cd my-rag
rm -rf agents/chat
mkdir -p agents/index agents/qa
# copy agents/index/agent.ts, agents/qa/agent.ts, agents/shared.ts from this example
bun install
```

## API token

This example calls Workers AI through its public REST API (because ayjnt's wrangler.jsonc generation doesn't yet add custom bindings — planned for a later rev). Two env vars:

```sh
# .dev.vars
CF_ACCOUNT_ID=…       # dash.cloudflare.com sidebar bottom-left
CF_API_TOKEN=…        # dash.cloudflare.com/profile/api-tokens — needs "Workers AI: Read"
```

For deploy: `wrangler secret put CF_ACCOUNT_ID && wrangler secret put CF_API_TOKEN`.

## Run

```sh
bun run dev               # terminal 1
bun run client            # terminal 2
```

Expected client output (truncated):

```
clearing index + qa state…
indexing knowledge base (will block on embeddings)…
  8 docs embedded

asking: What is ayjnt and how does it relate to Durable Objects?

plan:
  - what is ayjnt
  - how does ayjnt use durable objects
  - durable objects in cloudflare workers

retrieved (top 3 per subquery):
  for "what is ayjnt":
    [0.872] ayjnt is a Cloudflare-Workers-native framework where each folder under agents/ becomes one D
    [0.671] An ayjnt agent's URL is derived from its folder path. agents/chat/agent.ts is reachable at /
    [0.542] ayjnt middleware files run root-to-leaf for every request, similar to Hono. Nested middlew
  for "how does ayjnt use durable objects":
    [0.798] ayjnt is a Cloudflare-Workers-native framework where each folder under agents/ becomes one D
    [0.633] Durable Objects provide single-instance, strongly consistent stateful objects on the edge.
    …

answer:
ayjnt is a framework for Cloudflare Workers where each folder under
agents/ becomes a Durable Object class. The framework auto-generates
the worker entry point and wrangler config from the file tree. Each
DO is a single-instance, strongly consistent stateful object running
on the edge.
```

## How the multi-agent pattern works

`getAgent<IndexAgent>(this.env.INDEX_AGENT, "main")` returns a typed DO stub. `INDEX_AGENT` is a binding ayjnt generates automatically from the `agents/index/` folder. Method calls on the stub are real Workers RPC — typed end-to-end, with exceptions propagating across the boundary.

```
Client
  │  POST /qa/session-1 { question }
  ▼
QAAgent (DO #1)
  │  llama → plan
  ├─ getAgent<IndexAgent>(env.INDEX_AGENT, "main").search(sub-1)  ─┐
  ├─ getAgent<IndexAgent>(env.INDEX_AGENT, "main").search(sub-2)  ├─→ IndexAgent (DO #2)
  └─ getAgent<IndexAgent>(env.INDEX_AGENT, "main").search(sub-3)  ─┘    (cosine on stored embeddings)
  │  llama → compose(question, evidence)
  ▼
{ plan, hits, answer }
```

The plan and intermediate hits get stored in QA agent state so the UI / debugger can replay the trace.

## Pitfalls

- **In-memory vector store doesn't scale.** A few hundred docs is fine; thousands isn't. Swap `IndexAgent` to call Vectorize (binding) once ayjnt supports custom bindings, or do it through the REST API today.
- **Llama JSON output isn't always valid.** The planner uses a tolerant regex (`/\[[^\]]*\]/`) to extract the array. If parsing fails, it falls back to using the raw question. Real systems would constrain output via grammar / schema-guided decoding.
- **No retrieval reflection.** First retrieval is final. Easy extension: add a "judge" step that re-plans if the top score is below a threshold.

## Deploy

```sh
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
bun run deploy
# POST https://my-rag.<account>.workers.dev/index/main { docs: [...] }
# POST https://my-rag.<account>.workers.dev/qa/session-1 { question: "..." }
```

## See also

- [`examples/inter-agent`](../inter-agent) — typed RPC pattern this example builds on
- [`examples/ai-chatbot`](../ai-chatbot) — single-agent streaming LLM
- [Cloudflare Vectorize docs](https://developers.cloudflare.com/vectorize/)
