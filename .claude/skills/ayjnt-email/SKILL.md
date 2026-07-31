---
name: ayjnt-email
description: Make an agent receive and reply to email. Use when the user asks to "make the agent handle email", "receive email", "reply to email", "add onEmail handler", "email-driven agent", or "support@ inbox to agent". Define `async onEmail(message)` on the agent and ayjnt wires Cloudflare Email Routing, generates the worker's `email()` handler, and adds a `send_email` binding so `replyToEmail` works.
---

# Add an email-capable agent

Defining `async onEmail(message: AgentEmail)` on an Agent is the only
trigger. ayjnt's scanner picks it up and flips the project's `email`
feature flag, which generates the worker's `email(message, env, ctx)`
entry point plus an address-based resolver.

## File shape

```ts
// agents/<route>/agent.ts
import { Agent } from "agents";
import type { AgentEmail } from "agents/email";
import { replyToEmail } from "agents/email";
import PostalMime from "postal-mime";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { /* whatever */ };

export default class SupportAgent extends Agent<GeneratedEnv, State> {
  async onEmail(message: AgentEmail): Promise<void> {
    const raw = await message.getRaw();
    const parsed = await PostalMime.parse(raw);

    // Update state — broadcasts to connected WebSocket clients.
    this.setState({
      tickets: [
        ...this.state.tickets,
        { from: message.from, subject: parsed.subject ?? "(no subject)" },
      ],
    });

    // Reply using the SDK helper (threads headers, picks from, etc.)
    await replyToEmail(message, this.env.EMAIL, {
      from: "support@example.com",
      subject: `Re: ${parsed.subject ?? "your message"}`,
      text: "Got it — we'll follow up shortly.",
    });
  }
}
```

### Rules

- **Method name must be `onEmail`** — the scanner matches this exact
  identifier in the agent's source.
- **Method, not field.** `onEmail = async (...) => {}` is NOT
  detected; declare it as a regular method.
- **`AgentEmail`** is imported from `agents/email`, not the package
  root.
- **Parse with `postal-mime`** for structured access to subject, body,
  attachments. `message.getRaw()` returns an `ArrayBuffer`.
- **Reply with `replyToEmail(message, env.EMAIL, opts)`**, not the raw
  `env.EMAIL.send(...)` — the helper threads `In-Reply-To` and
  `References` headers properly.

## What ayjnt wires up

```jsonc
// .ayjnt/dist/wrangler.jsonc
"send_email": [{ "name": "EMAIL", "remote": true }]
```

```ts
// .ayjnt/env.d.ts
export type GeneratedEnv = {
  // ... existing agent bindings ...
  EMAIL: SendEmail;
};
```

```ts
// .ayjnt/dist/entry.ts (simplified)
import { routeAgentEmail, createAddressBasedEmailResolver } from "agents";

const defaultEmailResolver = createAddressBasedEmailResolver([
  { localPart: "support", agent: "SupportAgent" },
  // ...one entry per email-capable agent
]);

export default {
  async email(message, env, ctx) {
    return routeAgentEmail(message, env, ctx, defaultEmailResolver);
  },
};
```

## Default address routing

ayjnt's default resolver matches the local part of the recipient
address against the agent's route path:

- Agent at `agents/support/` → answers `support@<your-domain>`
- Agent at `agents/billing/` → answers `billing@<your-domain>`
- Nested folders use the deepest segment, e.g.{" "}
  `agents/internal/admin/` → answers `admin@<your-domain>`.

## Custom resolver

Drop a top-level `email.ts` to override default routing:

```ts
// email.ts (project root, next to agents/)
import type { AgentEmail } from "agents/email";
import type { GeneratedEnv } from "@ayjnt/env";

export default async function resolveAgent(
  message: AgentEmail,
  env: GeneratedEnv,
) {
  if (message.to.endsWith("@vip.example.com")) {
    return env.VIP_SUPPORT_AGENT.get(
      env.VIP_SUPPORT_AGENT.idFromName("default"),
    );
  }
  return null; // fall through to default address-based resolver
}
```

The generated `entry.ts` imports this file (the scanner detects it)
and tries your function first.

## Cloudflare setup (one-time)

1. Enable **Email Routing** on the destination domain (Cloudflare
   dashboard → Email → Email Routing).
2. Add a **routing rule** that forwards the right address(es) to your
   worker. ayjnt doesn't create these rules — they live in the dashboard.
3. For sending: verify the `from` address in **"Destination
   addresses"**. Cloudflare won't send mail from an unverified address.

## Useful APIs on `AgentEmail`

- `message.from` / `message.to` — string addresses
- `message.headers` — `Headers` for raw MIME headers
- `message.getRaw()` → `Promise<ArrayBuffer>` — full MIME bytes
- `message.setReject(reason)` — bounce the message
- `message.forward(to)` — forward without responding

## Reference

- [Cloudflare Email Agents docs](https://developers.cloudflare.com/agents/api-reference/email-agents/).
- [Cloudflare Email Routing setup](https://developers.cloudflare.com/email-routing/).
