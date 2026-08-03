---
name: ayjnt-sessions
description: Add durable conversation sessions and memory to an Ayjnt agent. Use when the user asks about `createSession`, `createSessionManager`, message history, context blocks, memory, branching, search, archives, or compaction. Preserve that Ayjnt exposes Cloudflare's experimental Session API without changing its storage behavior.
---

# Add durable sessions and memory

Ayjnt's `Agent` exposes the upstream Session API through
`createSession()` and `createSessionManager()`. Sessions live in the
agent instance's SQLite database.

## One session

```ts
// agents/assistant/agent.ts
import { Agent, callable } from "ayjnt";

export default class AssistantAgent extends Agent {
  session = this.createSession("support")
    .withContext("identity", {
      provider: {
        get: async () => "You are a careful support assistant.",
      },
    })
    .withContext("memory", {
      description: "Useful facts learned about the person",
      maxTokens: 1_100,
    })
    .withCachedPrompt();

  @callable()
  async append(
    message: Parameters<typeof this.session.appendMessage>[0],
  ) {
    await this.session.appendMessage(message);
    return this.session.getHistory();
  }

  @callable()
  async history() {
    return this.session.getHistory();
  }
}
```

Use a stable session id when one agent instance owns several known
conversations. Omitting the id uses the session builder's default.

## Many sessions

Use `createSessionManager()` when the harness creates, lists, branches,
archives, searches, or compacts multiple conversations dynamically:

```ts
export default class InboxAgent extends Agent {
  sessions = this.createSessionManager();

  async manager() {
    return this.sessions;
  }
}
```

Inspect the installed `agents` SDK types before calling manager methods;
the Session API is experimental and its detailed surface may evolve.
Keep the manager behind your own narrow agent methods so browser and CLI
interfaces remain stable.

## Design rules

- Keep identity and system instructions in stable context blocks.
- Bound learned memory with `maxTokens`; do not replay unlimited
  history into every model call.
- Keep secrets out of messages and context providers.
- Use session history for conversations and synchronized agent state
  for small UI status such as title, last activity, or token totals.
- Expose browser operations with `@callable()` and call them through
  `agent.stub.method(...)`.

## Validation

Run:

```sh
bun run build
bun run dev
```

Append two messages, request history, restart the server, and request
history again. The messages should remain. If using multiple sessions,
confirm two ids remain isolated.

The implementation is an abstraction over Cloudflare's experimental
Session classes, not an Ayjnt fork. Consult the
[Cloudflare Sessions documentation](https://developers.cloudflare.com/agents/runtime/lifecycle/sessions/)
when upgrading.
