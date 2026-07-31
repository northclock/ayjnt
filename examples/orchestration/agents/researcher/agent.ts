import { Agent } from "ayjnt";

export type Finding = {
  source: string;
  title: string;
  facts: string[];
  fetchedAt: number;
};
type State = { completed: number };

export default class ResearcherAgent extends Agent<State> {
  override initialState: State = { completed: 0 };

  async investigate(url: string): Promise<Finding> {
    const parsed = new URL(url);
    const response = await fetch(parsed, {
      headers: { "user-agent": "ayjnt-orchestration-example/1.0" },
    });
    if (!response.ok) throw new Error(`${parsed.hostname} returned ${response.status}`);
    const html = await response.text();
    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim() ?? parsed.hostname;
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    const facts = text
      .split(/[.!?]\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 45 && sentence.length <= 240)
      .slice(0, 8);
    this.setState({ completed: this.state.completed + 1 });
    return { source: parsed.toString(), title, facts, fetchedAt: Date.now() };
  }
}
