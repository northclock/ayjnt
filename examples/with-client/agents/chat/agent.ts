import { Agent } from "agents";

type Env = Record<string, never>;

type Message = { role: "user" | "assistant"; text: string };
type ChatState = { messages: Message[] };

/**
 * Demonstrates the server side of the client-SDK integration.
 *
 * The client connects via `basePath: "chat/<instanceId>"` (see ../client.ts).
 * Our generated worker entrypoint dispatches to this class via
 * `getAgentByName`, which sets `this.name` on the DO so the identity message
 * broadcast on connect carries the correct instance name.
 */
export default class ChatAgent extends Agent<Env, ChatState> {
  override initialState: ChatState = { messages: [] };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const { text } = (await request.json()) as { text: string };
      this.setState({
        messages: [...this.state.messages, { role: "user", text }],
      });
      return Response.json({ ok: true, name: this.name });
    }
    return Response.json({ ...this.state, name: this.name });
  }
}
