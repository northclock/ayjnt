---
name: ayjnt-tools
description: Give an agent per-route model tools in workerd or on the Bun host. Use when the user asks to add tools, read local files, run shell commands, use tools.host.ts, hostTool, or sideEffects, or when a build reports a Bun API missing from workerd or a deploy rejects host tools. Covers worker and host tool files, their merged ToolSet, permission gates, and prompt-injection risk.
---

# Per-route model tools

Tools are collections of functions an agent hands a model as tool calls.
Two runtimes, **chosen by filename**:

```
agents/<route>/
  agent.ts
  tools.ts         # → workerd, next to the agent. Deploys normally.
  tools.host.ts    # → Bun host process. Compile-only.
```

There is deliberately **no `"use host"` directive**. The filename
already says which runtime a file targets; a directive would be
redundant ceremony that can disagree with the path.

## Workerd-side: `tools.ts`

Plain AI-SDK tools. Deploys to Cloudflare like any other worker code.

```ts
// agents/notes/tools.ts
import { tool } from "ai";
import { z } from "zod";

export const countWords = tool({
  description: "Count the words in a piece of text.",
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => ({
    words: text.trim().split(/\s+/).filter(Boolean).length,
    characters: text.length,
  }),
});
```

**Rule of thumb:** if a tool only needs the agent's own state, the
network, or plain computation, it belongs here. Reach for
`tools.host.ts` only when a tool genuinely needs the local machine.

## Host-side: `tools.host.ts`

```ts
// agents/notes/tools.host.ts
import { confinePath, hostTool } from "ayjnt/tools";
import { z } from "zod";

const ROOT = process.cwd();

export const readProjectFile = hostTool({
  description: "Read a UTF-8 text file from the project directory.",
  sideEffects: "read",
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ path }: { path: string }) => {
    const file = Bun.file(confinePath(ROOT, path));
    if (!(await file.exists())) throw new Error(`no such file: ${path}`);
    return { path, text: await file.text() };
  },
});

export const listProjectFiles = hostTool({
  description: "List the files in the project directory.",
  sideEffects: "read",
  inputSchema: z.object({}),
  execute: async () => ({
    files: (await Bun.$`ls -1`.cwd(ROOT).text()).trim().split("\n").filter(Boolean),
  }),
});
```

The `execute` body never reaches workerd. The host imports the module
directly; the worker receives only `description` + `inputSchema` so it
can advertise the tool and proxy calls back. That's what buys `Bun.$`,
`Bun.file`, `bun:sqlite` and node APIs.

## Merge at the call site

Both kinds converge on the AI-SDK `ToolSet` shape, so they spread
together with everything else:

```ts
// agents/notes/agent.ts
import { Agent } from "ayjnt";
import { agentTools } from "ayjnt/tools";
import { browserTools } from "ayjnt/browser";

export default class NotesAgent extends Agent<State> {
  async ask(prompt: string) {
    const tools = { ...browserTools(this), ...agentTools(this) };
    return await generateText({ model, tools, messages: [/* … */] });
  }
}
```

`agentTools(this)` returns one merged ToolSet: the `tools.ts` exports
run inside workerd, and the `tools.host.ts` exports are proxied out to
the host process. **The agent doesn't know about the split.** It returns
`{}` when there are no tools, so it's always safe to spread.

## Host tool names namespace by route

`hostToolName` flattens the route and joins with `__`:

| Export in | Tool name |
|---|---|
| `agents/notes/tools.host.ts` → `readProjectFile` | `notes__readProjectFile` |
| `agents/admin/jobs/tools.host.ts` → `restart` | `admin_jobs__restart` |

Nested routes flatten with `_`. Worker-side tools win a name collision —
they deploy with the agent, so they're the less surprising winner.

## Build-time guard

A `tools.ts` that reaches for `Bun.file`, `Bun.$` or `bun:sqlite` fails
the build with a pointer at `tools.host.ts`, rather than compiling fine
and throwing `Bun is not defined` inside workerd on the first tool call.
Comments *mentioning* them are fine — the check runs on stripped source.

## `sideEffects` is required

Every host tool declares one of `"read" | "write" | "exec"`. Not
defaulted — a default would silently pick a trust level on the author's
behalf.

| Level | To permit it |
|---|---|
| `read` | Always allowed. |
| `write` | `--allow-host-writes`, or `AYJNT_ALLOW_HOST_EFFECTS=write` |
| `exec` | `--allow-host-exec`, or `AYJNT_ALLOW_HOST_EFFECTS=exec` |

The env var takes a comma list (`write,exec`) so a compiled binary can
run non-interactively in CI without being rebuilt. Otherwise, on an
interactive TTY the user gets a y/N confirm; a granted answer is
**remembered per tool for the session** (an agent loop calling the same
tool repeatedly would otherwise train the user to approve without
reading). With no TTY and no permission, the call is refused.

## Security — say this out loud when adding a host tool

**Host tool arguments come from model output, and that output may have
been shaped by untrusted content the agent ingested** — an inbound
email, a retrieved RAG document, a fetched page. A host tool is
therefore a path from untrusted text to local code execution.

Mitigations, in the order that matters:

1. **Keep `Bun.$`'s default escaping.** Interpolated values are escaped
   automatically. Never build a command as a string and call
   ``Bun.$(rawString)`` — that opts out of the only thing protecting you.
2. **Wrap every model-supplied path in `confinePath(root, p)`** from
   `"ayjnt/tools"`. A `startsWith` check is *insufficient*: `..`
   segments have to be resolved before comparing, and `/srv/data-evil`
   shares a prefix with `/srv/data`. `confinePath` resolves first, then
   compares the relative path.
3. **Declare the narrowest `sideEffects`** the tool actually needs. The
   permission gate is only as useful as the declaration is honest.

Neither the gate nor the helper substitutes for validating inputs.

## Deploying a project with host tools

`ayjnt deploy` **refuses**:

```
cannot deploy: 1 host tool file(s) would not work in production.
```

A deployed Cloudflare worker has no host process, so these functions
have nowhere to run. Three options:

1. **Move the tools into `agents/<route>/tools.ts`** to run them in
   workerd (losing `Bun.$`, `Bun.file`, `bun:sqlite` and node APIs).
2. **Ship with `ayjnt compile`** instead of deploying. See
   [`ayjnt-compile`](../ayjnt-compile/SKILL.md).
3. **Add the comment marker `@ayjnt-optional-on-deploy`** to the file.
   Its tools are then omitted from the deployed ToolSet instead of
   blocking the deploy.

Option 3 works because `agentTools()` builds host proxies only when the
bridge is bound. Deployed, no bridge exists, so the ToolSet contains
only workerd tools — the agent **degrades rather than erroring**. Worth
having `cli.ts` print `Object.keys(agentTools(this))` so the difference
is visible.

## How the bridge works

Miniflare's `serviceBindings` — a plain host function exposed to workerd
as a `Fetcher`. **No Cap'n Proto, no capnweb dependency.** Schemas cross
as JSON Schema, converted with zod 4's `z.toJSONSchema` (a plain JSON
Schema object passes through untouched), and the worker builds
`dynamicTool()` proxies from them. Schemas are always in sync with the
implementation because they're derived from it rather than restated.

## Reference

- [`examples/code`](../../../examples/code) — a coding agent with
  permissioned `tools.host.ts` access to files and commands.
- [`ayjnt-browser`](../ayjnt-browser/SKILL.md) — `browserTools(this)`,
  which composes with `agentTools(this)`.
- [`ayjnt-cli-file`](../ayjnt-cli-file/SKILL.md) — driving tools by hand
  from a `cli.ts`.
