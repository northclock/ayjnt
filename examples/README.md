# Ayjnt examples

These six examples are complete starting points, not a catalog of isolated
features. Each demonstrates a different kind of agent harness and includes a
human interface.

| Example | Start here when you need |
| --- | --- |
| [`code`](./code) | A terminal coding agent with browser-visible sessions |
| [`realtime-voice`](./realtime-voice) | A Gemini Live voice-to-voice interface |
| [`chess`](./chess) | Human-versus-agent or agent-versus-agent interaction |
| [`scheduler`](./scheduler) | One-time, recurring, and cron agent work |
| [`workflow`](./workflow) | Durable multi-step work with human approval |
| [`orchestration`](./orchestration) | Typed delegation across several agents |

Each folder is independently installable and contains the exact files
shown by its guided page in the documentation site:

```sh
cd examples/code
bun install
bun run dev
```

Generated `.ayjnt/`, `.wrangler/`, and dependency directories are ignored. The
source tree is deliberately small enough to read in one sitting. Use the root
framework CLI while developing changes in this repository:

```sh
bun run bin/ayjnt.ts build --cwd examples/orchestration
```
