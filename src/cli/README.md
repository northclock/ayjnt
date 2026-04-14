# `src/cli/` — command entry points

Each file here implements one user-facing command. `index.ts` is the router. Thin wrappers — all real work happens in [`../codegen/`](../codegen/) via `runBuild()`.

## Commands

| File | Command | What it does |
|---|---|---|
| [`build.ts`](./build.ts) | `ayjnt build` | The codegen pipeline. Also exports `runBuild()` used by dev/deploy. |
| [`dev.ts`](./dev.ts) | `ayjnt dev` | `runBuild` + spawns `wrangler dev`. |
| [`deploy.ts`](./deploy.ts) | `ayjnt deploy` | Git-safety checks + `runBuild({writeLockfile: false})` + spawns `wrangler deploy`. |
| [`migrate.ts`](./migrate.ts) | `ayjnt migrate` | Dry-run diff. Doesn't write, doesn't deploy. |
| [`util.ts`](./util.ts) | — | Shared arg parser and wrangler spawner. |
| [`index.ts`](./index.ts) | — | Command dispatch. |

## Arg forwarding

`parseArgs` recognizes two ayjnt-owned flags:

- `--cwd <path>` — project root (default: `process.cwd()`)
- `--force` — bypass git safety checks on deploy

Everything else is forwarded to `wrangler`. You don't need a `--` separator:

```sh
ayjnt dev --port 8787             # --port forwarded to wrangler dev
ayjnt deploy --env staging        # --env forwarded to wrangler deploy
ayjnt dev --cwd my-app --port 8787   # --cwd consumed, --port forwarded
```

An explicit `--` still works for disambiguation:

```sh
ayjnt dev -- --force   # wrangler's --force, not ayjnt's
```

## Adding a new command

1. Create `src/cli/<name>.ts` exporting `async function <name>(argv: string[]): Promise<void>`
2. Wire it into `src/cli/index.ts`'s switch
3. Document the command in the top-level [`README.md`](../../README.md#commands) and in the `USAGE` string in `src/cli/index.ts`
4. If the command needs a new piece of the pipeline (rare), add it in [`../codegen/`](../codegen/) and call it from your command

Commands should do essentially nothing — parse args, call into `codegen/` or `runBuild`, shell out to wrangler.

## Exit codes

- `0` — success
- `1` — ayjnt-side error (thrown from a command)
- wrangler's exit code — passed through when a wrangler subprocess exits non-zero

## Safety: the deploy rails

`deploy.ts::assertGitReady` enforces the contract that the migration lockfile shipping to Cloudflare is committed and pushed. In order:

1. `git status --porcelain` empty (no uncommitted changes)
2. Local HEAD equals `origin/<branch>` (no unpushed / unpulled commits)
3. `runBuild({writeLockfile: false})` must not stage a new migration — if it would, reject with "run `ayjnt build`, commit the lockfile, try again"

`--force` skips all three. It's intentionally loud because the whole point of this machinery is to make divergent-migration races impossible.

If git isn't available or no `origin/<branch>` exists, the checks degrade to warnings rather than failures — solo deploys from a brand-new repo should still work.
