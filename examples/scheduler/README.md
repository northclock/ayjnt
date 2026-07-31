# Scheduled endpoint monitor

A practical scheduling example: ask an agent to check an HTTP endpoint once,
on an interval, or on a cron schedule. Each run records status, latency, and a
small response preview and pushes it to every connected browser.

```sh
bun install
bun run dev
```

Open `/monitor/demo`. Try `https://api.github.com/repos/northclock/ayjnt` with a
one-minute interval.

This example shows `schedule()`, `scheduleEvery()`, `cancelSchedule()`, and
durable callback payloads without creating three separate demo projects.
