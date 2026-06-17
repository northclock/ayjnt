# ayjnt example: recurring-tasks

A self-driving agent that wakes itself on a fixed cadence with `this.scheduleEvery()`. Includes a live React UI that renders the rolling load history.

```
agents/
  heartbeat/
    agent.ts   ← scheduleEvery + cancelSchedule
    app.tsx    ← React UI: bar chart of ticks
client.ts      ← demo: start + poll + stop
```

## Scaffold

```sh
bunx ayjnt new my-heartbeat
cd my-heartbeat
rm -rf agents/counter
mkdir -p agents/heartbeat
# copy agents/heartbeat/agent.ts and app.tsx from this example
bun install
```

## Run

```sh
bun run dev                                        # terminal 1
bun run client                                     # terminal 2 — start + poll + stop
open http://localhost:8787/heartbeat/demo          # browser — live chart
```

Expected client output:

```
reset state…
{ ok: true, cleared: true }

start ticking every 2 seconds…
{ ok: true, running: true, intervalSeconds: 2 }

t=1s  ticks=0  last=—
t=2s  ticks=1  last=#1 load 73.4%
t=3s  ticks=1  last=#1 load 73.4%
t=4s  ticks=2  last=#2 load 88.1%
t=5s  ticks=2  last=#2 load 88.1%
t=6s  ticks=3  last=#3 load 56.7%

stop ticking…
{ ok: true, running: false }
```

The browser tab updates the bar chart every tick because the React UI subscribes to agent state via the generated `useAgent()` hook.

## How `scheduleEvery` differs from `schedule`

| | `schedule(when, cb)` | `scheduleEvery(intervalSeconds, cb)` |
|---|---|---|
| Fires | once | repeatedly until cancelled |
| Cancel | `cancelSchedule(id)` | `cancelSchedule(id)` |
| Survives restarts | yes | yes |
| Storage cost | one record | one record |

Both return a `Schedule` whose `id` you persist if you want to cancel it later. This example stashes `scheduleId` in agent state so DELETE / `{ stop: true }` can tear it down.

## Pitfalls

- **Calling `scheduleEvery` twice without cancelling the first** leaves both running. Always cancel before re-scheduling — see `stopTicking()` in the agent.
- **Doing real work in the tick callback** is fine for short jobs. Long jobs should `ctx.waitUntil()` so the alarm handler can return promptly.
- **State unbounded growth.** A 5-second tick that runs for a week is 120k records. The example caps history at 50; you'd cap differently in a real system.

## Deploy

```sh
bun run deploy
```

Once deployed, the agent ticks even when nobody is connected — the alarm wakes the DO from cold storage every interval.

## See also

- [`examples/scheduled-tasks`](../scheduled-tasks) for one-shot `schedule()` calls
- [`examples/with-ui`](../with-ui) for the co-located UI pattern this example reuses
