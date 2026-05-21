import { Agent, callable } from "agents";
import type { AgentEmail } from "agents/email";
import type { GeneratedEnv } from "@ayjnt/env";
import PostalMime from "postal-mime";

type State = {
  /** Newest-first list of {from, subject} we've replied to. Capped at 20. */
  log: { from: string; subject: string; at: number }[];
};

/**
 * SupportAgent — replies to inbound email.
 *
 * The `onEmail(email)` method on this class is the only opt-in signal
 * the framework needs to:
 *
 *   1. Add `send_email: [{ name: "EMAIL", remote: true }]` to wrangler.jsonc.
 *   2. Emit a worker-level `email()` handler in `.ayjnt/dist/entry.ts`
 *      that calls `routeAgentEmail` with a generated resolver.
 *   3. Augment `GeneratedEnv` with `EMAIL: SendEmail` so
 *      `this.sendEmail()` and `this.replyToEmail()` resolve.
 *
 * The generated default resolver maps the local-part of the `to`
 * address to an agent route:
 *
 *   support@yourdomain          → SupportAgent (instance "default")
 *   support+room-42@yourdomain  → SupportAgent (instance "room-42")
 *
 * Drop an `email.ts` at the workspace root that default-exports an
 * `EmailResolver` to override this routing — the codegen detects the
 * file and imports your resolver instead.
 *
 * To set up inbound delivery:
 *   1. Deploy the worker (`bun run deploy`).
 *   2. In the Cloudflare dashboard → Email Routing → Custom Address,
 *      route `support@yourdomain` to "Send to a Worker" pointing at
 *      this worker. (You can use any prefix as long as it matches the
 *      agent's routePath — `support` here.)
 *   3. Send a test email; this agent replies.
 */
export default class SupportAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { log: [] };

  // No `override` here: the Agent base class doesn't declare `onEmail`
  // as a method. It detects this method via a duck-typed check
  // (`"onEmail" in this && typeof this.onEmail === "function"`) and
  // delegates to it from the internal _onEmail wire handler.
  async onEmail(email: AgentEmail): Promise<void> {
    // The raw RFC-822 bytes — postal-mime parses out headers, body,
    // attachments, etc.
    const raw = await email.getRaw();
    const parsed = await PostalMime.parse(raw);

    const subject = parsed.subject ?? "(no subject)";
    const fromName = parsed.from?.name ?? parsed.from?.address ?? "there";

    // Track who we replied to (newest first, capped at 20).
    this.setState({
      log: [
        { from: parsed.from?.address ?? "", subject, at: Date.now() },
        ...this.state.log,
      ].slice(0, 20),
    });

    // replyToEmail builds an in-reply-to thread automatically and
    // signs the reply with the optional EMAIL_SECRET (set as a wrangler
    // secret) so subsequent replies to the auto-reply route back to
    // this exact instance via createSecureReplyEmailResolver.
    await this.replyToEmail(email, {
      fromName: "Support",
      body: [
        `Hi ${fromName},`,
        ``,
        `Thanks for emailing about "${subject}". A human will follow up shortly.`,
        ``,
        `— Support`,
      ].join("\n"),
    });
  }

  override async onRequest(): Promise<Response> {
    return Response.json({
      instance: this.name,
      replies: this.state.log,
    });
  }

  /**
   * Simulate an inbound email without round-tripping through Cloudflare
   * Email Routing. Useful for local dev: the co-located UI calls this
   * to drive the agent end-to-end (record-to-log, but without the
   * outbound reply, since there's no real `AgentEmail` to reply to).
   *
   * Production traffic still flows through `onEmail` — this method is a
   * developer affordance, not a replacement for the routing path.
   */
  @callable({ description: "Simulate an inbound email (dev/testing only)." })
  async simulateInboundEmail(from: string, subject: string): Promise<void> {
    this.setState({
      log: [{ from, subject, at: Date.now() }, ...this.state.log].slice(0, 20),
    });
  }

  /** Wipe the reply log. */
  @callable({ description: "Clear the reply log." })
  async clearLog(): Promise<void> {
    this.setState({ log: [] });
  }
}
