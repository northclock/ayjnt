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
| [`scan.ts`](./scan.ts) | Walk `agents/**/agent.ts`, extract class/agentId, compute routes/bindings/middleware chains, detect `app.tsx` / `tools.ts` / `tools.host.ts` siblings and a root `cli.ts`. Produces `Manifest`. |
| [`cli.ts`](./cli.ts) | Emit `@ayjnt/cli` — the route-nested, camelized `agents` / `workflows` accessor types for a root-level `cli.ts`. Types only; the runtime objects are built by `../cli/host.ts` from the same manifest. Pure. |
| [`migrations.ts`](./migrations.ts) | Read/write `.ayjnt/migrations.json`. `diffMigrations` + `applyDiff` + `nextTag` + `formatDiff`. |
| [`wrangler.ts`](./wrangler.ts) | Emit the generated `wrangler.jsonc` string. Pure. |
| [`entry.ts`](./entry.ts) | Emit the generated worker entrypoint string (routes, middleware dispatch, HTML-vs-agent disambiguation). Pure. |
| [`client.ts`](./client.ts) | Generate `.ayjnt/tsconfig.json`, `env.d.ts`, per-agent typed `useAgent` hooks, and bundle `app.tsx` via `Bun.build`. |

## Contracts

All stages consume and produce types from [`../core/types.ts`](../core/types.ts).

### `Manifest`

The output of scanning. Agents are sorted alphabetically by `routePath` for stable output. Duplicates (same route, binding, or agentId) throw from `scan`.

### `MigrationLockfile`

Committed to git. Two things matter:

- **`migrations: MigrationEntry[]`** — append-only. Each entry carries wrangler's migration fields (`new_sqlite_classes`, `renamed_classes`, `deleted_classes`, `tag`) plus a lockfile-only `timestamp` for auditing. `generateWrangler` projects entries onto the wrangler-known fields — `timestamp` never reaches wrangler.jsonc (wrangler warns on unknown migration fields).
- **`classes: Record<agentId, {className, firstTag}>`** — the *derived* end-state after all migrations apply. Used to detect renames: if the same `agentId` reappears in a new manifest with a different `className`, it's a rename, not a delete + add.

If you change past entries, wrangler will refuse to migrate. Don't.

### `MigrationDiff`

What `diffMigrations` returns. Identity resolution, in order:

- same `agentId`, different `className` → **rename** (`renamed_classes`, storage preserved)
- different `agentId`, same `className` → **move** (a folder rename shifted the derived agentId; DO storage is keyed by class name, so no migration is emitted — only the lockfile key changes). Without this rule a plain folder rename emitted delete+create of the same class, which wrangler executes as "destroy all storage".
- otherwise added / deleted as expected.

`nextEntry` is `null` when no wrangler migration is needed; `diffChangesLockfile(diff)` is the "does anything need writing" signal (moves change the lockfile without a migration entry).

### Breaking change: instance ids are percent-decoded

The worker's route matcher (now in `src/runtime/router.ts`) percent-decodes URL segments before resolving the DO instance, and the generated `useAgent` hook mirrors it (deriving the decoded name, re-encoding it into `basePath`). `/chat/caf%C3%A9` therefore addresses the DO named `café`. Deployments created before this change addressed the raw segment (`caf%C3%A9`) — instances whose names contain non-ASCII, spaces, or other encoded characters must be reached by their raw name once (`useAgent({ name: "caf%C3%A9" })`) to migrate state. ASCII-only names are unaffected. See the `ayjnt-troubleshoot` skill for the user-facing symptom.

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

## Client-side generation (v0.3)

Beyond the worker bundle, codegen also produces files user code imports from:

```
.ayjnt/
├── tsconfig.json               ← path aliases (@ayjnt/*, @ayjnt/env)
├── env.d.ts                    ← GeneratedEnv type with every DO binding
└── client/
    ├── cli.ts                  ← @ayjnt/cli — typed context for a root cli.ts
    └── <route>/index.tsx       ← typed useAgent hook per agent
```

`client/cli.ts` is emitted unconditionally, even without a root `cli.ts` — the
types are useful while authoring one, and a types-only module costs nothing.
Because `@ayjnt/cli` resolves to `client/cli.ts`, which TypeScript prefers over
`client/cli/index.tsx`, an agent at `agents/cli/` would shadow it; `scan`-time
validation rejects that route name (see `assertNoReservedClientRoutes`).

User code imports via the `@ayjnt/*` alias defined in the generated tsconfig. The alias maps `@ayjnt/chat` → `.ayjnt/client/chat/index.tsx`. Users either `extends` the generated tsconfig or inline the paths (see main README).

### Why generate per-agent hooks instead of one generic helper

We could ship a single `useAgent<AgentClass>({ route, name })` helper in the runtime. We don't, because:

1. **URL-derived `basePath`.** The hook inspects `window.location.pathname` to figure out the instance name. Per-agent generation lets us bake the route prefix in — a generic helper would require the user to pass it every time, and get it right.
2. **Default state inference.** `InstanceType<typeof AgentClass>["state"]` gives us the default State type for the hook. Generic would require the user to pass it.
3. **Compile-time discoverability.** `@ayjnt/chat` either exists (the agent is in the manifest) or doesn't (you forgot to add `agents/chat/`). A generic helper couldn't offer this check.

The cost is a per-agent file instead of one shared helper. Cheap.

### Bundling `app.tsx`

`bundleApp()` in `client.ts` calls `Bun.build` with `target: "browser"` on each agent's `app.tsx`. The output ES module is inlined as a string into the HTML shell, which is in turn inlined into `entry.ts` as a map from binding → HTML. One `<script type="module">…</script>` per agent, no asset fetching, no CORS.

Gotchas in the bundler path:

- **Order matters.** We generate `.ayjnt/client/<route>/index.tsx` *before* calling `Bun.build`, because the user's `app.tsx` imports from `@ayjnt/<route>` which resolves to that file. Bundling first → unresolved import.
- **Tree-shaking is per-agent.** Each agent's bundle includes its own copy of React + agents/react. Two agents with `app.tsx` = ~2× the bundle size. Acceptable for v0.3; an Assets-binding-backed approach (shared chunks, browser caching) is future work.
- **Worker size limit.** Cloudflare Workers bundle limit is 10 MB. Inlining bundles is fine until you have ~20 agents with full React UIs. At that point, move to `@cloudflare/workers-types` Assets binding.

### Why `html_handling: "none"` matters

The generated wrangler config sets `html_handling: "none"` on the Assets binding. That's a bug-avoidance flag, not a preference.

Cloudflare Assets' default (`auto-trailing-slash`) issues a **301 redirect** from `/foo/bar/index.html` → `/foo/bar/`. It's an SEO nicety for static sites. For us, it breaks:

1. Browser navigates to `/counter/room-1` (HTML request).
2. Worker matches the route, calls `env.ASSETS.fetch(new Request("/__ayjnt/counter/index.html", request))`.
3. Assets binding returns a **301 to `/__ayjnt/counter/`**.
4. Worker forwards that 301 to the browser.
5. Browser follows the redirect. URL bar now reads `/__ayjnt/counter/`.
6. Assets binding serves the HTML there (trailing slash → `index.html`). Content renders.
7. The generated `useAgent` hook reads `window.location.pathname = "/__ayjnt/counter/"`, sees it doesn't start with `/counter`, falls back to `"default"` instance.
8. Every user is now on `/counter/default` regardless of which URL they originally visited.

`html_handling: "none"` disables the rewrite so step 3 returns a plain `200 text/html`, the worker forwards it unchanged, and the browser URL stays at the user's original `/counter/room-1`.

Worth reading the config comment in `wrangler.ts` before changing this.

### HTML-vs-agent routing in `entry.ts`

```ts
if (shell && isHtmlRequest(request)) {
  return new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" }});
}
// otherwise, forward to the DO
```

Where:

```ts
function isHtmlRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return false;
  return (request.headers.get("accept") ?? "").includes("text/html");
}
```

Order matters: check `Upgrade: websocket` *before* `Accept` because some browsers set both on WS upgrade requests.

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
