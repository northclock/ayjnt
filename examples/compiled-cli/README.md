# ayjnt example: compiled-cli

A notes app that is an agent, a set of model tools, and a command-line program —
shipped as **one executable** with no Bun, no `node_modules`, and no wrangler
required to run it.

This is the example to read if you want to understand the three newest file
conventions and why they exist:

| File | Runs in | Deploys to Cloudflare? |
| --- | --- | --- |
| `agents/notes/agent.ts` | workerd | yes |
| `agents/notes/tools.ts` | workerd | yes |
| `agents/notes/tools.host.ts` | **Bun host** | **no** |
| `cli.ts` | **Bun host** | n/a (not worker code) |

## Layout

```
compiled-cli/
├── agents/
│   └── notes/
│       ├── agent.ts        NotesAgent — DO state + @callable methods
│       ├── tools.ts        model tools that run in workerd
│       └── tools.host.ts   model tools that run on the Bun host
├── cli.ts                  the program's foreground
├── package.json
└── tsconfig.json
```

## Run it

```sh
bun install
bun run start list             # ayjnt run, passing `list` to cli.ts
bun run start add hello world
bun run start list
```

Arguments just pass through to `cli.ts`. You only need an explicit `--` when you
want to send it something that *looks* like an ayjnt flag:

```sh
bun run start -- --my-own-flag
```

This example links the framework with `"ayjnt": "file:../.."`, so it runs against
this checkout rather than a published release — the features it demonstrates are
newer than any published version. Note that Bun **copies** a `file:` dependency
rather than symlinking it, so after changing framework source you need
`bun install --force` here (or use `bun run dev:temp --cli` from the repo root,
which symlinks instead).

Then compile it:

```sh
bun run compile               # → ./notes-app  (~170MB)
./notes-app add "from the binary"
./notes-app list
```

(`ayjnt compile` names the binary after the worker by default; this example's
`compile` script passes `--outfile notes-app` for something shorter to type.)

The binary is self-contained. Copy it to a machine with no Bun and no
`node_modules` and it still works — it carries workerd and the Bun runtime
inside itself.

## Two runtimes in one app

This is the idea the whole example exists to demonstrate. A running ayjnt app
spans two runtimes, and they can do different things:

- **`cli.ts` and `tools.host.ts` run in Bun.** `Bun.$`, `Bun.file`,
  `bun:sqlite`, `node:fs`, `process.argv`, stdin/TTY — all available.
- **`agent.ts` and `tools.ts` run in workerd.** Durable Object storage,
  `setState`, alarms, workflows — and none of the Bun APIs.

`cli.ts` reading a local file and storing it in Durable Object state is the
whole point:

```ts
const text = await Bun.file(file).text();     // Bun
for (const line of text.split("\n")) {
  await notes.addNote(line, file);            // workerd
}
```

## Talking to the agent from cli.ts

`agents.notes("default")` is a real Durable Object stub. Method calls are RPC
straight into workerd — no HTTP, no port, no client handshake, no URL to build.
That works because `cli.ts` runs in the same process that owns the runtime.

Accessors mirror the file tree and are camelized: `agents/notes` →
`agents.notes(…)`; `agents/admin/users` → `agents.admin.users(…)`;
`agents/my-notes` → `agents.myNotes(…)`.

`cli.ts` is a **privileged peer**, so it can call any public method on the class,
not only the `@callable` ones. `@callable` stays what it always was: the marker
for browser exposure.

## The two kinds of tools

`agentTools(this)` returns one merged AI-SDK `ToolSet`. The agent doesn't know or
care which runtime a tool lives in:

```ts
const tools = { ...browserTools(this), ...agentTools(this) };
const result = await generateText({ model, tools, messages });
```

See which tools exist right now:

```sh
bun run start tools
# countWords              ← tools.ts        (workerd)
# summarizeNotes          ← tools.ts        (workerd)
# notes__appendToLog      ← tools.host.ts   (Bun host)
# notes__listProjectFiles ← tools.host.ts   (Bun host)
# notes__readProjectFile  ← tools.host.ts   (Bun host)
```

Host tools are namespaced by route (`notes__`) so two agents can each export a
`search` without colliding.

Run one directly, without needing a model:

```sh
bun run start tool countWords '{"text":"one two three"}'
bun run start tool notes__listProjectFiles
```

## Host tools need permission to do anything dangerous

Every host tool declares `sideEffects`. `read` runs freely; `write` and `exec`
are refused unless you opt in:

```sh
bun run start tool notes__appendToLog '{"line":"hi"}'
# tool failed: host tool appendToLog declares sideEffects: "write", which is not
# permitted. Re-run with --allow-host-writes or set AYJNT_ALLOW_HOST_EFFECTS=write.

bun run start --allow-host-writes tool notes__appendToLog '{"line":"hi"}'
# { "appended": "hi", "file": "notes.log" }
```

This is not ceremony. **Host tool arguments come from model output**, and if an
agent ever reads untrusted content — an inbound email, a retrieved document, a
fetched web page — then attacker-controlled text can reach a function that runs
`Bun.$` on your machine.

`readProjectFile` shows the other half of the defense:

```sh
bun run start tool notes__readProjectFile '{"path":"../../../etc/passwd"}'
# tool failed: path "../../../etc/passwd" escapes the permitted directory …
```

That comes from `confinePath(ROOT, path)`. A `startsWith` check would not be
enough — `..` segments have to be resolved before comparing, and a sibling
directory like `/srv/data-evil` shares a prefix with `/srv/data`.

## Gotcha: this example cannot be deployed

```sh
bun run deploy
# cannot deploy: 1 host tool file(s) would not work in production.
#   agents/notes/tools.host.ts  (/notes)
```

That refusal is deliberate. A deployed Cloudflare worker has no host process, so
`tools.host.ts` has nowhere to run. Failing at deploy time is better than the
alternatives: silently omitting the tools gives the same agent different
capabilities in prod with nothing to indicate it, and deploying throwing stubs
turns a build error into a production incident.

Three ways forward: move the functions into `tools.ts` (giving up Bun APIs), ship
with `ayjnt compile` instead, or add the comment marker
`@ayjnt-optional-on-deploy` to the file if the agent works fine without those
tools.

## Gotcha: return errors, don't throw them

`runTool` in `agent.ts` returns `{ ok, result | error }` rather than throwing.
Partly because a failed tool call is normal traffic a model can recover from —
but also because exceptions thrown by an agent method lose their message when the
call came from `cli.ts`. That's a limitation in the local runtime's Durable
Object proxy; the framework substitutes an error explaining it, but the original
reason is gone. Returning a result keeps it.

## Gotcha: state outlives the process

Durable Object state persists in a per-app OS directory, not in the project
folder — `~/Library/Application Support/ayjnt/ayjnt-example-compiled-cli` on
macOS. So `add` then `list` in two separate invocations works, and the binary
remembers your notes even if you move it.

```sh
bun run start clear    # start over
```

Override the location with `--data-dir <path>` or `AYJNT_DATA_DIR`.

## See also

- [`../../README.md`](../../README.md) — framework overview
- [`../callable-client`](../callable-client) — the older pattern: driving an agent
  from an external script over WebSocket, with all the URL plumbing `cli.ts`
  removes
- [`../browser-tools`](../browser-tools) — model tools that need Cloudflare's
  Browser Rendering. Note those do *not* work in a compiled binary, since
  Miniflare has no `worker_loaders` equivalent.
