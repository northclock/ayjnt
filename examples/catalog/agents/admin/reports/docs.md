# ReportsAgent (admin only)

Sensitive — every request must include `Authorization: Bearer letmein`.
The same gate applies to:

- `GET /admin/reports/<instance>` (data)
- `GET /admin/reports/docs`        (this page)
- `/__ayjnt/catalog` filtering     (the agent is hidden when the gate fails)

## Callable methods

| Method | Signature | Description |
|---|---|---|
| `listReports` | `() => Promise<Report[]>` | Return every available report. |

## Type

```ts
type Report = { name: string; rows: number };
```
