import { Agent, callable } from "ayjnt";
import ResearcherAgent from "../researcher/agent.ts";
import ReviewerAgent from "../reviewer/agent.ts";
import type { Review } from "../reviewer/agent.ts";

type Stage = "queued" | "researching" | "reviewing" | "complete" | "failed";
type Run = {
  id: string;
  question: string;
  sources: string[];
  stage: Stage;
  log: Array<{ at: number; agent: string; message: string }>;
  brief?: string;
  error?: string;
};
type State = { runs: Run[] };

export default class LeadAgent extends Agent<State> {
  override initialState: State = { runs: [] };

  @callable()
  async start(question: string, sources: string[]): Promise<string> {
    const id = crypto.randomUUID();
    const run: Run = {
      id,
      question: question.trim(),
      sources: sources.map((source) => new URL(source.trim()).toString()),
      stage: "queued",
      log: [],
    };
    this.setState({ runs: [run, ...this.state.runs] });
    await this.execute(id);
    return id;
  }

  private async execute(id: string): Promise<void> {
    const run = this.find(id);
    try {
      this.patch(id, {
        stage: "researching",
        log: [...run.log, event("lead", `Delegated ${run.sources.length} source(s).`)],
      });
      const researcher = await this.agent(ResearcherAgent, id);
      const findings = await Promise.all(
        run.sources.map((source) => researcher.investigate(source)),
      );
      this.append(id, "researcher", `Returned ${findings.reduce((sum, finding) => sum + finding.facts.length, 0)} candidate facts.`);

      this.patch(id, { stage: "reviewing" });
      const reviewer = await this.agent(ReviewerAgent, id);
      const reviews = await Promise.all(findings.map((finding) => reviewer.review(finding)));
      this.append(id, "reviewer", `Accepted ${reviews.reduce((sum, review) => sum + review.accepted.length, 0)} attributed facts.`);

      this.patch(id, {
        stage: "complete",
        brief: synthesize(run.question, reviews),
      });
      this.append(id, "lead", "Synthesized the reviewed findings.");
    } catch (error) {
      this.patch(id, {
        stage: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private find(id: string) {
    const run = this.state.runs.find((candidate) => candidate.id === id);
    if (!run) throw new Error("Run not found.");
    return run;
  }
  private patch(id: string, patch: Partial<Run>) {
    this.setState({ runs: this.state.runs.map((run) => run.id === id ? { ...run, ...patch } : run) });
  }
  private append(id: string, agent: string, message: string) {
    const run = this.find(id);
    this.patch(id, { log: [...run.log, event(agent, message)] });
  }
}

function event(agent: string, message: string) {
  return { at: Date.now(), agent, message };
}

function synthesize(question: string, reviews: Review[]) {
  const facts = reviews.flatMap((review) =>
    review.accepted.map((fact) => `- ${fact} ([source](${review.source}))`)
  );
  const cautions = [...new Set(reviews.flatMap((review) => review.cautions))];
  return [`# ${question}`, "", ...facts, "", "## Caveats", ...cautions.map((item) => `- ${item}`)].join("\n");
}
