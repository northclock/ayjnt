# `src/codegen/` — the build pipeline

Pure functions over plain data. Given a project root, produce:

- `.ayjnt/migrations.json` — the migration lockfile (committed to git)
- `.ayjnt/dist/entry.ts` — the worker entrypoint (gitignored)
- `.ayjnt/dist/wrangler.jsonc` — the wrangler config (gitignored)

All the user ever writes is code under `agents/`. The rest is regenerated on every build.

## Stages

```
           scan()
agents/ ────────────► Manifest
                         │
           readLockfile()│
.ayjnt/migrations.json ──┤
                         │
          diffMigrations ▼
                     MigrationDiff  ◄─── (nextEntry: null if no changes)
                         │
            applyDiff    ▼
                    MigrationLockfile'
                         │
                    ┌────┴────┐
     generateEntry ▼          ▼ generateWrangler
                entry.ts    wrangler.jsonc
```

## Files

| File | Role |
|---|---|
| [`scan.ts`](./scan.ts) | Walk `agents/**/agent.ts`, extract class/agentId, compute routes/bindings/middleware chains. Produces `Manifest`. |
| [`migrations.ts`](./migrations.ts) | Read/write `.ayjnt/migrations.json`. `diffMigrations` + `applyDiff` + `nextTag` + `formatDiff`. |
| [`wrangler.ts`](./wrangler.ts) | Emit the generated `wrangler.jsonc` string. Pure. |
| [`entry.ts`](./entry.ts) | Emit the generated worker entrypoint string. Pure. |

## Contracts

All stages consume and produce types from [`../core/types.ts`](../core/types.ts).

### `Manifest`

The output of scanning. Agents are sorted alphabetically by `routePath` for stable output. Duplicates (same route, binding, or agentId) throw from `scan`.

### `MigrationLockfile`

Committed to git. Two things matter:

- **`migrations: MigrationEntry[]`** — append-only. Shape matches wrangler's migration format (`new_sqlite_classes`, `renamed_classes`, `deleted_classes`, plus `tag` and `timestamp`). Entries are applied in order by wrangler.
- **`classes: Record<agentId, {className, firstTag}>`** — the *derived* end-state after all migrations apply. Used to detect renames: if the same `agentId` reappears in a new manifest with a different `className`, it's a rename, not a delete + add.

If you change past entries, wrangler will refuse to migrate. Don't.

### `MigrationDiff`

What `diffMigrations` returns. `nextEntry` is `null` exactly when nothing changed — callers use this as the "no-op build" signal.

## Rename detection: why agentId matters

The file tree can't distinguish "renamed class" from "deleted + added class". So we track a stable `agentId` per agent:

- **Default** (`defaultAgentId`): derived from folder path. `agents/chat` → `"chat"`. Stable unless you move the folder.
- **Override** (`export const agentId = "..."` in `agent.ts`): stable across any refactor. Recommended once you've shipped.

At diff time:
- agentId in manifest but not in lockfile → `added` (new DO class, new SQLite storage)
- agentId in both with same className → unchanged
- agentId in both with different className → `renamed` (DO storage preserved, class name updated)
- agentId in lockfile but not in manifest → `deleted` (storage destroyed — irreversible)

## Why we don't use `routeAgentRequest`

Cloudflare's helper expects `/agents/{kebab-name}/{instance-id}/...`. We want `/chat/:id`, `/admin/users/:id`, route groups `(public)`, and nested middleware. Rolling our own dispatch in `generateEntry` is ~40 lines of generated TypeScript and gives us full control over the URL shape.

The generated entrypoint still re-exports every agent class so wrangler can register them as DOs — that's the only constraint the SDK imposes.

## Why `getAgentByName` and not raw `idFromName + get`

The generated dispatch calls `await getAgentByName(env[binding], instanceId)` — not the lower-level two-step of `namespace.idFromName(name)` followed by `namespace.get(id)`. This matters.

When a client connects via the Agents SDK (`useAgent`, `AgentClient`, or `agentFetch`), the Agent base class broadcasts a `CF_AGENT_IDENTITY` WebSocket message on connect with `{ name: this.name, agent: kebab(ClassName) }`. The SDK uses this to tell the client which instance it's talking to, and fires the `onIdentity` callback.

The DO only learns its own `name` when someone calls `stub.setName(name)` on it. Cloudflare's `getAgentByName` is the canonical helper that does this — its implementation is literally:

```ts
async function getAgentByName(namespace, name) {
  const id = namespace.idFromName(name);
  const stub = namespace.get(id);
  await stub.setName(name);   // ← the critical step
  return stub;
}
```

Skip the `setName` call and `this.name` stays undefined on the DO. Every `CF_AGENT_IDENTITY` message goes out with a missing name; every `onIdentity` callback fires with bad data; any client-side code that keys off `agent.name` breaks silently. The bug is easy to miss because the WebSocket connects fine and messages flow — only the identity channel is wrong.

This is the same pattern Cloudflare recommends in the SDK's own docs: *"Server must handle routing manually (e.g., with `getAgentByName` + `fetch`)"* when using `basePath` on the client. The generated `entry.ts` imports `getAgentByName` from `"agents"` (a peer dependency of the user's project) to honor this contract.

## Testing

Every file has a `.test.ts` sibling. The integration-ish tests in `scan.test.ts` and `migrations.test.ts` use `mkdtempSync` from `node:os` — no mocks. `wrangler.test.ts` and `entry.test.ts` operate on string output.

```sh
bun test src/codegen/
```
