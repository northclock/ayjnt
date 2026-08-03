---
name: ayjnt-troubleshoot
description: Diagnose and fix common Ayjnt failures. Use for generated-hook resolution, compatibility dates, migration lock divergence, route 404s, basePath mistakes, missing initial state, ambiguous renames, class-registry or workflow-registry errors, lost RPC errors, compiled workerd failures, host-tool deployment restrictions, runtime mismatches, and permission errors. Match known symptoms before speculating.
---

# Troubleshoot ayjnt failures

Symptoms below are mapped to root causes. Match exactly; if the
user's symptom doesn't appear here, fall back to first-principles
debugging.

## "This Worker requires compatibility date '…' but the newest date supported is '…'"

**Cause.** The generated compatibility date is newer than the
installed wrangler/workerd combination supports. Current Ayjnt
releases pin a tested date instead of deriving one from the clock.

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
- **`/route` with no instance** resolves the `"default"` instance.
  If it does not, regenerate with the current framework and inspect
  `.ayjnt/dist/entry.ts`.
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

**Fix.** Prefer the generated `useAgent()` hook or `AgentClient` from
`ayjnt/client`; both understand file routes. When deliberately using
the upstream client, pass `basePath`:

```ts
import { agentFetch } from "agents/client";
await agentFetch(
  { agent: "ChatAgent", basePath: `chat/${roomId}`, host },
  { method: "POST", body: JSON.stringify({ text: "hi" }) },
);
```

Or use the generated typed hook (`@ayjnt/<route>`), which handles
this for you.

## "`TargetAgent` is not in the generated agent registry"

**Cause.** `this.agent(TargetAgent, name)` received a class that the
latest codegen did not discover, or generated output is stale.

**Fix.**

1. Default-export the target class from `agents/<route>/agent.ts`.
2. Import it as a value, not `import type`.
3. Run `bun run build` or restart `bun run dev`.
4. Inspect `.ayjnt/dist/entry.ts` for the constructor-to-binding map.

Do not replace the class with a guessed binding or route string.

## "`this.workflow()` has no co-located workflow"

**Cause.** The agent has no sibling `workflow.ts`, the workflow class
is not its default export, or generated output predates the file.

**Fix.** Put `workflow.ts` beside `agent.ts`, default-export
`AgentWorkflow<Params>`, and regenerate. Use `runWorkflow(binding,
params)` only for an intentionally non-co-located workflow.

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

**Fix (automatic).** Ayjnt mirrors every project-root
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

**Cause.** An ambiguous refactor changed both the path-derived
`agentId` and class name, so the migration differ could not associate
the new class with the old storage identity.

**Fix (preventative).** Pin `agentId` from the start:

```ts
export const agentId = "chat_v1";
export default class ChatAgent extends Agent { /* … */ }
```

After that, class renames become storage-preserving rename migrations
and folder changes retain the explicit identity.

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
