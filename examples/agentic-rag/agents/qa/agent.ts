import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type { GeneratedEnv } from "@ayjnt/env";
import type IndexAgent from "../index/agent.ts";
import { runWorkersAi } from "../shared.ts";

type QA = {
  id: string;
  question: string;
  /** Subqueries the planner derived from the question. */
  plan: string[];
  /** Per-subquery retrieval hits, in order. */
  hits: { sub: string; docs: { text: string; score: number }[] }[];
  /** Final composed answer. */
  answer: string;
  at: number;
};

type State = {
  history: QA[];
  pending: boolean;
};

const PLANNER_PROMPT =
  "Decompose the user question into 2-3 short search queries that, taken " +
  "together, retrieve the evidence needed to answer it. Return ONLY a " +
  "JSON array of strings (no prose, no markdown fences).";

const COMPOSER_PROMPT =
  "Answer the user's question using ONLY the provided context. " +
  "Be concise (max 4 sentences). If the context is insufficient, " +
  "say so explicitly — do not invent facts.";

/**
 * QA agent — orchestrates a tiny RAG pipeline:
 *
 *   plan(question)        → 2-3 subqueries           [llama-3.1-8b]
 *   retrieve(subqueries)  → top-3 docs each           [IndexAgent RPC]
 *   compose(q, evidence)  → final grounded answer     [llama-3.1-8b]
 *
 * "Agentic" only in the loosest sense — the model picks the subqueries
 * but there's no iteration on retrieval quality. Easy to extend with
 * reflection / re-planning if first retrieval is weak (model judges,
 * decides whether to ask differently, etc.).
 */
export default class QAAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { history: [], pending: false };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      this.setState({ history: [], pending: false });
      return Response.json({ ok: true, cleared: true });
    }

    if (request.method !== "POST") {
      return Response.json({ instance: this.name, ...this.state });
    }

    const { question } = (await request.json()) as { question: string };
    if (!question?.trim()) {
      return Response.json({ ok: false, error: "empty question" }, { status: 400 });
    }

    this.setState({ ...this.state, pending: true });

    try {
      const result = await this.answer(question);
      this.setState({
        history: [...this.state.history, result],
        pending: false,
      });
      return Response.json({ ok: true, qa: result });
    } catch (err) {
      this.setState({ ...this.state, pending: false });
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  /** Run the plan → retrieve → compose loop. */
  private async answer(question: string): Promise<QA> {
    const plan = await this.plan(question);

    // Single corpus for the demo. A real app would shard by tenant/domain.
    const index = await getAgent<IndexAgent>(this.env.INDEX_AGENT, "main");
    const hits = await Promise.all(
      plan.map(async (sub) => ({
        sub,
        docs: (await index.search(sub, 3)).map((d) => ({
          text: d.text,
          score: d.score,
        })),
      })),
    );

    // Deduplicate evidence — same doc may rank on multiple subqueries.
    const evidence = hits
      .flatMap((h) => h.docs.map((d) => d.text))
      .filter((text, i, arr) => arr.indexOf(text) === i)
      .join("\n\n---\n\n");

    const answer = await this.compose(question, evidence);

    return {
      id: crypto.randomUUID(),
      question,
      plan,
      hits,
      answer,
      at: Date.now(),
    };
  }

  /** Decompose the question via llama. */
  private async plan(question: string): Promise<string[]> {
    const result = (await runWorkersAi(
      this.env,
      "@cf/meta/llama-3.1-8b-instruct",
      {
        messages: [
          { role: "system", content: PLANNER_PROMPT },
          { role: "user", content: question },
        ],
      },
    )) as { response: string };

    // Robust JSON extraction — the model sometimes wraps in ```json fences.
    const match = result.response.match(/\[[^\]]*\]/);
    if (!match) return [question];
    try {
      const parsed = JSON.parse(match[0]);
      if (
        Array.isArray(parsed) &&
        parsed.every((s) => typeof s === "string")
      ) {
        return parsed.slice(0, 3);
      }
    } catch {
      // Fall through to default below.
    }
    return [question];
  }

  /** Compose the final answer given retrieved evidence. */
  private async compose(question: string, evidence: string): Promise<string> {
    const result = (await runWorkersAi(
      this.env,
      "@cf/meta/llama-3.1-8b-instruct",
      {
        messages: [
          { role: "system", content: COMPOSER_PROMPT },
          {
            role: "user",
            content: `CONTEXT:\n${evidence}\n\nQUESTION:\n${question}`,
          },
        ],
      },
    )) as { response: string };
    return result.response.trim();
  }
}
