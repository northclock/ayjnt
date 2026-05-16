---
name: ayjnt-troubleshoot
description: Diagnose and fix common ayjnt failures. Use when the user reports a specific symptom — "useAgent doesn't work", "compatibility date error", "lockfile divergence", "404 on /<route>", "wrangler refuses to deploy", "basePath gotcha", "agent state is undefined", "renamed an agent and lost storage", or "inter-agent RPC returns [object Object]". Maps each symptom to its root cause and the one-line fix. Most failures map to gotchas with known resolutions; don't speculate when the symptom matches one of these.
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

Don't hand-edit anything under `.ayjnt/` — every file there
(except `migrations.json`) regenerates on next build.
