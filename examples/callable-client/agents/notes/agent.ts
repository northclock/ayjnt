import { Agent, callable } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Note = {
  id: string;
  text: string;
  createdAt: number;
};

type State = {
  notes: Note[];
};

/**
 * NotesAgent — demonstrates client-callable methods.
 *
 * Two `@callable` patterns exist in this framework and they are NOT the
 * same thing:
 *
 *   1. **Cloudflare's `@callable()` decorator** (from `"agents"`).
 *      A real TypeScript 5 decorator that registers the method in the
 *      Agents SDK's runtime callable registry. The bundled UI calls these
 *      methods over WebSocket via `agent.stub.method(...)` or
 *      `agent.call("method", [...])`. This is what we use to expose
 *      methods to the browser.
 *
 *   2. **ayjnt's `/** @callable *\/` JSDoc tag** (parsed by scan.ts).
 *      A build-time metadata convention. Tagged methods are surfaced in
 *      the `/__ayjnt/catalog` JSON endpoint so other agents — and
 *      tooling — can discover the public RPC surface. Has no runtime
 *      effect on its own.
 *
 * The two are orthogonal. A method can have just the decorator (browser
 * RPC only, hidden from the catalog), just the JSDoc tag (catalog-only,
 * not callable from the browser), or BOTH (recommended for methods that
 * are part of the public surface AND meant to be called from the UI).
 *
 * We use both on each method below — see what `/__ayjnt/catalog` returns,
 * and watch `agent.stub.method()` work in the React UI at the same time.
 */
export default class NotesAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { notes: [] };

  /**
   * Add a note to the list. Returns the newly created note.
   * @callable
   */
  @callable({ description: "Add a new note to the list." })
  async addNote(text: string): Promise<Note> {
    const note: Note = {
      id: crypto.randomUUID(),
      text,
      createdAt: Date.now(),
    };
    this.setState({ notes: [...this.state.notes, note] });
    return note;
  }

  /**
   * Delete a note by id. Returns true if the note existed.
   * @callable
   */
  @callable({ description: "Delete a note by id." })
  async deleteNote(id: string): Promise<boolean> {
    const before = this.state.notes.length;
    this.setState({
      notes: this.state.notes.filter((n) => n.id !== id),
    });
    return this.state.notes.length < before;
  }

  /**
   * Clear every note in this instance.
   * @callable
   */
  @callable({ description: "Wipe every note." })
  async clearNotes(): Promise<void> {
    this.setState({ notes: [] });
  }

  /**
   * Count the notes. Trivial, but useful for showing typed-return RPC.
   * @callable
   */
  @callable({ description: "Return the number of notes." })
  async countNotes(): Promise<number> {
    return this.state.notes.length;
  }

  /**
   * Internal helper — has NEITHER the decorator nor the JSDoc tag, so
   * it's not callable from the browser AND doesn't appear in the catalog.
   * Other agents can still invoke it via `getAgent<NotesAgent>` over
   * native DO RPC (TypeScript's `public` access is enough for that —
   * decorators only matter for client/host-to-agent calls).
   */
  async _findById(id: string): Promise<Note | undefined> {
    return this.state.notes.find((n) => n.id === id);
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
