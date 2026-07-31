---
name: ayjnt-cli-file
description: Add or edit the optional root-level `cli.ts` that turns an ayjnt project into a runnable program. Use when the user asks to "add a CLI", "make this a command-line app", "call an agent from a script", "read a local file into an agent", "trigger a workflow from outside", "shell out to git and store the result", or asks what `AyjntCli` / `agents.foo("id")` is. Covers the context object, the two-runtime split (cli.ts in Bun, agents in workerd), the route-nested `agents` accessors, in-process Durable Object RPC, `.watch()`, workflow bindings, and the error-message gotcha when an agent method throws.
---

# The root-level `cli.ts`

One file at the project root turns an ayjnt project into a runnable
program. `ayjnt run` — and a binary from `ayjnt compile` — boots the
worker under a local workerd, hands the default export a context, and
shuts everything down the moment that function settles.

## File shape

```ts
// cli.ts
import type { AyjntCli } from "@ayjnt/cli";

export default async function ({ agents, argv }: AyjntCli) {
  const notes = agents.notes("default");
  const [command, ...rest] = argv;

  switch (command) {
    case "add":
      console.log(`added ${(await notes.addNote(rest.join(" "), "cli")).id}`);
      return;
    case "list":
      for (const n of await notes.listNotes()) console.log(`• ${n.text}`);
      return;
    default:
      console.log("usage: notes <add|list>");
  }
}
```

**Default-export a function.** The context type comes from the
*generated* module — `@ayjnt/cli`, not `ayjnt` — because `agents` and
`workflows` are typed against the project's actual agent classes.
`import { defineCli } from "ayjnt/cli"` is an equivalent identity
helper if the user prefers inference over naming the type.

## The context

| Field | What it is |
|---|---|
| `agents` | Route-nested accessors returning agent handles. |
| `workflows` | Workflow bindings, keyed by camelized workflow name. |
| `env` | Every binding on the worker's `env`, proxied into this process. |
| `argv` | `process.argv.slice(2)`. The framework claims almost none of it. |
| `url` | Origin the worker bound to, e.g. `http://localhost:8787`. |
| `fetch(path, init?)` | HTTP into the worker. A path resolves against `url`. |
| `stop()` | Request shutdown. Mainly for breaking out of a `watch` loop. |

## Two runtimes — this is the whole point

A running ayjnt app spans two runtimes, and the asymmetry is the reason
to compile an ayjnt app at all:

| | `cli.ts` | `agents/**/agent.ts` |
|---|---|---|
| Runtime | **Bun** | **workerd** |
| Has | `Bun.$`, `Bun.file`, `bun:sqlite`, `node:fs`, `argv`, TTY | DO storage, `setState`, alarms, workflows |
| Lacks | DO storage of its own | every Bun API |

So `cli.ts` can read a local file, shell out to git, or open a native
SQLite database, and feed the results straight into agent state:

```ts
case "import": {
  const text = await Bun.file(rest[0]!).text();      // Bun, here
  for (const line of text.split("\n").filter(Boolean)) {
    await notes.addNote(line, rest[0]!);              // workerd, over there
  }
  return;
}
```

## The `agents` accessors

Route-nested and camelized, mirroring the `agents/` tree:

| Route | Accessor |
|---|---|
| `agents/counter` | `agents.counter("demo")` |
| `agents/admin/users` | `agents.admin.users("u1")` |
| `agents/my-notes` | `agents.myNotes("n1")` |

Omitting the instance defaults to `"default"` — `agents.counter()` and
`agents.counter("default")` are the same DO.

### Calls are real in-process RPC

Method calls go straight into workerd as Durable Object RPC. **No HTTP,
no port, no client handshake, no URL to construct.** That works because
`cli.ts` runs in the same process that owns the runtime.

`cli.ts` is a **privileged peer**: it can call **any public method** on
the agent class, not just the `@callable` ones. `@callable` stays what
it always was — the marker for *browser* exposure. This matches
inter-agent `getAgent<T>()` semantics.

Every handle also carries two extras:

- **`.fetch(path?, init?)`** — raw HTTP into the instance, through the
  middleware chain, exactly as an external client would.
- **`.watch(cb)`** — subscribe to live `setState` pushes. This is the
  one operation that needs more than a stub: state broadcasts travel
  over the agent WebSocket protocol, so it lazily connects to the bound
  port. Returns an unsubscribe function.

```ts
case "watch": {
  console.log(`watching — ${url}`);
  await notes.watch((state) => console.log(`[state] ${state.notes.length}`));
  // Returning here would tear the runtime down, so wait for a signal.
  await new Promise(() => {});
  return;
}
```

## Workflows

```ts
const instance = await workflows.ordersProcessing.create({
  params: { sku: "abc", qty: 2 },
});
console.log(instance.id, await instance.status());
```

Keyed by camelized workflow name. **Workflows have no HTTP surface in
the generated worker at all**, so in-process bindings are the only way
to trigger one from outside an agent. See
[`ayjnt-workflows`](../ayjnt-workflows/SKILL.md).

## Gotcha: a throwing agent method loses its message

Call an agent method from `cli.ts`, have it throw, and **the message is
gone**. This is a Miniflare limitation: exceptions from host-initiated
Durable Object calls lose their body — workerd returns a 4xx for an
application error and the proxy asserts on the status before it ever
reads the body. The framework detects this and substitutes an
explanatory error, but it cannot recover the original text.
Worker-to-DO calls are unaffected; this is specific to calling *in*
from the host, which is exactly what `cli.ts` does.

**Return results instead of throwing.** This is good practice anyway —
a failed tool call or a bad argument is normal traffic:

```ts
// In the agent
async runTool(name: string, input: unknown):
  Promise<{ ok: true; result: unknown } | { ok: false; error: string }>
{
  try {
    return { ok: true, result: await tools[name]!.execute(input, opts) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

```ts
// In cli.ts
const outcome = await notes.runTool(name, input);
if (!outcome.ok) {
  console.error(`tool failed: ${outcome.error}`);
  process.exitCode = 1;
  return;
}
```

The alternative is `.fetch()`, where errors propagate normally.

## Lifecycle reminders

- When the default export settles, **the runtime shuts down** — workerd
  included. A long-lived command must not return; `await` a promise
  that a signal resolves, or use `stop()`.
- With **no** `cli.ts`, `ayjnt run` just serves until interrupted.
- `ayjnt dev` does **not** run `cli.ts`. Only `run` and a compiled
  binary do. See [`ayjnt-compile`](../ayjnt-compile/SKILL.md).

## Reference

- [`examples/compiled-cli`](../../../examples/compiled-cli) — the
  `cli.ts` this skill is drawn from.
- [`ayjnt-tools`](../ayjnt-tools/SKILL.md) — the tools a `cli.ts`-driven
  app can expose to a model, including host tools.
