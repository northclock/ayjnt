import { useEffect, useState } from "react";

type Callable = {
  name: string;
  params: string;
  returnType: string | null;
  description: string | null;
};

type CatalogEntry = {
  agentId: string;
  className: string;
  routePath: string;
  hasApp: boolean;
  hasDocs: boolean;
  isMcp: boolean;
  callables: Callable[];
  docsUrl: string | null;
};

type Catalog = { version: number; agents: CatalogEntry[] };

/**
 * The catalog UI. Hits `/__ayjnt/catalog`, groups results by route
 * prefix, and renders a tree with each agent's callable RPC surface
 * and a link to its docs.
 *
 * The bearer-token field on the page lets you watch the admin agents
 * appear and disappear in real time — the catalog is filtered by
 * middleware on every request.
 */
export default function CatalogApp() {
  const [token, setToken] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    fetch("/__ayjnt/catalog", { headers })
      .then((r) => r.json())
      .then((data) => {
        setCatalog(data as Catalog);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [token]);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>Agent Catalog</h1>
        <p style={styles.meta}>
          Live read of <code>/__ayjnt/catalog</code>. Routes are filtered
          by each agent's middleware chain, so paste a bearer token to
          unlock admin agents.
        </p>
        <label style={styles.tokenRow}>
          <span style={styles.tokenLabel}>Authorization: Bearer</span>
          <input
            style={styles.tokenInput}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="(none — try 'letmein')"
          />
        </label>
      </header>

      {error ? (
        <pre style={styles.error}>{error}</pre>
      ) : !catalog ? (
        <p style={styles.meta}>loading…</p>
      ) : catalog.agents.length === 0 ? (
        <p style={styles.meta}>no accessible agents</p>
      ) : (
        <ul style={styles.tree}>
          {catalog.agents.map((agent) => (
            <AgentNode key={agent.agentId} agent={agent} />
          ))}
        </ul>
      )}
    </main>
  );
}

function AgentNode({ agent }: { agent: CatalogEntry }) {
  return (
    <li style={styles.agent}>
      <div style={styles.agentHead}>
        <code style={styles.route}>{agent.routePath}</code>
        <span style={styles.className}>{agent.className}</span>
        <span style={styles.badges}>
          {agent.hasApp ? <Badge label="app" /> : null}
          {agent.hasDocs ? <Badge label="docs" /> : null}
          {agent.isMcp ? <Badge label="mcp" /> : null}
        </span>
      </div>
      {agent.docsUrl ? (
        <a href={agent.docsUrl} style={styles.docsLink}>
          → {agent.docsUrl}
        </a>
      ) : null}
      {agent.callables.length === 0 ? (
        <p style={styles.empty}>no @callable methods</p>
      ) : (
        <ul style={styles.callables}>
          {agent.callables.map((c) => (
            <li key={c.name} style={styles.callable}>
              <code style={styles.signature}>
                <span style={styles.method}>{c.name}</span>
                <span>(</span>
                <span style={styles.params}>{c.params}</span>
                <span>)</span>
                {c.returnType ? (
                  <span style={styles.returns}>: {c.returnType}</span>
                ) : null}
              </code>
              {c.description ? (
                <p style={styles.description}>{c.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Badge({ label }: { label: string }) {
  return <span style={styles.badge}>{label}</span>;
}

const styles = {
  main: {
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    maxWidth: 920,
    margin: "32px auto",
    padding: 24,
    color: "#111",
  },
  header: { marginBottom: 32 },
  title: { fontSize: 28, margin: "0 0 8px 0" },
  meta: { color: "#555", fontSize: 14, lineHeight: 1.5 },
  tokenRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    fontSize: 13,
  },
  tokenLabel: {
    fontFamily: "ui-monospace, monospace",
    color: "#444",
  },
  tokenInput: {
    flex: 1,
    padding: "6px 10px",
    fontFamily: "ui-monospace, monospace",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 4,
  },
  tree: { listStyle: "none", padding: 0, margin: 0 },
  agent: {
    border: "1px solid #e5e5e5",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    background: "#fafafa",
  },
  agentHead: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
  },
  route: {
    fontFamily: "ui-monospace, monospace",
    fontSize: 14,
    fontWeight: 600,
    color: "#111",
  },
  className: { fontSize: 13, color: "#666" },
  badges: { display: "flex", gap: 4, marginLeft: "auto" },
  badge: {
    background: "#eef",
    color: "#225",
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 3,
    fontFamily: "ui-monospace, monospace",
  },
  docsLink: {
    display: "inline-block",
    marginTop: 8,
    fontSize: 12,
    color: "#0a64c8",
    textDecoration: "none",
    fontFamily: "ui-monospace, monospace",
  },
  empty: {
    margin: "12px 0 0 0",
    fontSize: 12,
    color: "#888",
    fontStyle: "italic" as const,
  },
  callables: {
    listStyle: "none",
    padding: 0,
    margin: "12px 0 0 0",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  },
  callable: {
    background: "#fff",
    border: "1px solid #e8e8e8",
    borderRadius: 6,
    padding: "10px 12px",
  },
  signature: {
    fontFamily: "ui-monospace, monospace",
    fontSize: 13,
    color: "#222",
  },
  method: { color: "#5b21b6", fontWeight: 600 },
  params: { color: "#0369a1" },
  returns: { color: "#047857" },
  description: { margin: "6px 0 0 0", fontSize: 12, color: "#555" },
  error: {
    background: "#fff3f3",
    color: "#900",
    padding: 12,
    borderRadius: 6,
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
  },
};
