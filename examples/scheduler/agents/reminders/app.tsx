import { useEffect, useRef, useState } from "react";
import { useAgent } from "@ayjnt/reminders";

type Reminder = {
  id: string;
  text: string;
  createdAt: number;
  due: number;
  firedAt?: number;
};

const DURATION_PRESETS = [
  { label: "10s", seconds: 10 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 5 * 60 },
];

type PermissionState = "default" | "granted" | "denied" | "unsupported";

export default function RemindersApp() {
  const agent = useAgent();
  const pending = agent.state?.pending ?? [];
  const fired = agent.state?.fired ?? [];

  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [now, setNow] = useState(Date.now());
  const [permission, setPermission] = useState<PermissionState>("default");

  // Tick once per second so the countdown labels stay live without
  // re-rendering on every WebSocket message.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Initialise notification permission state. The Notification API is
  // synchronous to read, async to request — store it so we can show a
  // banner if the user denied.
  useEffect(() => {
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PermissionState);
  }, []);

  // Watch for new entries in `fired` and pop a system notification per
  // reminder. We dedupe with a ref of the last-seen ids so the second
  // useEffect run after a fast-refresh doesn't double-fire.
  const seenFired = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (permission !== "granted") return;
    for (const r of fired) {
      if (seenFired.current.has(r.id)) continue;
      seenFired.current.add(r.id);
      try {
        new Notification("Reminder", {
          body: r.text,
          tag: r.id,
          // The reminder timestamp goes into the notification metadata
          // so the OS can display it consistently.
          timestamp: r.firedAt,
        } as NotificationOptions);
      } catch {
        // Some browsers (Safari historically) throw on certain options.
        new Notification("Reminder", { body: r.text });
      }
    }
  }, [fired, permission]);

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result as PermissionState);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await fetch(window.location.pathname, {
      method: "POST",
      body: JSON.stringify({ text: text.trim(), in: seconds }),
    });
    setText("");
  };

  const cancel = async (id: string) => {
    await fetch(`${window.location.pathname}/${id}`, { method: "DELETE" });
  };

  const clearAll = async () => {
    await fetch(window.location.pathname, { method: "DELETE" });
    seenFired.current.clear();
  };

  return (
    <main style={styles.main}>
      <header>
        <h1 style={styles.title}>Reminders</h1>
        <p style={styles.meta}>
          instance: <code>{agent.name}</code> · {pending.length} pending ·{" "}
          {fired.length} fired
        </p>
      </header>

      <PermissionBanner state={permission} onRequest={requestPermission} />

      <form onSubmit={submit} style={styles.form}>
        <input
          style={styles.input}
          placeholder="remind me to..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select
          style={styles.select}
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
        >
          {DURATION_PRESETS.map((p) => (
            <option key={p.seconds} value={p.seconds}>
              in {p.label}
            </option>
          ))}
        </select>
        <button style={styles.btn} type="submit" disabled={!text.trim()}>
          set reminder
        </button>
      </form>

      <section style={styles.section}>
        <h2 style={styles.subtitle}>pending</h2>
        {pending.length === 0 ? (
          <p style={styles.empty}>nothing scheduled.</p>
        ) : (
          <ul style={styles.list}>
            {pending
              .slice()
              .sort((a, b) => a.due - b.due)
              .map((r) => (
                <li key={r.id} style={styles.pendingItem}>
                  <div style={styles.itemBody}>
                    <strong>{r.text}</strong>
                    <small style={styles.itemMeta}>
                      fires in {formatRemaining(r.due - now)} ·{" "}
                      {new Date(r.due).toLocaleTimeString()}
                    </small>
                  </div>
                  <button
                    style={styles.btnGhostSmall}
                    onClick={() => cancel(r.id)}
                  >
                    cancel
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.subtitle}>fired ({fired.length})</h2>
        {fired.length === 0 ? (
          <p style={styles.empty}>none yet — set one and watch it fire.</p>
        ) : (
          <ul style={styles.list}>
            {fired.map((r) => (
              <li key={r.id} style={styles.firedItem}>
                <div style={styles.itemBody}>
                  <strong>{r.text}</strong>
                  <small style={styles.itemMeta}>
                    fired {fmtRelative(r.firedAt!, now)} ·{" "}
                    {new Date(r.firedAt!).toLocaleTimeString()}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
        {fired.length > 0 ? (
          <button style={styles.btnGhost} onClick={clearAll}>
            clear all
          </button>
        ) : null}
      </section>
    </main>
  );
}

function PermissionBanner({
  state,
  onRequest,
}: {
  state: PermissionState;
  onRequest: () => void;
}) {
  if (state === "granted") return null;

  if (state === "unsupported") {
    return (
      <div style={styles.bannerWarn}>
        Your browser doesn't expose the Notification API. Reminders will
        still fire and show in the list below.
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div style={styles.bannerWarn}>
        Notifications are blocked for this site. Reminders will still fire,
        but no system alert will pop up. Re-enable in your browser
        settings to see push notifications.
      </div>
    );
  }

  return (
    <div style={styles.bannerInfo}>
      <span>
        Allow notifications to get a system alert when a reminder fires.
      </span>
      <button style={styles.btnPrimary} onClick={onRequest}>
        allow notifications
      </button>
    </div>
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "now";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}

function fmtRelative(at: number, now: number): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return new Date(at).toLocaleTimeString();
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 640,
    margin: "32px auto",
    padding: 24,
  },
  title: { fontSize: 26, margin: 0 },
  meta: { color: "#555", fontSize: 13, marginTop: 4 },
  bannerInfo: {
    marginTop: 16,
    padding: "10px 14px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 6,
    color: "#1e3a8a",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  bannerWarn: {
    marginTop: 16,
    padding: "10px 14px",
    background: "#fef3c7",
    border: "1px solid #fcd34d",
    borderRadius: 6,
    color: "#78350f",
    fontSize: 13,
  },
  form: {
    marginTop: 16,
    display: "flex",
    gap: 8,
  },
  input: {
    flex: 1,
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
  },
  select: {
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
    background: "#fff",
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
  btnPrimary: {
    padding: "6px 12px",
    border: "1px solid #1e3a8a",
    background: "#1e40af",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    borderRadius: 4,
  },
  btnGhost: {
    marginTop: 12,
    padding: "6px 12px",
    border: "1px dashed #ccc",
    background: "transparent",
    cursor: "pointer",
    fontSize: 12,
    borderRadius: 4,
    color: "#666",
  },
  btnGhostSmall: {
    padding: "4px 10px",
    border: "1px solid #d4d4d4",
    background: "transparent",
    cursor: "pointer",
    fontSize: 12,
    borderRadius: 4,
    color: "#525252",
  },
  section: { marginTop: 24 },
  subtitle: { fontSize: 14, color: "#444", margin: "0 0 8px 0" },
  empty: { fontSize: 13, color: "#888", fontStyle: "italic" as const, margin: 0 },
  list: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column" as const, gap: 8 },
  pendingItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    background: "#f5f3ff",
    border: "1px solid #ddd6fe",
    borderRadius: 6,
  },
  firedItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 6,
  },
  itemBody: { display: "flex", flexDirection: "column" as const, gap: 2 },
  itemMeta: { color: "#666", fontSize: 12 },
};
