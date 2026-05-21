# ayjnt example: email-bot

Demonstrates the zero-config email path — drop an `onEmail` method on
any agent and the framework wires up the `send_email` binding, the
worker-level `email()` export, and the routing resolver.

## What the agent looks like

```ts
import { Agent } from "agents";
import type { AgentEmail } from "agents/email";
import PostalMime from "postal-mime";

export default class SupportAgent extends Agent<GeneratedEnv, State> {
  async onEmail(email: AgentEmail): Promise<void> {        // ← the trigger
    const raw = await email.getRaw();
    const parsed = await PostalMime.parse(raw);

    await this.replyToEmail(email, {
      fromName: "Support",
      body: `Re: ${parsed.subject} — a human will follow up.`,
    });
  }
}
```

No `override` — the Agent base class duck-types `onEmail` via
`"onEmail" in this`, so subclasses just declare the method.

## What ayjnt wires up

`bun run dev` (or `bun run build`) detects the `onEmail` method and
adds three pieces to `.ayjnt/dist/`:

### 1. `wrangler.jsonc` — `send_email` binding

```jsonc
{
  "send_email": [{ "name": "EMAIL", "remote": true }]
}
```

`remote: true` lets local dev send through the real Email Service so
the round-trip works without a deployed worker.

### 2. `entry.ts` — worker-level `email()` export

```ts
export default {
  async fetch(...) { /* ... */ },
  async email(message, env, ctx) {
    await routeAgentEmail(message, env, { resolver: defaultEmailResolver });
  },
};
```

…plus a manifest-derived resolver mapping the local-part of the `to`
address to an agent route, with optional `+suffix` for the DO instance:

```ts
const EMAIL_ROUTES = {
  "support": { agentName: "support-agent" },
};

async function defaultEmailResolver(message) {
  // support@host           → SupportAgent (instance "default")
  // support+room-42@host   → SupportAgent (instance "room-42")
  const local = message.to.split("@")[0];
  const [route, instance = "default"] = local.split("+");
  const entry = EMAIL_ROUTES[route.toLowerCase()];
  return entry ? { agentName: entry.agentName, agentId: instance } : null;
}
```

### 3. `env.d.ts` — typed `EMAIL` binding

```ts
type GeneratedEnv = {
  SUPPORT_AGENT: DurableObjectNamespace<SupportAgent>;
  EMAIL: SendEmail;
};
```

Now `this.env.EMAIL` autocompletes; `this.sendEmail()` and
`this.replyToEmail()` resolve at runtime.

## Setting up inbound delivery

1. **Deploy**: `bun run deploy`.
2. **Configure a routing rule**: in the Cloudflare dashboard, go to
   Email Routing → Custom Address. Route something like
   `support@yourdomain.com` to "Send to a Worker" pointing at this
   worker.
3. **Send a test email** to that address — your `SupportAgent` instance
   `default` receives it and replies.

The local part must match the agent's route. `support@…` → `/support`'s
agent. To target a specific DO instance, use sub-addressing:
`support+room-42@…` → instance `"room-42"`.

## Custom routing

Drop an `email.ts` at the project root that default-exports an
`EmailResolver` — the codegen detects it and imports it instead of
generating the default:

```ts
// email.ts
import type { EmailResolver } from "agents/email";

const resolver: EmailResolver<Env> = async (message, env) => {
  // Header-based routing, lookup tables, secure reply verification,
  // anything you like. Return { agentName, agentId } or null.
};

export default resolver;
```

## Sending outbound email

The agent's `this.sendEmail({...})` method uses `this.env.EMAIL`
under the hood:

```ts
await this.sendEmail({
  binding: this.env.EMAIL,
  to: "customer@example.com",
  from: "support@yourdomain.com",
  subject: "Your ticket is open",
  text: "Plain text body",
});
```

For secure two-way threading, pass a `secret` so reply routing can
verify the recipient signature with
`createSecureReplyEmailResolver` from `agents/email`.

## Try it locally

```sh
bun install
bun run dev
```

Then open <http://localhost:8787/support/default> — the co-located UI
shows the reply log and lets you simulate inbound emails via the
agent's `@callable` `simulateInboundEmail(from, subject)`. Real
inbound traffic still flows through `onEmail`, but the simulator
bypasses Email Routing so you can exercise the agent without deploying.

To inspect raw state via HTTP:

```sh
curl http://localhost:8787/support/default    # returns the reply log
```

## See also

- [Cloudflare Agents — Email docs](https://developers.cloudflare.com/agents/api-reference/email/)
- [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
- [`src/codegen/entry.ts`](../../src/codegen/entry.ts) — the worker `email()` handler generator.
- [`src/codegen/scan.ts`](../../src/codegen/scan.ts) — `detectOnEmail` and the `email.ts` override file detection.
