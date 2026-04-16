// Demo: index a tiny knowledge base, ask it a question, observe how the
// QA agent decomposed it and what evidence it pulled. Run `bun run dev`
// in another terminal first; ensure CF_ACCOUNT_ID and CF_API_TOKEN are
// set in .dev.vars (or as wrangler secrets if running against deploy).

const host = process.env.HOST ?? "http://localhost:8787";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(host + path, init);
  return res.json() as Promise<T>;
}

const KNOWLEDGE = [
  "Cloudflare Workers run V8 isolates, not containers — cold starts are typically under 5ms.",
  "Durable Objects provide single-instance, strongly consistent stateful objects on the edge. Each instance handles requests serially.",
  "Workers AI lets you run models on Cloudflare's GPU fleet via the @cf/* model namespace.",
  "Vectorize is Cloudflare's managed vector database, designed for embedding storage and similarity search at scale.",
  "Wrangler is the official CLI for deploying Workers and managing Cloudflare developer-platform resources.",
  "ayjnt is a Cloudflare-Workers-native framework where each folder under agents/ becomes one Durable Object class.",
  "An ayjnt agent's URL is derived from its folder path. agents/chat/agent.ts is reachable at /chat/<instance-id>.",
  "ayjnt middleware files run root-to-leaf for every request, similar to Hono. Nested middleware.ts compose by file proximity.",
];

console.log("clearing index + qa state…");
await fetchJson("/index/main", { method: "DELETE" });
await fetchJson("/qa/session-1", { method: "DELETE" });

console.log("\nindexing knowledge base (will block on embeddings)…");
const indexed = await fetchJson<{ indexed: number }>("/index/main", {
  method: "POST",
  body: JSON.stringify({ docs: KNOWLEDGE }),
});
console.log(`  ${indexed.indexed} docs embedded`);

const question = "What is ayjnt and how does it relate to Durable Objects?";
console.log(`\nasking: ${question}`);

const answer = await fetchJson<{
  ok: boolean;
  qa?: {
    plan: string[];
    hits: { sub: string; docs: { text: string; score: number }[] }[];
    answer: string;
  };
  error?: string;
}>("/qa/session-1", {
  method: "POST",
  body: JSON.stringify({ question }),
});

if (!answer.ok || !answer.qa) {
  console.error("error:", answer.error);
  process.exit(1);
}

console.log("\nplan:");
for (const sub of answer.qa.plan) console.log(`  - ${sub}`);

console.log("\nretrieved (top 3 per subquery):");
for (const h of answer.qa.hits) {
  console.log(`  for "${h.sub}":`);
  for (const d of h.docs) {
    console.log(`    [${d.score.toFixed(3)}] ${d.text.slice(0, 80)}`);
  }
}

console.log("\nanswer:");
console.log(answer.qa.answer);
