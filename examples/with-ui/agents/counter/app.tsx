import { useAgent } from "@ayjnt/counter";

export default function Counter() {
  const agent = useAgent();
  // `state` is typed as { count: number } | undefined because it isn't set
  // until the first CF_AGENT_STATE message arrives. Default to 0 in the UI
  // to keep the initial render simple.
  const count = agent.state?.count ?? 0;
  const set = (next: number) => agent.setState({ count: next });

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Counter</h1>
      <p style={styles.meta}>
        instance: <code>{agent.name}</code>
        <br />
        open this URL in another tab — state syncs across tabs
      </p>
      <div style={styles.count}>{count}</div>
      <div style={styles.buttons}>
        <button style={styles.button} onClick={() => set(count - 1)}>
          −
        </button>
        <button style={styles.button} onClick={() => set(0)}>
          reset
        </button>
        <button style={styles.button} onClick={() => set(count + 1)}>
          +
        </button>
      </div>
    </main>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 480,
    margin: "80px auto",
    padding: 24,
    textAlign: "center" as const,
  },
  title: { fontSize: 24, marginBottom: 8 },
  meta: { color: "#666", fontSize: 14, lineHeight: 1.5, marginBottom: 32 },
  count: { fontSize: 96, fontWeight: 700, margin: "24px 0" },
  buttons: { display: "flex", gap: 12, justifyContent: "center" },
  button: {
    padding: "10px 20px",
    fontSize: 18,
    borderRadius: 6,
    border: "1px solid #ccc",
    background: "#f7f7f7",
    cursor: "pointer",
  },
};
