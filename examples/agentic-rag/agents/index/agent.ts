import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";
import { runWorkersAi } from "../shared.ts";

type Doc = {
  id: string;
  text: string;
  embedding: number[];
};

type State = {
  docs: Doc[];
};

/** Each /index/<corpus> is its own toy vector store; /policies and /recipes
 *  are independent corpora. Real production: swap to Cloudflare Vectorize.
 *  Embeddings come from Workers AI bge-base-en (768-dim). */
export default class IndexAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { docs: [] };

  /** RPC: embed and store a document. */
  async addDoc(text: string): Promise<{ id: string }> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty text");
    const embedding = await this.embed(trimmed);
    const id = crypto.randomUUID();
    this.setState({
      docs: [...this.state.docs, { id, text: trimmed, embedding }],
    });
    return { id };
  }

  /** RPC: cosine-similarity search. Returns the top-k docs. */
  async search(
    query: string,
    k: number = 3,
  ): Promise<{ id: string; text: string; score: number }[]> {
    if (this.state.docs.length === 0) return [];
    const q = await this.embed(query);
    const scored = this.state.docs.map((d) => ({
      id: d.id,
      text: d.text,
      score: cosine(q, d.embedding),
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Wipe the corpus. Useful for re-indexing during demos. */
  async clear(): Promise<void> {
    this.setState({ docs: [] });
  }

  private async embed(text: string): Promise<number[]> {
    const result = (await runWorkersAi(this.env, "@cf/baai/bge-base-en-v1.5", {
      text: [text],
    })) as { data: number[][] };
    return result.data[0]!;
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      await this.clear();
      return Response.json({ ok: true, cleared: true });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as { docs: string[] };
      const ids: string[] = [];
      for (const text of body.docs) {
        const { id } = await this.addDoc(text);
        ids.push(id);
      }
      return Response.json({ ok: true, indexed: ids.length, ids });
    }

    return Response.json({
      instance: this.name,
      count: this.state.docs.length,
      docs: this.state.docs.map((d) => ({
        id: d.id,
        preview: d.text.slice(0, 80),
      })),
    });
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
