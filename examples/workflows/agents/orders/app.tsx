import { useState } from "react";
import { useAgent } from "@ayjnt/orders";

type Order = {
  id: string;
  sku: string;
  qty: number;
  status: "queued" | "processing" | "complete" | "failed";
  workflowId?: string;
};

/**
 * OrdersUI — drives the OrdersAgent over WebSocket.
 *
 * The generated `useAgent` hook (from `@ayjnt/orders`) opens a
 * WebSocket on mount, syncs `agent.state` with the DO's setState
 * broadcasts, and exposes `agent.call(method, args)` for any
 * `@callable`-decorated method on the agent.
 *
 * Submitting the form fires `agent.call("placeOrder", [{ ... }])` →
 * the agent inserts the row at `queued`, then triggers
 * `ORDERS_PROCESSING`. The workflow's `step.do(...)` blocks RPC back
 * into the agent (`this.agent.markStatus(...)`) to advance the row's
 * status. setState broadcasts each update so the row flips through
 * the lifecycle live without polling.
 */
export default function OrdersUI() {
  const agent = useAgent();
  const orders: Order[] = (agent.state as { orders?: Order[] })?.orders ?? [];

  const [sku, setSku] = useState("WIDGET-1");
  const [qty, setQty] = useState(3);
  const [customerId, setCustomerId] = useState("cust-42");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await agent.call("placeOrder", [{ sku, qty, customerId }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Orders</h1>
      <p style={styles.meta}>
        instance: <code>{agent.name}</code>
        <br />
        Submit an order — the row flips through{" "}
        <em>queued → processing → complete</em> as the workflow
        advances. setState broadcasts each step over the WebSocket.
      </p>

      <form onSubmit={onSubmit} style={styles.form}>
        <label style={styles.field}>
          <span style={styles.label}>SKU</span>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            style={styles.input}
            required
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Qty</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(parseInt(e.target.value || "0", 10))}
            style={styles.input}
            required
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Customer ID</span>
          <input
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            style={styles.input}
            required
          />
        </label>
        <button style={styles.primary} disabled={busy} type="submit">
          {busy ? "placing…" : "place order"}
        </button>
      </form>

      <h2 style={styles.subtitle}>Live orders ({orders.length})</h2>
      {orders.length === 0 ? (
        <p style={styles.empty}>No orders yet. Submit one above.</p>
      ) : (
        <ul style={styles.list}>
          {orders
            .slice()
            .reverse()
            .map((o) => (
              <li key={o.id} style={styles.row}>
                <span style={styles.id}>{o.id.slice(0, 8)}…</span>
                <span style={styles.sku}>
                  {o.sku} × {o.qty}
                </span>
                <span
                  style={{
                    ...styles.status,
                    background: BADGE[o.status].bg,
                    color: BADGE[o.status].fg,
                  }}
                >
                  {o.status}
                </span>
                {o.workflowId && (
                  <span style={styles.workflowId} title={o.workflowId}>
                    wf:{o.workflowId.slice(0, 8)}…
                  </span>
                )}
              </li>
            ))}
        </ul>
      )}
    </main>
  );
}

const BADGE: Record<Order["status"], { bg: string; fg: string }> = {
  queued: { bg: "#f1f5f9", fg: "#64748b" },
  processing: { bg: "#fef3c7", fg: "#92400e" },
  complete: { bg: "#dcfce7", fg: "#166534" },
  failed: { bg: "#fee2e2", fg: "#991b1b" },
};

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 720,
    margin: "32px auto",
    padding: 24,
  },
  title: { fontSize: 24, margin: 0 },
  subtitle: { fontSize: 16, marginTop: 32, marginBottom: 8 },
  meta: { color: "#555", fontSize: 13, lineHeight: 1.6, marginTop: 8 },
  form: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 2fr auto",
    gap: 8,
    alignItems: "end",
    margin: "24px 0",
  },
  field: { display: "flex", flexDirection: "column" as const, gap: 4 },
  label: { fontSize: 11, color: "#666", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  input: {
    padding: "8px 10px",
    fontSize: 14,
    border: "1px solid #d4d4d8",
    borderRadius: 4,
    fontFamily: "inherit",
  },
  primary: {
    padding: "8px 16px",
    fontSize: 14,
    background: "#2563eb",
    color: "#fff",
    border: "1px solid #2563eb",
    borderRadius: 4,
    cursor: "pointer",
    height: 36,
  },
  list: { listStyle: "none", padding: 0, margin: 0 },
  row: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto auto",
    gap: 12,
    alignItems: "center",
    padding: "10px 4px",
    borderBottom: "1px solid #eee",
    fontSize: 14,
  },
  id: { fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#888" },
  sku: {},
  status: {
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    padding: "3px 8px",
    borderRadius: 12,
    fontWeight: 600,
  },
  workflowId: { fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#aaa" },
  empty: { color: "#999", fontSize: 14, fontStyle: "italic" as const },
};
