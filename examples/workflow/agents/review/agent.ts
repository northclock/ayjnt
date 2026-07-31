import { Agent, callable } from "ayjnt";
import type { ReviewWorkflowResult } from "./workflow.ts";

export type ReviewItem = {
  id: string;
  topic: string;
  sourceUrl: string;
  status: "preparing" | "awaiting-approval" | "approved" | "rejected";
  draft?: string;
  checks?: string[];
  workflowId?: string;
  createdAt: number;
  decidedAt?: number;
};
type State = { items: ReviewItem[] };

export default class ReviewAgent extends Agent<State> {
  override initialState: State = { items: [] };

  @callable()
  async prepare(topic: string, sourceUrl: string): Promise<string> {
    const id = crypto.randomUUID();
    this.setState({
      items: [{
        id,
        topic: topic.trim(),
        sourceUrl: new URL(sourceUrl).toString(),
        status: "preparing",
        createdAt: Date.now(),
      }, ...this.state.items],
    });
    const workflowId = await this.workflow({ id, topic, sourceUrl });
    this.update(id, { workflowId });
    return id;
  }

  async draftReady(id: string, draft: string, checks: string[]): Promise<void> {
    this.update(id, { draft, checks, status: "awaiting-approval" });
  }

  override async onWorkflowComplete(
    _workflowName: string,
    _workflowId: string,
    result?: unknown,
  ): Promise<void> {
    const completed = result as ReviewWorkflowResult | undefined;
    if (!completed) return;
    await this.draftReady(completed.id, completed.draft, completed.checks);
  }

  @callable()
  async decide(id: string, decision: "approved" | "rejected"): Promise<void> {
    const item = this.state.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== "awaiting-approval") {
      throw new Error("This item is not awaiting a decision.");
    }
    this.update(id, { status: decision, decidedAt: Date.now() });
  }

  private update(id: string, patch: Partial<ReviewItem>) {
    this.setState({
      items: this.state.items.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    });
  }
}
