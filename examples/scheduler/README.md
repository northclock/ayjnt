# ayjnt example: scheduler

Two agents, one to demonstrate **recurring** scheduling and one to
demonstrate **one-shot** scheduling. Both ship a React UI.

| Agent | Scheduler API | What it does |
|---|---|---|
| `carbon`    | `scheduleEvery(intervalSeconds, "tick")` | Polls the UK National Grid carbon-intensity API every minute and renders a live history. |
| `reminders` | `schedule(date, "fire", payload)`        | Accepts a reminder + delay; fires a system Notification when the time arrives. |

## Layout

```
agents/
  carbon/
    agent.ts       ← CarbonAgent (scheduleEvery → fetch → setState)
    app.tsx        ← live current value + bar chart
    docs.md        ← /carbon/docs
  reminders/
    agent.ts       ← RemindersAgent (schedule → fire → setState)
    app.tsx        ← form + pending/fired lists, Notification API on fire
    docs.md        ← /reminders/docs
```

## Run it

```sh
bun install
bun run dev

# open the UI
open http://localhost:8787/carbon/main
open http://localhost:8787/reminders/me
```

## What you'll see

### `/carbon/main`

A coloured card with the current carbon intensity (gCO₂/kWh) and the
qualitative band ("very low" → "very high"). Click **start (60s)** and
the agent installs a recurring schedule that fetches the
[UK National Grid API](https://carbon-intensity.github.io/api-definitions/#carbon-intensity-api-v2-0-0)
every minute. Each sample is prepended to the history bar chart.

The first request triggers an immediate `tick()` so the UI doesn't sit
empty for a full interval. The schedule survives worker restarts —
shut down `bun run dev`, restart, and the agent picks up its alarm
where it left off.

### `/reminders/me`

A text field, a duration selector (10s / 30s / 1m / 5m), and lists for
pending and fired reminders. The first time you submit, the browser
prompts for notification permission. After granting, every reminder
that fires also pops a system-level OS notification with the reminder
text.

```sh
# from the terminal
curl -X POST http://localhost:8787/reminders/me \
  -H 'content-type: application/json' \
  -d '{"text":"check the kettle","in":30}'
```

Wait 30 seconds, watch the reminder move from `pending` to `fired`
in the UI, and (if the tab is open and notifications granted) see the
OS notification appear.

## Why two agents in one example

`scheduleEvery` and `schedule` are both `this.schedule*` APIs that
write into the Durable Object's alarm system, but the patterns they
enable are different:

- **Recurring** is for background workers that need to wake up on a
  cadence (polling, heartbeats, batch jobs).
- **One-shot** is for deferred work tied to a specific event (reminders,
  retries, time-bounded promotions, follow-ups).

Both schedules are scoped to one DO instance — `/carbon/main` and
`/carbon/london` would each have their own independent polling
schedule, and `/reminders/me` only fires reminders for me.

## Notification trade-off

The reminders example uses the in-page **Notification API**. That
works as long as the browser tab is open. For background push (tab
closed, OS-level only) you'd need full Web Push: a service worker,
VAPID keys, encrypted payloads via the upstream Push Service. The
scheduling code on the agent doesn't change — only the delivery
channel does. See [`agents/reminders/docs.md`](./agents/reminders/docs.md)
for a pointer to the full pipeline.

## See also

- [`examples/scheduled-tasks`](../scheduled-tasks) — the bare
  `this.schedule()` API without the UI/notification layer.
- [`examples/recurring-tasks`](../recurring-tasks) — recurring
  schedules with a synthetic-load demo.
- [Main README — scheduling](../../README.md)
