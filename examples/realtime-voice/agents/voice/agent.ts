import { Agent, callable } from "ayjnt";

type State = {
  sessions: number;
  turns: number;
  lastConnectedAt: number | null;
};

export default class VoiceAgent extends Agent<State> {
  override initialState: State = {
    sessions: 0,
    turns: 0,
    lastConnectedAt: null,
  };

  @callable()
  async connected(): Promise<void> {
    this.setState({
      ...this.state,
      sessions: this.state.sessions + 1,
      lastConnectedAt: Date.now(),
    });
  }

  @callable()
  async completedTurn(): Promise<void> {
    this.setState({ ...this.state, turns: this.state.turns + 1 });
  }
}
