# `src/` — framework internals

How the package is organized and how data flows through it.

## Layout

```
src/
├── cli/        # command entry points (ayjnt dev/build/deploy/migrate)
├── codegen/    # the pipeline: scan → diff → emit
├── core/       # shared types — the single contract between stages
└── runtime/    # public exports for user code (import ... from "ayjnt")
```

## Request lifecycle (runtime)

When a request hits a deployed worker:

```
Request
  │
  ▼
.ayjnt/dist/entry.ts     (generated — matchRoute by longest prefix)
  │
  ▼
env.<BINDING>.get(idFromName(instanceId))   (DO stub)
  │
  ▼
<user's agent.ts>.onRequest | onMessage | onConnect
```

The generated entry does NOT use Cloudflare's `routeAgentRequest`. We own dispatch so URL shape stays under our control — nested routing (`/admin/users/:id`), route groups (`agents/(public)/...`), and middleware chains all work cleanly.

## Build lifecycle (codegen)

Every `ayjnt dev | build | deploy` funnels through `src/cli/build.ts::runBuild`:

1. `scan(root)` — walk `agents/**/agent.ts`, produce a `Manifest`
2. `readLockfile(root)` — load `.ayjnt/migrations.json` (empty if first run)
3. `diffMigrations(lock, manifest)` — compute `MigrationDiff` (added / renamed / deleted)
4. `applyDiff` — produce the updated lockfile
5. `writeLockfile` — persist (unless deploy suppresses this)
6. `generateEntry` → `.ayjnt/dist/entry.ts`
7. `generateWrangler` → `.ayjnt/dist/wrangler.jsonc`

Each step is a pure function of its inputs. I/O lives at the edges (`scan`, `readLockfile`, `writeLockfile`, the file writes in `runBuild`). This makes every piece testable without mocks — see `src/codegen/*.test.ts`.

## Where things live

| I want to... | Go to |
|---|---|
| Add a new CLI command | [`cli/`](./cli/) — add a module, dispatch from `cli/index.ts` |
| Change how agents are discovered | [`codegen/scan.ts`](./codegen/scan.ts) |
| Change migration semantics | [`codegen/migrations.ts`](./codegen/migrations.ts) |
| Change generated wrangler config | [`codegen/wrangler.ts`](./codegen/wrangler.ts) |
| Change generated worker entrypoint | [`codegen/entry.ts`](./codegen/entry.ts) |
| Change a type flowing between stages | [`core/types.ts`](./core/types.ts) |
| Add a user-facing runtime helper | [`runtime/`](./runtime/) |

Deeper guides: [`cli/README.md`](./cli/README.md), [`codegen/README.md`](./codegen/README.md), [`runtime/README.md`](./runtime/README.md).

## Testing conventions

- Co-locate tests: `foo.ts` + `foo.test.ts`.
- Pure functions tested directly; I/O functions tested with `mkdtempSync` + `rmSync`.
- No mocking frameworks. Inputs are plain data; outputs are strings or plain data.
- `bun test` runs everything. ~50ms total for the full suite.

## Style

- Absolute paths are stored as absolute paths. Relative paths must declare what they're relative to.
- Types import type-only (`import type { ... }`) — `verbatimModuleSyntax` is on.
- Every file has a header comment saying what it does and how it fits into the pipeline. Keep those honest.
- Avoid dependencies. The only runtime deps are Bun built-ins and peer deps (`agents`, `wrangler`). Adding a dependency is a decision, not a reflex.
