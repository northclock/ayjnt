---
name: ayjnt-scheduling
description: Add one-time, delayed, recurring, or cron work to an Ayjnt agent. Use when the user asks for reminders, scheduled callbacks, intervals, cron, `schedule`, `scheduleEvery`, listing or cancelling schedules, retry behavior, or scheduled work owned by sub-agents.
---

# Schedule durable agent work

Scheduled callbacks are public methods on the same agent. Pass the
method name to `schedule` or `scheduleEvery`; keep payloads
structured-cloneable.

```ts
// agents/reminders/agent.ts
import { Agent, callable } from "ayjnt";

type Reminder = {
  id: string;
  text: string;
  scheduleId: string;
};
type State = { reminders: Reminder[] };

export default class RemindersAgent extends Agent<State> {
  override initialState: State = { reminders: [] };

  @callable()
  async remindIn(text: string, seconds: number) {
    const id = crypto.randomUUID();
    const scheduled = await this.schedule(seconds, "deliver", { id, text });
    this.setState({
      reminders: [
        ...this.state.reminders,
        { id, text, scheduleId: scheduled.id },
      ],
    });
    return scheduled.id;
  }

  async deliver(payload: { id: string; text: string }) {
    this.broadcast(JSON.stringify({
      type: "reminder",
      ...payload,
    }));
  }
}
```

## Choose a schedule

```ts
// Seconds from now.
await this.schedule(60, "tick", { source: "delay" });

// A specific time.
await this.schedule(new Date("2030-01-01T09:00:00Z"), "tick");

// Cron expression.
await this.schedule("0 9 * * 1-5", "dailyBrief");

// Fixed interval in seconds.
await this.scheduleEvery(300, "checkEndpoint", { monitorId });
```

Cron schedules are idempotent by default. `scheduleEvery` deduplicates
the same callback, interval, and payload, so it is safe in `onStart`.
Delayed and date schedules can opt into deduplication with
`{ idempotent: true }`.

## Inspect and cancel

```ts
const schedules = await this.listSchedules();
const schedule = await this.getScheduleById(scheduleId);
const removed = await this.cancelSchedule(scheduleId);
```

Use the asynchronous APIs. The old synchronous `getSchedule` and
`getSchedules` cannot cross sub-agent boundaries.

Schedules are owned by the agent or sub-agent that created them.
Deleting a sub-agent cleans up its schedules.

## Retry policy

```ts
await this.scheduleEvery(60, "sync", undefined, {
  retry: {
    maxAttempts: 5,
    baseDelayMs: 250,
    maxDelayMs: 10_000,
  },
});
```

Make callbacks idempotent: a retry may repeat external effects. Use a
stable idempotency key for payments, emails, writes, and webhook calls.

## Validation

Run `bun run dev`, create a short one-time schedule, observe the
callback, list schedules, then cancel a recurring one. Verify that
restarting the dev server does not duplicate an interval created by
`onStart`.

See [`examples/scheduler`](../../../examples/scheduler) for a complete
endpoint monitor.
