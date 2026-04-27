# StatusAgent

Lives under the `(public)` route group, so it inherits only the root
middleware (logging + timing). No auth required — anyone can hit
`/status/<instance>`.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/status/<instance>` | Returns `{ status: "ok", instance, ts }`. |
