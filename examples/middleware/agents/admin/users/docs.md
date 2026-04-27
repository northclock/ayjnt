# AdminUsersAgent

Lives behind two middleware layers (the root logger plus the
`admin/middleware.ts` auth gate). All requests must include
`Authorization: Bearer letmein`.

`docs.md` is gated by the same chain — `GET /admin/users/docs`
without the bearer token returns `403 forbidden`. The catalog
endpoint (`/__ayjnt/catalog`) hides this agent from any caller
that doesn't pass the gate.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/admin/users/<instance>` | Increment visit count, return JSON. Requires bearer token. |

## State shape

```ts
type State = { visits: number };
```
