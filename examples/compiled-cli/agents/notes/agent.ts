import { Agent, callable } from "agents";
import { agentTools } from "ayjnt/tools";
import type { GeneratedEnv } from "@ayjnt/env";

export type Note = {
  id: string;
  text: string;
  source: string;
  createdAt: number;
};

type State = { notes: Note[] };

/**
 * NotesAgent — a plain Durable Object agent that also exposes a set of model
 * tools, some of which run in workerd and some on the Bun host.
 *
 * Nothing here knows about the split. `agentTools(this)` returns one merged
 * AI-SDK ToolSet: the exports from `tools.ts` run inside workerd, and the
 * exports from `tools.host.ts` are proxied out to the host process over the
 * framework's bridge. From the agent's point of view they're all just tools.
 */
export default class NotesAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { notes: [] };

  @callable({ description: "Add a note." })
  async addNote(text: string, source = "manual"): Promise<Note> {
    const note: Note = {
      id: crypto.randomUUID(),
      text,
      source,
      createdAt: Date.now(),
    };
    this.setState({ notes: [...this.state.notes, note] });
    return note;
  }

  @callable({ description: "List every note." })
  async listNotes(): Promise<Note[]> {
    return this.state.notes;
  }

  @callable({ description: "Delete every note." })
  async clearNotes(): Promise<number> {
    const n = this.state.notes.length;
    this.setState({ notes: [] });
    return n;
  }

  /**
   * The tool names this agent would hand a model right now.
   *
   * Worth calling from `cli.ts`, because the answer differs by how the app is
   * running: compiled or under `ayjnt run` you get the host tools too, whereas
   * deployed to Cloudflare you only get the workerd ones — there's no host
   * process out there to proxy to.
   */
  @callable({ description: "Names of the tools available to the model." })
  async toolNames(): Promise<string[]> {
    return Object.keys(agentTools(this)).sort();
  }

  /**
   * Invoke one tool directly, the way the AI SDK would during a tool call.
   *
   * A real agent would pass `agentTools(this)` to `generateText({ tools })` and
   * let the model choose. This example drives them by hand so the mechanics are
   * visible without needing a model or an API key.
   *
   * Note that failures are RETURNED, not thrown. Two reasons, and both apply to
   * real agents:
   *
   *   1. A tool call that fails is normal traffic — a model passes a bad path, a
   *      command exits non-zero, a policy refuses a `write` tool. The model can
   *      usually recover if you hand it the message.
   *   2. Exceptions thrown by an agent method lose their message when the call
   *      came from `cli.ts`, because of a limitation in the local runtime's
   *      Durable Object proxy. Returning a result keeps the reason intact.
   */
  @callable({ description: "Run one tool by name." })
  async runTool(
    name: string,
    input: unknown,
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const tools = agentTools(this) as Record<
      string,
      { execute?: (input: unknown, opts: unknown) => Promise<unknown> }
    >;
    const tool = tools[name];
    if (!tool?.execute) {
      return {
        ok: false,
        error: `no tool "${name}". Available: ${Object.keys(tools).sort().join(", ")}`,
      };
    }
    try {
      const result = await tool.execute(input, {
        toolCallId: name,
        messages: [],
      });
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  override async onRequest(): Promise<Response> {
    return Response.json({
      notes: this.state.notes.length,
      tools: Object.keys(agentTools(this)).sort(),
    });
  }
}
