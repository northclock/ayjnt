---
name: ayjnt-troubleshoot
description: Diagnose and fix common ayjnt failures. Use when the user reports a specific symptom — "useAgent doesn't work", "compatibility date error", "lockfile divergence", "404 on /<route>", "wrangler refuses to deploy", "basePath gotcha", "agent state is undefined", "renamed an agent and lost storage", "inter-agent RPC returns [object Object]", "Cannot find package 'workerd'", "host tool file(s) would not work in production", "does not exist in workerd", "declares sideEffects", browser tools failing in a compiled binary, or an agent method throwing without a message when called from cli.ts. Maps each symptom to its root cause and the one-line fix. Most failures map to gotchas with known resolutions; don't speculate when the symptom matches one of these.
---

# Troubleshoot ayjnt failures

Symptoms below are mapped to root causes. Match exactly; if the
user's symptom doesn't appear here, fall back to first-principles
debugging.

## "This Worker requires compatibility date '…' but the newest date supported is '…'"

**Cause.** Build clock outran the installed wrangler's bundled
workerd. Pre-v0.6 ayjnt defaulted to `today()` (clock-derived);
v0.6+ pins to a tested compatibility date.

**Fix.** Bump the framework. If the user needs an even newer date
than the framework's pin, set the env var at build time:

```sh
AYJNT_COMPATIBILITY_DATE=2026-04-01 bun run dev
```

(Override falls through to `generateWrangler`'s `compatibilityDate`
option.)

## `ayjnt deploy` refuses — "lockfile would diverge"

**Cause.** `.ayjnt/migrations.json` is the committed source of truth
for what's in production. The build pipeline would write a new
migration entry, but it's not committed — deploying would create a
new prod migration history that diverges from git.

**Fix.**

```sh
bun run migrate     # preview the pending entry
bun run build       # write it to .ayjnt/migrations.json
git add .ayjnt/migrations.json && git commit -m "stage migration v<N>"
bun run deploy
```

`--force` exists for emergency hotfixes but is loud about bypassing
the check.

## "404 on /<route>"

Several possible causes — match the specific shape:

- **No `agent.ts` in the folder** — only folders with an `agent.ts`
  become agents. Add the file.
- **`/route` with no instance** returns `"default"` (since v0.7). If
  the user is on an older build, that returned 404. Bump the
  framework.
- **Route group folder name appeared in the URL** — folder names in
  `(parens)` are stripped. Check `agents/(public)/status/agent.ts`
  is at `/status`, not `/(public)/status`.
- **Wrong base class.** `extends McpAgent` dispatches via
  `McpAgent.serve()` and doesn't use the `/<route>/<instance>`
  scheme. Curl-ing it without proper MCP framing returns 404 or
  the MCP transport's own error.

## "useAgent doesn't work" / TypeScript can't find `@ayjnt/<route>`

**Cause.** Path alias not resolving. `@ayjnt/<route>` resolves to
`.ayjnt/client/<route>/index.tsx`, which is generated on each build.

**Fix.**

1. Run `bun run build` so `.ayjnt/client/<route>/index.tsx` exists.
2. Check `tsconfig.json` either extends `./.ayjnt/tsconfig.json` or
   inlines:
   ```json
   "paths": {
     "@ayjnt/env": ["./.ayjnt/env.d.ts"],
     "@ayjnt/*": ["./.ayjnt/client/*"]
   }
   ```

## "Agent state is `undefined` on first render"

**Cause.** Not a bug — `agent.state` is `undefined` until the first
`CF_AGENT_STATE` message arrives over WebSocket.

**Fix.** Optional-chain with `??` fallbacks:

```tsx
const count = agent.state?.count ?? 0;
```

Or render a loading state guarded on `agent.state`:

```tsx
if (!agent.state) return <Loading />;
return <Counter count={agent.state.count} />;
```

## "basePath" / client SDK calls go to the wrong URL

**Cause.** The Cloudflare Agents client SDK defaults to
`/agents/<kebab-class-name>/<instance>`. ayjnt exposes agents at
`/<route-path>/<instance>` — different URL shape.

**Fix.** Pass `basePath` to every client call. The framework's
generated `useAgent()` does this already; manual `agentFetch` /
`useAgent` calls need to override:

```ts
import { agentFetch } from "agents/client";
await agentFetch(
  { agent: "ChatAgent", basePath: `chat/${roomId}`, host },
  { method: "POST", body: JSON.stringify({ text: "hi" }) },
);
```

Or use the generated typed hook (`@ayjnt/<route>`), which handles
this for you.

## "Inter-agent RPC returns `[object Object]` in the response"

**Cause.** The callee threw; the caller's `onRequest` didn't catch,
so the worker returned a plain-text 500 stack. The client did
`res.json()`, which crashed.

**Fix.** Wrap RPC calls at the HTTP boundary and translate to a
structured response:

```ts
try {
  const result = await inv.decrement(sku, qty);
  return Response.json({ ok: true, result });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ ok: false, error: message }, { status: 409 });
}
```

## "`.dev.vars` at the project root is ignored by wrangler"

**Cause.** Wrangler resolves `.dev.vars` relative to the directory
containing `wrangler.jsonc` (called `configDir`), **not** to its
working directory. ayjnt's generated config lives in `.ayjnt/dist/`,
so without intervention wrangler only sees a `.dev.vars` that's
inside `.ayjnt/dist/` — and the user's project-root copy never makes
it through.

**Fix (automatic).** Framework v0.5.4+ mirrors every project-root
`.dev.vars` and `.dev.vars.<env>` into `.ayjnt/dist/` on each build,
using a **relative symlink** so edits to the source file propagate
live (no rebuild needed for secret changes). Stale mirrors are
cleaned up automatically when the project-root file is deleted.
On filesystems that refuse symlinks (Windows without developer mode
→ `EPERM`), the build falls back to a copy and warns that
mid-session secret edits won't auto-reload.

**Verify.** After `ayjnt build` or `ayjnt dev`:

```sh
ls -la .ayjnt/dist/.dev.vars
# lrwxr-xr-x  …  .ayjnt/dist/.dev.vars -> ../../.dev.vars
```

If you see the symlink, wrangler is loading your secrets.

If the file is missing from `.ayjnt/dist/`:
1. Confirm `.dev.vars` exists at the project root (not under any
   subdirectory).
2. Confirm the filename isn't `.dev.vars.example` (sample files are
   intentionally skipped — they're checked-in templates, not real
   secrets).
3. Re-run `bun run build`.

## "Renamed an agent class and lost storage"

**Cause.** When `agentId` isn't pinned, the default ID derives from
folder path + class name. A class rename without a pinned `agentId`
looks like a delete + add to the migration diff — storage is destroyed.

**Fix (preventative).** Pin `agentId` from the start:

```ts
export const agentId = "chat_v1";
export default class ChatAgent extends Agent<GeneratedEnv> { /* … */ }
```

After that, class renames become storage-preserving rename migrations.

**Fix (after the fact).** If the rename hasn't been deployed yet,
revert and pin `agentId` before re-running build. If it's already
in prod, the data is gone — restore from backup if you have one.

Note: a plain FOLDER rename (class name unchanged) is safe even
without a pinned `agentId` — the migration differ recognises it as a
move and preserves storage. A simultaneous folder + class rename is
the case that needs the pinned id.

## "Cannot find package 'workerd'" from a compiled binary

**Cause.** The `workerd` npm module wasn't aliased at bundle time.
`miniflare` does a top-level `require("workerd")`, and that package
resolves its native binary through `require.resolve` **at module-load
time** — there's no `node_modules` inside a binary, so it throws before
miniflare's own override is consulted. This happens when compiling
outside `ayjnt compile` (a hand-rolled `bun build --compile`).

**Fix.** Compile with `ayjnt compile`. It aliases the module to a
generated stub that reports the extracted path.

Note: **`MINIFLARE_WORKERD_PATH` alone does not fix this** — the import
fails before the env var is ever read.

## "Browser tools fail under `ayjnt run` or in a compiled binary"

**Cause.** `ayjnt/browser` needs a `worker_loaders` binding, and
Miniflare has no equivalent. `ayjnt run` and `ayjnt compile` both warn
about this; everything else in the app works.

**Fix.** Use `ayjnt dev` or a deployed worker for browser tools. If the
app needs both, gate the browser path so the local runtime skips it.

## "cannot deploy: N host tool file(s) would not work in production"

**Cause.** The project has one or more `agents/<route>/tools.host.ts`.
Those functions run in the Bun process hosting the local runtime; a
deployed Cloudflare worker has no host process, so they'd have nowhere
to run. The deploy fails rather than silently shipping an agent with
different capabilities than it had locally.

**Fix.** Pick one:

1. Move the tools into `agents/<route>/tools.ts` to run them in workerd
   (losing `Bun.$`, `Bun.file`, `bun:sqlite` and node APIs).
2. Ship with `ayjnt compile` instead of deploying.
3. Add the comment marker `@ayjnt-optional-on-deploy` to the file — its
   tools are omitted from the deployed ToolSet instead of blocking the
   deploy. Safe because `agentTools()` only builds host proxies when the
   bridge is bound, so a deployed agent degrades rather than erroring.

See [`ayjnt-tools`](../ayjnt-tools/SKILL.md).

## "An agent method throws, but `cli.ts` gets no message"

**Cause.** A Miniflare limitation, not a framework bug: exceptions from
**host-initiated** Durable Object calls lose their body. workerd returns
a 4xx for an application error and the proxy asserts on the status
before reading the body, so the real message is discarded upstream. The
framework detects the assertion and substitutes an explanatory error,
but it cannot recover the original text. Worker-to-DO calls are
unaffected — this is specific to calling in from the host, which is what
`cli.ts` does.

**Fix.** Return results instead of throwing:

```ts
async runTool(name: string, input: unknown):
  Promise<{ ok: true; result: unknown } | { ok: false; error: string }>
{
  try {
    return { ok: true, result: await run(name, input) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

Or call the method over HTTP with `agents.<route>(...).fetch()`, where
errors propagate normally. Logging inside the agent method also works.

## Build fails: "uses `Bun.file`, which does not exist in workerd"

**Cause.** An `agents/<route>/tools.ts` reaches for a Bun-only global.
That file runs **inside workerd**, next to the agent. The scanner
catches it at build time rather than letting it throw
`Bun is not defined` on the first tool call.

**Fix.** Rename the file to `tools.host.ts` so the functions run on the
Bun host instead. Host tools can't be deployed to Cloudflare — see the
deploy entry above. Comments merely *mentioning* `Bun.file` are fine;
the check runs on stripped source.

## Host tool refused: "declares sideEffects: \"write\""

**Cause.** Host tools above `read` need explicit permission, because
their arguments come from model output.

**Fix.** Pass the matching flag, or set the env var for
non-interactive runs (CI, a compiled binary you can't re-flag):

```sh
ayjnt run --allow-host-writes -- import notes.txt
./notes --allow-host-exec build
AYJNT_ALLOW_HOST_EFFECTS=write,exec ./notes tool appendToLog '{"line":"hi"}'
```

On an interactive TTY you'll instead get a y/N confirm, remembered per
tool for the session. With no TTY and no permission, the call is refused.

## A binary built with `--no-embed-workerd` won't start

**Cause.** That flag trades ~100MB of binary size for self-containment —
the workerd binary isn't inside it, so the host has to supply one.

**Fix.** Point it at a workerd binary:

```sh
AYJNT_WORKERD_PATH=/path/to/workerd ./notes list
```

Or rebuild without the flag (`ayjnt compile`) to embed it.

## "Upgraded ayjnt and an instance with a non-ASCII / space / encoded name lost its state"

**Cause.** Since the routing rework, the worker percent-DECODES URL
segments before resolving the Durable Object instance: `/chat/caf%C3%A9`
now addresses the DO named `café`. Older versions used the raw segment,
so the same URL used to address a DO literally named `caf%C3%A9` —
a different object. Plain-ASCII instance names are unaffected.

**Fix.** Reach the old object by its raw (encoded) name explicitly —
`useAgent({ name: "caf%C3%A9" })` or double-encode the URL segment
(`/chat/caf%25C3%25A9`) — and migrate its state to the new name once.

## When in doubt

```sh
# What was actually generated?
cat .ayjnt/dist/entry.ts          # worker entry
cat .ayjnt/dist/wrangler.jsonc    # bindings + migrations
cat .ayjnt/migrations.json        # committed lockfile
ls -la .ayjnt/assets/__ayjnt/*    # bundled UI assets

# Force a clean regen
rm -rf .ayjnt/dist .ayjnt/assets .ayjnt/client && bun run build
```

For the local runtime (`ayjnt run` / a compiled binary), state lives
outside the project — `~/Library/Application Support/ayjnt/<worker>` on
macOS, `$XDG_STATE_HOME`/`~/.local/state/ayjnt/<worker>` on Linux,
`%LOCALAPPDATA%\ayjnt\<worker>` on Windows. Point it somewhere
disposable to start clean:

```sh
ayjnt run --data-dir /tmp/scratch-state
```

Don't hand-edit anything under `.ayjnt/` — every file there
(except `migrations.json`) regenerates on next build.
