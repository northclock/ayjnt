---
name: ayjnt-compile
description: Run an ayjnt app on its own local runtime and pack it into a single-file executable. Use when the user asks to "compile", "make a binary", "ship a CLI", "run this without wrangler", "distribute the agent", "bundle workerd", "ayjnt run vs ayjnt dev", or asks why a compiled binary behaves differently from `wrangler dev`. Covers `ayjnt run`, `ayjnt compile`, their flags, where Durable Object state is persisted, and the features that do NOT survive compilation (browser tools, remote Cloudflare services, cross-compiling without the matching workerd).
---

# Run and compile an ayjnt app

Two commands, one code path. `ayjnt run` boots the app on ayjnt's own
local runtime; `ayjnt compile` packs that same runtime into an
executable. The invariant worth remembering:

> A compiled binary behaves identically to `ayjnt run`.

Compile changes where inputs come from, never what happens to them.

## `ayjnt run`

Codegen, bundle with wrangler, boot a local workerd, then invoke the
root-level `cli.ts` in the foreground. When `cli.ts` returns (or you
Ctrl-C), everything stops — workerd included. With no `cli.ts`, it
serves until interrupted.

```sh
ayjnt run                          # serve, or run cli.ts if present
ayjnt run -- list --json           # args after `--` reach cli.ts as argv
ayjnt run --port 0                 # 0 picks a free port
ayjnt run --allow-host-writes -- import notes.txt
```

| Flag | Meaning |
|---|---|
| `--cwd <path>` | Project root (default: `process.cwd()`). |
| `--port <n>` | Port to bind. Default `8787`; `0` picks a free one. |
| `--data-dir <path>` | Override where Durable Object state is persisted. |
| `--allow-host-writes` | Permit host tools declaring `sideEffects: "write"`. |
| `--allow-host-exec` | Permit host tools declaring `sideEffects: "exec"`. |

Everything after `--` is passed to `cli.ts` as `argv`.

## `run` vs `dev` — pick the right one

`ayjnt dev` is unchanged: a thin wrapper around `wrangler dev`, with all
of wrangler's own behavior. The distinction that actually matters:

| | `ayjnt dev` | `ayjnt run` |
|---|---|---|
| Runtime | wrangler owns it | ayjnt owns it (Miniflare + workerd) |
| Runs `cli.ts` | **No** | Yes, in the foreground |
| In-process agent access | **None** | Real Durable Object RPC |
| Host tools (`tools.host.ts`) | No | Yes |
| Browser tools (`ayjnt/browser`) | Yes | **No** — see limitations |
| Same code path as a binary | No | **Yes** |

Reach for `dev` for ordinary iteration on a worker you're going to
deploy. Reach for `run` when you want `cli.ts`, host tools, or a
faithful preview of the compiled binary.

## `ayjnt compile`

```sh
ayjnt compile                             # → ./<worker-name>
ayjnt compile --outfile dist/notes
ayjnt compile --target bun-linux-x64
ayjnt compile --no-embed-workerd --minify
```

| Flag | Meaning |
|---|---|
| `--cwd <path>` | Project root. |
| `--outfile <path>` | Output path. Default `./<worker-name>` from the generated config. |
| `--target <bun-target>` | Bun compile target, e.g. `bun-linux-x64`. |
| `--no-embed-workerd` | Leave workerd out (~67MB). The binary then needs `AYJNT_WORKERD_PATH`. |
| `--bytecode` | Precompile to bytecode for faster startup. |
| `--minify` | Minify the embedded JavaScript. |

The default output is **~170MB**: ≈57MB Bun + ≈103MB workerd + your
app code. That's the honest cost of shipping two runtimes in one file.
What it needs to run: nothing. No Bun, no `node_modules`, no wrangler.

## How compile works

Three stages, in order:

1. **Codegen** — the same `.ayjnt/` tree `ayjnt build` writes.
2. **Real wrangler bundles the worker** — `deploy --dry-run --outdir`,
   run while `node_modules` is still available. This is deliberate: the
   bundle gets wrangler's own esbuild plus the unenv `nodejs_compat`
   treatment. **The framework never bundles worker code itself**, so
   bundling fidelity stays out of the risk surface.
3. **`bun build --compile`** embeds the worker script, the assets tree,
   `cli.ts`, every `tools.host.ts`, and (by default) the workerd binary.

### Why the `workerd` module gets aliased

`miniflare` does a top-level `require("workerd")`, and that package
resolves its native binary through `require.resolve` **at module-load
time**. Inside a compiled binary there is no `node_modules`, so the
import throws `Cannot find package 'workerd'` before miniflare's own
override is ever consulted.

**Setting `MINIFLARE_WORKERD_PATH` is therefore NOT sufficient.** The
compile step aliases the `workerd` module to a generated stub that
reports the path the bootstrap extracted to. This is the main reason
to compile with `ayjnt compile` rather than hand-rolling a
`bun build --compile`.

A second, smaller reason: `import()` can't reach into a binary, so
`cli.ts` and `tools.host.ts` must be imported *statically* by a
generated bootstrap for Bun's bundler to see them.

## Running the binary

workerd extracts once into a per-app cache keyed by version; after
that, startup is sub-second.

The binary claims only three flags for itself — **everything else
becomes `cli.ts` `argv`**:

```sh
./notes --port 9000 add "hello"        # --port is the app's; the rest is argv
./notes --allow-host-writes tool appendToLog '{"line":"hi"}'
./notes --allow-host-exec build
```

## Where state lives

Durable Object state persists per-app in the OS state directory, keyed
by worker name so two apps never share storage:

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/ayjnt/<worker>` |
| Linux | `$XDG_STATE_HOME/ayjnt/<worker>`, else `~/.local/state/ayjnt/<worker>` |
| Windows | `%LOCALAPPDATA%\ayjnt\<worker>` |

Override with `--data-dir <path>`, accepted by both `ayjnt run` and a
compiled binary, or with `AYJNT_DATA_DIR`.

A compiled binary claims exactly four flags for itself — `--port`,
`--data-dir`, `--allow-host-writes`, `--allow-host-exec` — and passes
everything else to `cli.ts` as `argv`. If your `cli.ts` wants a flag of
the same name, put it after `--`:

```sh
./my-app --port 9000 -- --port-of-my-own 1234
```

**State survives across runs** — a compiled ayjnt app is a shipped
program, not a dev server, so this is not `.wrangler/state` and not a
temp dir.

## Limitations — state these plainly to the user

- **Browser tools don't work.** `ayjnt/browser` needs a
  `worker_loaders` binding, and Miniflare has no equivalent. Compile
  warns about it; everything else in the app still works. Use
  `ayjnt dev` or a deployed worker for browser tools.
- **Workers AI, Browser Rendering, and email sending are remote
  services.** The binary is self-contained *as a runtime*, but these
  still need network access and Cloudflare credentials.
- **Cross-compiling needs the target's workerd.** `--target` swaps
  Bun's runtime, but the embedded workerd is a native binary that must
  match the *target* platform. Only the host's
  `@cloudflare/workerd-<platform>` is installed by default, so compile
  fails loudly with install instructions rather than producing a binary
  that dies on first launch:

  ```sh
  bun add -d @cloudflare/workerd-linux-64
  ayjnt compile --target bun-linux-x64
  ```

- **macOS distribution needs codesigning** — for both the outer binary
  and the workerd it extracts.
- **Host tools work here and only here.** `ayjnt deploy` refuses a
  project containing `tools.host.ts`. See
  [`ayjnt-tools`](../ayjnt-tools/SKILL.md).

## Related

- [`ayjnt-cli-file`](../ayjnt-cli-file/SKILL.md) — authoring the
  `cli.ts` that `run` and the binary invoke.
- [`ayjnt-tools`](../ayjnt-tools/SKILL.md) — `tools.ts` vs
  `tools.host.ts`, and the permission model behind
  `--allow-host-writes`.
- [`examples/compiled-cli`](../../../examples/compiled-cli) — an app
  with agents, both kinds of tools, and a `cli.ts`, in one binary.
