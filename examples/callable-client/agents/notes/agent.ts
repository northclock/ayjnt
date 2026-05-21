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
 * NotesAgent — demonstrates Cloudflare's `@callable()` decorator from
 * `"agents"`. The decorator does two jobs at once:
 *
 *   1. **Runtime registration.** The Agents SDK registers the method in
 *      its callable registry so the bundled UI can invoke it over
 *      WebSocket via `agent.stub.method(...)` or
 *      `agent.call("method", [...])`.
 *
 *   2. **Catalog inclusion.** ayjnt's `/__ayjnt/catalog` scanner picks
 *      up every `@callable()`-decorated method and lists it with the
 *      `description` from the decorator's options. No JSDoc tag needed.
 *
 * Long-form JSDoc above each method is developer-facing only — it
 * shows up on editor hover and stays out of the catalog. The
 * decorator's short `description` is the catalog's source of truth.
 *
 * The framework also recognises a legacy `/** @callable *\/` JSDoc tag
 * as a catalog-only marker for methods you want listed but NOT exposed
 * over WebSocket. We don't use it here because every method we want
 * advertised, we also want browser-callable.
 */
export default class NotesAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { notes: [] };

  /**
   * Add a note to the list. Returns the newly created note.
   *
   * The server generates the id — the client can't do that locally
   * with a guarantee of uniqueness, which is precisely the kind of
   * thing that justifies an RPC method instead of a state replacement.
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

  /** Delete a note by id. Returns true if the note existed. */
  @callable({ description: "Delete a note by id." })
  async deleteNote(id: string): Promise<boolean> {
    const before = this.state.notes.length;
    this.setState({
      notes: this.state.notes.filter((n) => n.id !== id),
    });
    return this.state.notes.length < before;
  }

  /** Clear every note in this instance. */
  @callable({ description: "Wipe every note." })
  async clearNotes(): Promise<void> {
    this.setState({ notes: [] });
  }

  /** Count the notes. Trivial, but useful for showing typed-return RPC. */
  @callable({ description: "Return the number of notes." })
  async countNotes(): Promise<number> {
    return this.state.notes.length;
  }

  /**
   * Internal helper — no decorator. NOT browser-callable and NOT in the
   * catalog. Still reachable from another agent via
   * `getAgent<NotesAgent>(env.NOTES_AGENT, "main")._findById(id)`, since
   * native DO RPC uses TypeScript's `public` access, not the decorator.
   * That's the third "callable" pattern — see the README for the full
   * three-way comparison.
   */
  async _findById(id: string): Promise<Note | undefined> {
    return this.state.notes.find((n) => n.id === id);
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
