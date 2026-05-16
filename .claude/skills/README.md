# Skills for building with ayjnt

Claude Code skills that help you author agents, UIs, and MCP apps with the
ayjnt framework. Each skill describes a focused authoring task and the
exact file shapes the framework expects — drop-in scaffolds that map 1:1
to what the codegen pipeline wires up at build time.

| Skill | When it triggers | What it does |
|---|---|---|
| [`ayjnt-overview`](./ayjnt-overview/SKILL.md) | Anything about ayjnt that doesn't match a more specific skill. | Primer on the framework — file conventions, CLI, the generated `.ayjnt/` tree, where to look next. |
| [`ayjnt-new-agent`](./ayjnt-new-agent/SKILL.md) | "Add an agent", "create an agent", "new agent under /<route>". | Drops `agents/<name>/agent.ts` with the right base class, env, and state shape. |
| [`ayjnt-add-ui`](./ayjnt-add-ui/SKILL.md) | "Add a UI to <agent>", "co-locate a React UI". | Adds `app.tsx` next to the agent using the typed `useAgent()` hook. |
| [`ayjnt-mcp`](./ayjnt-mcp/SKILL.md) | "MCP server", "extend McpAgent", "register MCP tools", "connect Claude Desktop". | Generates an `McpAgent` subclass with `McpServer` + tool registrations, ready to wire into an MCP client. |
| [`ayjnt-middleware`](./ayjnt-middleware/SKILL.md) | "Add middleware", "add auth", "gate a subtree", "wrap responses". | Drops `middleware.ts` at the right folder, using the Hono-style `Context` + `next()` pattern. |
| [`ayjnt-rpc`](./ayjnt-rpc/SKILL.md) | "Call another agent", "agent-to-agent", "inter-agent RPC", "@callable". | Adds an `@callable` method to one agent and the typed `getAgent<T>` call site to another. |
| [`ayjnt-troubleshoot`](./ayjnt-troubleshoot/SKILL.md) | Specific error strings — "compatibility date", "lockfile drift", "404 on agent", "basePath", "useAgent doesn't work". | Maps known symptoms to root causes and fixes — most are documented gotchas with single-line resolutions. |

## How they load

Skills under `.claude/skills/` auto-register when Claude Code starts in
this project (or any project that contains an `agents/` directory). When
a user request matches a skill's description, Claude loads its body and
applies the guidance.

## Copying these into your project

`bunx ayjnt new <dir>` scaffolds new projects with this whole skills
directory copied in, so users get the authoring help for free. If you
already have an ayjnt project and want the skills, copy the folder:

```sh
mkdir -p .claude
cp -R "$(bun pm whoami 2>/dev/null && bun pm cache 2>/dev/null)/ayjnt-skills" .claude/skills
```

…or grab the directory directly from
[github.com/anthropic-experimental/ayjnt/.claude/skills](https://github.com/anthropic-experimental/ayjnt/tree/main/.claude/skills).

## Editing the skills

These are plain markdown files with YAML frontmatter. Tune the
`description` to refine when a skill triggers, and edit the body to
reflect your team's house style — generated files, naming conventions,
preferred patterns. Skill changes are picked up on the next Claude Code
session start.
