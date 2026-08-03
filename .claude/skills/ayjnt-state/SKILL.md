---
name: ayjnt-state
description: Add or revise durable state and SQLite storage in an Ayjnt agent. Use when the user asks about `initialState`, `this.state`, `setState`, `validateStateChange`, `onStateChanged`, `this.sql`, persistence, live browser synchronization, or choosing between synchronized state and relational records.
---

# Add durable state

Choose storage by audience:

- Use synchronized `State` for the small snapshot browser and terminal
  interfaces need immediately.
- Use the agent's isolated SQLite database for durable records,
  indexes, history, and queries.

## Synchronized state

```ts
// agents/jobs/agent.ts
import { Agent, callable } from "ayjnt";

type State = {
  phase: "idle" | "running";
  progress: number;
};

export default class JobsAgent extends Agent<State> {
  override initialState: State = {
    phase: "idle",
    progress: 0,
  };

  validateStateChange(next: State) {
    if (next.progress < 0 || next.progress > 1) {
      throw new Error("progress must be between 0 and 1");
    }
  }

  @callable()
  async setProgress(progress: number) {
    this.setState({
      ...this.state,
      phase: progress === 1 ? "idle" : "running",
      progress,
    });
  }
}
```

`setState(next)` replaces the full state value, persists it, and
broadcasts it to connected interfaces. Preserve fields explicitly with
`{ ...this.state, changedField }`.

Use `validateStateChange(next)` for synchronous invariants. Use
`onStateChanged(state, source)` for side effects after persistence;
do not call `setState` from it without a termination condition.

## SQLite

Use the tagged `this.sql` helper. Each named agent instance gets
isolated storage.

```ts
async onStart() {
  this.sql`CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`;
}

async addTurn(role: string, content: string) {
  this.sql`INSERT INTO turns (id, role, content, created_at)
    VALUES (
      ${crypto.randomUUID()},
      ${role},
      ${content},
      ${Date.now()}
    )`;
}

async history() {
  return this.sql<{
    role: string;
    content: string;
    created_at: number;
  }>`SELECT role, content, created_at
      FROM turns
      ORDER BY created_at`;
}
```

Interpolate values; never concatenate untrusted input into SQL.

## Browser interaction

Use the generated hook:

```tsx
import { useAgent } from "@ayjnt/jobs";

export default function JobsApp() {
  const agent = useAgent();
  const state = agent.state ?? { phase: "idle", progress: 0 };

  return (
    <button onClick={() => agent.stub.setProgress(0.5)}>
      {state.phase}: {Math.round(state.progress * 100)}%
    </button>
  );
}
```

Treat `agent.state` as initially undefined while the WebSocket identity
and first state message arrive.

## Validation

Run:

```sh
bun run build
bun run dev
```

Open two browser tabs on the same instance and confirm a change appears
in both. Restart dev and confirm state and SQLite rows persist.

See [`examples/code`](../../../examples/code) for durable sessions and
browser-visible usage, and the
[Cloudflare state guide](https://developers.cloudflare.com/agents/runtime/lifecycle/state/).
