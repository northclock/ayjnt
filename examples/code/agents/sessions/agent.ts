import { Agent } from "ayjnt";

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
};

type State = { sessions: SessionSummary[] };

export default class SessionsAgent extends Agent<State> {
  override initialState: State = { sessions: [] };

  async upsert(session: SessionSummary): Promise<void> {
    const sessions = [
      session,
      ...this.state.sessions.filter((item) => item.id !== session.id),
    ]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100);
    this.setState({ sessions });
  }
}
