import { AgentWorkflow } from "ayjnt/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "ayjnt/workflows";

type Params = { id: string; topic: string; sourceUrl: string };
export type ReviewWorkflowResult = {
  id: string;
  draft: string;
  checks: string[];
};

export default class ReviewWorkflow extends AgentWorkflow<Params> {
  override async run(
    event: Readonly<AgentWorkflowEvent<Params>>,
    step: AgentWorkflowStep,
  ): Promise<{ awaitingApproval: boolean }> {
    const { id, topic, sourceUrl } = event.payload;

    const source = await step.do("fetch-source", async () => {
      const response = await fetch(sourceUrl, {
        headers: { "user-agent": "ayjnt-workflow-example/1.0" },
      });
      if (!response.ok) throw new Error(`Source returned ${response.status}`);
      return (await response.text()).replace(/\s+/g, " ").slice(0, 5_000);
    });

    const research = await step.do("extract-research", async () => ({
      topic,
      excerpt: stripMarkup(source).slice(0, 700),
      sourceUrl,
    }));

    const draft = await step.do("draft-update", async () =>
      [
        `# ${research.topic}`,
        "",
        research.excerpt,
        "",
        `Source: ${research.sourceUrl}`,
      ].join("\n")
    );

    const checks = await step.do("policy-check", async () => {
      const results = [
        draft.length < 1_500 ? "Length is within the review limit." : "Draft is too long.",
        draft.includes(sourceUrl) ? "Source attribution is present." : "Source attribution is missing.",
        !/password|secret key/i.test(draft) ? "No obvious credential language found." : "Possible credential language found.",
      ];
      if (results.some((result) => result.includes("missing") || result.includes("too long"))) {
        throw new Error(results.join(" "));
      }
      return results;
    });

    await step.reportComplete<ReviewWorkflowResult>({ id, draft, checks });
    return { awaitingApproval: true };
  }
}

function stripMarkup(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
