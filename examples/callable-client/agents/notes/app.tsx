import { useState } from "react";
import { useAgent } from "@ayjnt/notes";

/**
 * NotesApp — the client side of the @callable demo.
 *
 * The `useAgent<NotesAgent>()` hook returns an agent handle whose `stub`
 * property exposes every method the agent decorated with `@callable()`
 * — typed against the agent class. The arguments and return values
 * are statically checked end-to-end:
 *
 *   const note = await agent.stub.addNote("hello");
 *   //    ^? Note (inferred from the method's return type)
 *
 * Under the hood, `agent.stub.addNote("hello")` sends a WebSocket frame
 * to the agent, the agent dispatches to the decorated method, the
 * return value is JSON-serialised back, and the Promise resolves. The
 * agent's `setState({...})` broadcasts the new state to every connected
 * client — so a second tab sees the new note immediately, even though
 * it didn't make the call itself.
 *
 * Compare to `agent.setState({...})` (covered in examples/with-ui):
 * that's a state-replacement op the SDK round-trips for you. `@callable`
 * methods are for behaviour that can't be expressed as a pure state
 * replacement — e.g. "create with a generated id", "delete if exists",
 * "compute a derived value".
 */
export default function NotesApp() {
  // No generic needed — the hook is pre-bound to NotesAgent at codegen
  // time, so `agent.state` is typed as { notes: Note[] } and
  // `agent.stub.<method>` has full method autocomplete.
  const agent = useAgent();
  const notes = agent.state?.notes ?? [];

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      // Typed end-to-end. The return value is the Note the server created.
      const note = await agent.stub.addNote(text.trim());
      console.log("created", note);
      setText("");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const ok = await agent.stub.deleteNote(id);
    if (!ok) console.warn("note already gone:", id);
  };

  const clear = async () => {
    await agent.stub.clearNotes();
  };

  const count = async () => {
    const n = await agent.stub.countNotes();
    alert(`${n} note${n === 1 ? "" : "s"}`);
  };

  return (
    <main style={styles.main}>
      <header>
        <h1 style={styles.title}>Notes</h1>
        <p style={styles.meta}>
          instance: <code>{agent.name}</code> · open this URL in two tabs
          to see state sync
        </p>
      </header>

      <form onSubmit={submit} style={styles.form}>
        <input
          style={styles.input}
          placeholder="add a note…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button style={styles.btn} type="submit" disabled={busy || !text.trim()}>
          {busy ? "…" : "add"}
        </button>
      </form>

      <ul style={styles.list}>
        {notes.length === 0 ? (
          <li style={styles.empty}>no notes yet — add one</li>
        ) : (
          notes
            .slice()
            .reverse()
            .map((n) => (
              <li key={n.id} style={styles.note}>
                <span style={styles.text}>{n.text}</span>
                <span style={styles.timestamp}>
                  {new Date(n.createdAt).toLocaleTimeString()}
                </span>
                <button style={styles.delBtn} onClick={() => remove(n.id)}>
                  ×
                </button>
              </li>
            ))
        )}
      </ul>

      <footer style={styles.footer}>
        <button style={styles.ghostBtn} onClick={count}>
          count
        </button>
        <button style={styles.ghostBtn} onClick={clear} disabled={notes.length === 0}>
          clear all
        </button>
      </footer>
    </main>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 560,
    margin: "32px auto",
    padding: 24,
  },
  title: { fontSize: 26, margin: 0 },
  meta: { color: "#666", fontSize: 13, marginTop: 4 },
  form: {
    display: "flex",
    gap: 8,
    marginTop: 24,
  },
  input: {
    flex: 1,
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
  },
  btn: {
    padding: "8px 14px",
    border: "1px solid #2563eb",
    background: "#3b82f6",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    borderRadius: 4,
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: "16px 0",
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  note: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 12px",
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: 4,
  },
  text: { flex: 1, fontSize: 14 },
  timestamp: { color: "#888", fontSize: 12, fontFamily: "ui-monospace, monospace" },
  delBtn: {
    width: 24,
    height: 24,
    padding: 0,
    border: "1px solid #ccc",
    background: "transparent",
    color: "#999",
    cursor: "pointer",
    borderRadius: 4,
    fontSize: 16,
    lineHeight: 1,
  },
  empty: {
    padding: "16px",
    color: "#999",
    fontStyle: "italic" as const,
    textAlign: "center" as const,
  },
  footer: {
    display: "flex",
    gap: 8,
    marginTop: 24,
    paddingTop: 16,
    borderTop: "1px solid #eee",
  },
  ghostBtn: {
    padding: "6px 12px",
    border: "1px dashed #ccc",
    background: "transparent",
    cursor: "pointer",
    fontSize: 12,
    borderRadius: 4,
    color: "#666",
  },
};
