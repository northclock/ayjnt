import { Agent } from "agents";

type Env = Record<string, never>;

type ChatState = {
  messages: { role: "user" | "assistant"; text: string }[];
};

/** Minimal chat agent — proves the framework end-to-end. */
export default class ChatAgent extends Agent<Env, ChatState> {
  override initialState: ChatState = { messages: [] };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const { text } = (await request.json()) as { text: string };
      this.setState({
        messages: [...this.state.messages, { role: "user", text }],
      });
      return Response.json({ ok: true, count: this.state.messages.length });
    }
    return Response.json(this.state);
  }
}
