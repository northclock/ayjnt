# CarbonAgent

Polls the UK National Grid Carbon Intensity API
([carbon-intensity.github.io](https://carbon-intensity.github.io/api-definitions/#carbon-intensity-api-v2-0-0))
on a fixed cadence using the Agents SDK's `scheduleEvery()` API.

The API caches data per half-hour, so polling more often than once a
minute returns the same number — but a 15-second cadence is handy for
live demos. The default is 60 seconds.

## Endpoints

| Method   | Path                | Body                            | Behaviour |
|----------|---------------------|---------------------------------|---|
| `GET`    | `/carbon/<instance>`| —                               | Return current state. |
| `POST`   | `/carbon/<instance>`| `{ "intervalSeconds": 60 }`     | Start polling. Cancels the previous schedule. |
| `POST`   | `/carbon/<instance>`| `{ "stop": true }`              | Stop polling. |
| `DELETE` | `/carbon/<instance>`| —                               | Stop polling and clear history. |

## Callable methods (RPC)

| Method | Signature | Description |
|---|---|---|
| `tick`         | `() => Promise<void>`                                 | Fetch one sample manually. Useful for "refresh now" buttons. |
| `startPolling` | `(intervalSeconds: number) => Promise<{ scheduleId }>` | Install a recurring schedule at the given cadence. |
| `stopPolling`  | `() => Promise<void>`                                  | Cancel the active schedule. |

## State shape

```ts
type Sample = {
  fetchedAt: number;
  from: string;          // ISO half-hour window start
  to: string;            // ISO half-hour window end
  forecast: number;      // gCO2/kWh
  actual: number | null; // null until the period closes
  index: string;         // "very low" | "low" | "moderate" | "high" | "very high"
};

type State = {
  intervalSeconds: number;          // 0 when stopped
  scheduleId: string | null;
  current: Sample | null;
  history: Sample[];                // newest first, capped at 60
  error: string | null;             // last fetch error, cleared on success
};
```

## How recurring schedules work

`scheduleEvery(intervalSeconds, "tick")` registers a Durable-Object
alarm that fires `tick()` every N seconds. The schedule survives
worker restarts — the DO's alarm handler wakes the agent again. Each
agent instance keeps its own `scheduleId`, so cancelling one
instance's polling doesn't affect another's.

`startPolling` cancels the existing schedule before installing a new
one — calling `scheduleEvery` twice without cleanup leaves both
firing forever.
