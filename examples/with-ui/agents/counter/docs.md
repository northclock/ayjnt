# CounterAgent

A counter with state that syncs live across every connected client.
Each `/counter/<instance>` is its own Durable Object — two browser
tabs at the same URL share state in real time, two tabs at different
URLs do not.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `GET` (with `Accept: text/html`) | `/counter/<instance>` | Serves the React app from `app.tsx`. |
| `GET` (anything else) | `/counter/<instance>` | Returns the agent's JSON state. |
| `WebSocket` upgrade | `/counter/<instance>` | Subscribes to live state via the Agents SDK. |

## State shape

```ts
type State = { count: number };
```

## React hook

```tsx
import { useAgent } from "@ayjnt/counter";

const agent = useAgent();
agent.state?.count;            // current value
agent.setState({ count: 42 }); // broadcast to every connected client
```
