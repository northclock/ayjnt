# `src/` — framework internals

How the package is organized and how data flows through it.

## Layout

```
src/
├── cli/        # command entry points, plus the local runtime (host.ts, run.ts)
├── codegen/    # the pipeline: scan → diff → emit
├── core/       # shared types — the single contract between stages
└── runtime/    # public exports for user code (import ... from "ayjnt")
```

There are two execution targets, and the distinction runs through the whole
package:

- **Deployed** (`ayjnt deploy`) — the generated worker runs on Cloudflare. This
  is the original and only target the codegen pipeline cares about.
- **Local** (`ayjnt run`, `ayjnt compile`) — the same worker runs under a workerd
  that *we* own, in a Bun process that also runs the user's `cli.ts` and any
  `tools.host.ts`. That Bun process is the "host", and it can do things workerd
  cannot: filesystem, subprocesses, native SQLite.

The host is what `cli/host.ts` builds, and it's why `core/hostBridge.ts` exists —
that module is the one wire format shared by both sides of the workerd↔host
boundary, imported by worker-bundled code (`runtime/tools.ts`) and host code
(`cli/hostTools.ts`) alike so the protocol can't drift.

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
8. `generateEnvTypes` / `generateCliTypes` → ambient environment,
   workflow registry, and project-specific CLI declarations
9. `bundleApp` → generated React hooks and Assets-binding files

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
| Change `Agent<State>`, class-safe RPC, workflows, sessions, or clients | [`runtime/`](./runtime/) plus the generated relationships in [`codegen/`](./codegen/) |
| Change how the local runtime is configured | [`cli/host.ts`](./cli/host.ts) — wrangler config → Miniflare options |
| Change the `cli.ts` context | [`runtime/cliContext.ts`](./runtime/cliContext.ts) for the types, [`cli/host.ts`](./cli/host.ts) for the objects, [`codegen/cli.ts`](./codegen/cli.ts) for the generated view |
| Change the workerd↔host tool protocol | [`core/hostBridge.ts`](./core/hostBridge.ts) — both sides import it |
| Change what goes into a compiled binary | [`cli/compile.ts`](./cli/compile.ts) — it generates the bootstrap module |

Deeper guides: [`cli/README.md`](./cli/README.md), [`codegen/README.md`](./codegen/README.md), [`runtime/README.md`](./runtime/README.md).

## Testing conventions

- Co-locate tests: `foo.ts` + `foo.test.ts`.
- Pure functions tested directly; I/O functions tested with `mkdtempSync` + `rmSync`.
- No mocking frameworks. Inputs are plain data; outputs are strings or plain data.
- `bun test` runs the complete suite, including generated-source
  assertions and local-runtime behavior.

## Style

- Absolute paths are stored as absolute paths. Relative paths must declare what they're relative to.
- Types import type-only (`import type { ... }`) — `verbatimModuleSyntax` is on.
- Every file has a header comment saying what it does and how it fits into the pipeline. Keep those honest.
- Avoid dependencies. Runtime code primarily uses Bun built-ins,
  `wrangler`, and peer APIs from `agents`, `ai`, and `zod`. Adding a
  dependency is a decision, not a reflex.
