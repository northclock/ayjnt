# Skills for building with ayjnt

Agent skills for authoring Ayjnt harnesses. `.claude/skills` supports
Claude Code and the mirrored `.agents/skills` tree supports agents that
follow the portable skills convention. Keep their `SKILL.md` files
identical.

| Skill | When it triggers | What it does |
|---|---|---|
| [`ayjnt-overview`](./ayjnt-overview/SKILL.md) | Anything about ayjnt that doesn't match a more specific skill. | Primer on the framework — file conventions, CLI, the generated `.ayjnt/` tree, where to look next. |
| [`ayjnt-new-agent`](./ayjnt-new-agent/SKILL.md) | "Add an agent", "create an agent", "new agent under /<route>". | Drops `agents/<name>/agent.ts` using `Agent<State>` and the file-route convention. |
| [`ayjnt-add-ui`](./ayjnt-add-ui/SKILL.md) | "Add a UI to <agent>", "co-locate a React UI". | Adds `app.tsx` next to the agent using the typed `useAgent()` hook. |
| [`ayjnt-state`](./ayjnt-state/SKILL.md) | "`setState`", durable state, SQLite, state validation. | Chooses synchronized state or SQLite and verifies browser persistence. |
| [`ayjnt-sessions`](./ayjnt-sessions/SKILL.md) | Sessions, history, memory, context, branches, compaction. | Adds Cloudflare-backed durable sessions through Ayjnt's `Agent`. |
| [`ayjnt-scheduling`](./ayjnt-scheduling/SKILL.md) | Reminders, intervals, cron, scheduled callbacks. | Adds owned, durable schedules with cancellation and retry guidance. |
| [`ayjnt-mcp`](./ayjnt-mcp/SKILL.md) | "MCP server", "extend McpAgent", "register MCP tools", "connect Claude Desktop". | Generates an `McpAgent` subclass with `McpServer` + tool registrations, ready to wire into an MCP client. |
| [`ayjnt-workflows`](./ayjnt-workflows/SKILL.md) | "Add a workflow", "extend AgentWorkflow", "long-running job", "retry with backoff". | Uses `AgentWorkflow<Params>` and co-located `this.workflow(params)` without mixins or binding strings. |
| [`ayjnt-browser`](./ayjnt-browser/SKILL.md) | "Browse the web", "browser tools", "Cloudflare Browser Rendering", "give the LLM a browser". | One `import { browserTools } from "ayjnt/browser"` wires BROWSER + LOADER + AI + `nodejs_compat`. |
| [`ayjnt-email`](./ayjnt-email/SKILL.md) | "Handle email", "reply to email", "onEmail handler", "support@ inbox". | Defining `onEmail(message)` triggers Email Routing + `send_email` binding + address-based dispatch. |
| [`ayjnt-voice`](./ayjnt-voice/SKILL.md) | "Voice agent", "STT + TTS", "make the agent talk", "Workers AI voice". | Wraps the agent in `withVoice(Agent)` with Workers AI providers; generates a typed `useVoiceAgent` hook. |
| [`ayjnt-middleware`](./ayjnt-middleware/SKILL.md) | "Add middleware", "add auth", "gate a subtree", "wrap responses". | Drops `middleware.ts` at the right folder, using the Hono-style `Context` + `next()` pattern. |
| [`ayjnt-rpc`](./ayjnt-rpc/SKILL.md) | "Call another agent", "agent-to-agent", "inter-agent RPC", "@callable". | Uses `this.agent(TargetClass, name)` for peers and typed `agent.stub` methods for browsers. |
| [`ayjnt-tools`](./ayjnt-tools/SKILL.md) | "Add a tool", "give the model tools", "let the agent read local files", "tools.host.ts", "sideEffects". | `tools.ts` (workerd) vs `tools.host.ts` (Bun host), merged into one ToolSet by `agentTools(this)`. |
| [`ayjnt-cli-file`](./ayjnt-cli-file/SKILL.md) | "Add a CLI", "make this a command-line app", "call an agent from a script", "trigger a workflow from outside". | Drops a root-level `cli.ts` with in-process Durable Object RPC and workflow bindings. |
| [`ayjnt-compile`](./ayjnt-compile/SKILL.md) | "Compile", "make a binary", "ship a CLI", "run without wrangler", "ayjnt run vs ayjnt dev". | `ayjnt run` on ayjnt's own runtime, and `ayjnt compile` to a single-file executable. |
| [`ayjnt-troubleshoot`](./ayjnt-troubleshoot/SKILL.md) | Specific error strings — "compatibility date", "lockfile drift", "404 on agent", "basePath", "useAgent doesn't work". | Maps known symptoms to root causes and fixes — most are documented gotchas with single-line resolutions. |

## How they load

Skills under `.claude/skills/` auto-register in Claude Code. Tools that
discover the portable convention load `.agents/skills/`. When a request
matches a frontmatter description, the relevant body is loaded.

## Copying these into your project

`bunx ayjnt new <dir>` scaffolds projects with authoring skills.
For an existing project, copy `.claude/skills` and `.agents/skills` from the
[Ayjnt repository](https://github.com/northclock/ayjnt), or start with
`bunx ayjnt new`, which includes the supported authoring setup.

## Editing the skills

These are Markdown files with YAML frontmatter. Keep instructions
concise, use current public APIs, validate every skill, and mirror
changes into both trees. Never teach generated binding strings when a
class-valued or generated typed API exists.
