import { Agent } from "ayjnt";
import type { Finding } from "../researcher/agent.ts";

export type Review = {
  source: string;
  accepted: string[];
  cautions: string[];
};
type State = { reviewed: number };

export default class ReviewerAgent extends Agent<State> {
  override initialState: State = { reviewed: 0 };

  async review(finding: Finding): Promise<Review> {
    const accepted = finding.facts.filter(
      (fact) => !/\b(always|never|guaranteed|obviously)\b/i.test(fact),
    );
    const cautions = [
      ...(finding.facts.length === 0 ? ["No extractable prose was found."] : []),
      ...(accepted.length < finding.facts.length
        ? [`Removed ${finding.facts.length - accepted.length} absolute claim(s).`]
        : []),
      "Claims are attributed to one source and should be independently verified.",
    ];
    this.setState({ reviewed: this.state.reviewed + 1 });
    return { source: finding.source, accepted, cautions };
  }
}
