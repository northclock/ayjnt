import { useState } from "react";
import { useAgent } from "@ayjnt/research";

type Investigation = {
  id: string;
  question: string;
  tools: string[];
  at: number;
};

/**
 * ResearchUI — submits questions to the ResearchAgent and shows the
 * list of registered browser-tool names that came back.
 *
 * In a real agent, `investigate(question)` would feed
 * `browserTools(this)` into `generateText({ tools, prompt: question })`
 * and stream back actual model output. For the example we just echo
 * the tool registry — proves the framework provisioned BROWSER +
 * LOADER + AI + `nodejs_compat` correctly.
 */
export default function ResearchUI() {
  const agent = useAgent();
  const investigations: Investigation[] =
    (agent.state as { investigations?: Investigation[] })?.investigations ?? [];

  const [question, setQuestion] = useState("What is the current weather in Tokyo?");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{
    registered_tools: string[];
    hint: string;
  } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await agent.call("investigate", [question]);
      setLastResult(result as { registered_tools: string[]; hint: string });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Research</h1>
      <p style={styles.meta}>
        instance: <code>{agent.name}</code>
        <br />
        Each query records to the agent's state and returns the
        browser-tool registry. Wire <code>generateText({"{ tools }"})</code>{" "}
        into <code>investigate()</code> for real model output.
      </p>

      <form onSubmit={onSubmit} style={styles.form}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={styles.textarea}
          rows={2}
          required
          placeholder="Ask a question…"
        />
        <button style={styles.primary} disabled={busy} type="submit">
          {busy ? "investigating…" : "investigate"}
        </button>
      </form>

      {lastResult && (
        <section style={styles.resultBox}>
          <h2 style={styles.subtitle}>Last result</h2>
          <p style={styles.label}>Registered tools</p>
          <ul style={styles.toolList}>
            {lastResult.registered_tools.map((t) => (
              <li key={t} style={styles.toolPill}>
                {t}
              </li>
            ))}
          </ul>
          <p style={styles.hint}>{lastResult.hint}</p>
        </section>
      )}

      <h2 style={styles.subtitle}>History ({investigations.length})</h2>
      {investigations.length === 0 ? (
        <p style={styles.empty}>No investigations yet.</p>
      ) : (
        <ul style={styles.list}>
          {investigations
            .slice()
            .reverse()
            .map((inv) => (
              <li key={inv.id} style={styles.row}>
                <span style={styles.question}>{inv.question}</span>
                <span style={styles.tools}>
                  {inv.tools.length} tool{inv.tools.length === 1 ? "" : "s"}
                </span>
                <span style={styles.time}>
                  {new Date(inv.at).toLocaleTimeString()}
                </span>
              </li>
            ))}
        </ul>
      )}
    </main>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 720,
    margin: "32px auto",
    padding: 24,
  },
  title: { fontSize: 24, margin: 0 },
  subtitle: { fontSize: 16, marginTop: 24, marginBottom: 8 },
  meta: { color: "#555", fontSize: 13, lineHeight: 1.6, marginTop: 8 },
  form: { display: "flex", gap: 8, alignItems: "stretch", margin: "24px 0" },
  textarea: {
    flex: 1,
    padding: "8px 10px",
    fontSize: 14,
    border: "1px solid #d4d4d8",
    borderRadius: 4,
    fontFamily: "inherit",
    resize: "vertical" as const,
  },
  primary: {
    padding: "8px 16px",
    fontSize: 14,
    background: "#2563eb",
    color: "#fff",
    border: "1px solid #2563eb",
    borderRadius: 4,
    cursor: "pointer",
  },
  resultBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: 16,
    marginTop: 8,
  },
  label: { fontSize: 11, color: "#666", textTransform: "uppercase" as const, letterSpacing: 0.5, margin: "8px 0 4px" },
  toolList: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap" as const, gap: 6 },
  toolPill: {
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    background: "#e2e8f0",
    color: "#1e293b",
    padding: "3px 8px",
    borderRadius: 12,
  },
  hint: { fontSize: 12, color: "#666", marginTop: 12, fontStyle: "italic" as const },
  list: { listStyle: "none", padding: 0, margin: 0 },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: 12,
    alignItems: "center",
    padding: "10px 4px",
    borderBottom: "1px solid #eee",
    fontSize: 14,
  },
  question: {},
  tools: { color: "#666", fontSize: 12 },
  time: { color: "#999", fontSize: 12, fontFamily: "ui-monospace, monospace" },
  empty: { color: "#999", fontSize: 14, fontStyle: "italic" as const },
};
