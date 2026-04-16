# ayjnt example: scheduled-tasks

One agent that exercises the Cloudflare Agents SDK's `this.schedule()` API for one-shot deferred work — relative delays, absolute times, and persistent state for both pending and fired reminders.

```
agents/
  reminder/
    agent.ts   ← schedule() + cancelSchedule() + a `fire` callback
client.ts      ← demo: schedule three, watch them fire
```

## Scaffold

```sh
bunx ayjnt new my-reminders
cd my-reminders
mkdir -p agents/reminder
# copy agents/reminder/agent.ts from this example
bun install
```

## Run

```sh
bun run dev               # terminal 1
bun run client            # terminal 2 — schedules + polls
```

Expected client output:

```
using inbox: inbox-7f3kQ8

schedule three reminders…
{ ok: true, scheduled: { id: "…", text: "say hi", due: … }, msFromNow: 2000 }
{ ok: true, scheduled: { id: "…", text: "drink water", due: … }, msFromNow: 4000 }
{ ok: true, scheduled: { id: "…", text: "stretch", due: … }, msFromNow: 6000 }

waiting for them to fire…
t=1s  pending=3  fired=—
t=2s  pending=2  fired=say hi
t=3s  pending=2  fired=say hi
t=4s  pending=1  fired=say hi, drink water
t=5s  pending=1  fired=say hi, drink water
t=6s  pending=0  fired=say hi, drink water, stretch
```

## How it works

Every Agent gets `this.schedule(when, callbackName, payload?)`. It persists a record to the DO's storage and sets a Cloudflare alarm. When the alarm fires, the SDK invokes `this[callbackName]` with the payload. Survives worker restarts because the alarm is persisted on the DO.

| Argument | Accepts |
|---|---|
| `when` | `number` (seconds delay), `Date`, or unix timestamp |
| `callback` | `keyof this` — must match a method on the Agent class |
| `payload` | Anything structured-cloneable (plain data) |

`this.getSchedules()` enumerates pending schedules; `this.cancelSchedule(id)` removes one. The DELETE handler in this example uses both to wipe everything for the demo.

## Deploy

```sh
bun run deploy
# POST https://my-reminders.<account>.workers.dev/reminder/inbox-1
#   { "text": "demo", "in": 30 }
```

The schedule survives across worker invocations — close the demo, redeploy, and a 30-minute reminder will still fire on time.

## See also

- [`examples/recurring-tasks`](../recurring-tasks) for `scheduleEvery()` (cron-style cadence)
- [Cloudflare Agents SDK schedule docs](https://developers.cloudflare.com/agents/api-reference/agent/#schedule)
