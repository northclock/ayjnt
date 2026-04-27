# RemindersAgent

Schedule a one-shot reminder N seconds from now (or at an absolute ISO
timestamp). Demonstrates the Agents SDK's `this.schedule()` API.

When the scheduled time arrives, the framework invokes `fire(payload)`
on the agent. We move the reminder from `pending` to `fired` and
`setState` broadcasts to every connected `useAgent` client.

## Endpoints

| Method   | Path                                       | Body                                | Behaviour |
|----------|--------------------------------------------|-------------------------------------|---|
| `GET`    | `/reminders/<instance>`                    | —                                   | Return current state. |
| `POST`   | `/reminders/<instance>`                    | `{ "text": "...", "in": 60 }`       | Schedule a new reminder N seconds from now. |
| `POST`   | `/reminders/<instance>`                    | `{ "text": "...", "at": "ISO" }`    | Schedule at an absolute ISO timestamp. |
| `DELETE` | `/reminders/<instance>/<reminderId>`       | —                                   | Cancel one pending reminder. |
| `DELETE` | `/reminders/<instance>`                    | —                                   | Cancel everything pending and clear history. |

## Callable methods (RPC)

| Method | Signature | Description |
|---|---|---|
| `createReminder` | `(text: string, inSeconds: number) => Promise<Reminder>` | Schedule a new reminder. |
| `cancelReminder` | `(id: string) => Promise<{ cancelled: boolean }>`        | Cancel one pending reminder by id. |

## State shape

```ts
type Reminder = {
  id: string;
  text: string;
  createdAt: number;
  due: number;
  firedAt?: number;
};

type State = {
  pending: Reminder[];
  fired: Reminder[];   // newest first, capped at 50
};
```

## How the "push notification" works

The agent itself doesn't send push notifications — it just persists the
fired reminder and broadcasts the state change. The browser-side
notification happens in `app.tsx`:

1. The UI requests `Notification.permission` on mount.
2. A `useEffect` watches `agent.state.fired` and dedupes via a
   `Set<string>` of seen ids.
3. Each new entry triggers `new Notification("Reminder", { body: r.text })`,
   which the OS surfaces as a system-level alert.

### Trade-off vs full Web Push

This works as long as the browser tab is open. For "fire when the tab
is closed" you need full Web Push:

- A service worker registered on the page.
- VAPID public/private keypair, public key bundled in the client.
- Browser calls `pushManager.subscribe({ applicationServerKey })`,
  returns a subscription endpoint + keys.
- Server stores the subscription per instance and, on `fire`,
  POSTs an encrypted payload to the endpoint with a VAPID-signed JWT.

That's a different example — call the upstream Push Service over
`fetch`, use `crypto.subtle` for the ECDH/HKDF/AES-GCM pipeline, and
keep the subscription in agent state alongside the reminder list. The
scheduling API stays exactly the same.

## How one-shot schedules work

`this.schedule(due, "fire", payload)` registers a Durable-Object
alarm. Even if the worker restarts, the alarm survives — the DO
wakes up on the alarm event and runs the named callback with the
persisted payload. Cancellation is by `scheduleId`; we look it up via
`getSchedules()` and match on the payload's reminder id.
