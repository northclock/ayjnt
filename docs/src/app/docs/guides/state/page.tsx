import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
	title: "Agent state — ayjnt docs",
	description:
		"How this.state, this.setState, and Durable Object persistence interact. What survives, what doesn't, and the relationship between agents and instances.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="guides/state"
			lede="Each agent instance is a Durable Object with its own persistent state. The Agents SDK wraps it in a typed this.state / this.setState API. Understanding when state is loaded, saved, and broadcast is the difference between a working app and one with subtle data bugs."
		>
			<h2>Classes, bindings, and instances</h2>
			<p>
				Three concepts that often get conflated:
			</p>
			<ul>
				<li>
					<strong>Class</strong> — what you wrote in{" "}
					<code>agent.ts</code>. One class per folder.
				</li>
				<li>
					<strong>Binding</strong> — the Durable Object namespace wrangler
					creates. One binding per class. ayjnt names it{" "}
					<code>UPPER_SNAKE</code> of your class name (<code>ChatAgent</code> →{" "}
					<code>CHAT_AGENT</code>).
				</li>
				<li>
					<strong>Instance</strong> — one actual object with its own storage.
					Created on demand by the URL segment{" "}
					<code>/&lt;route&gt;/:instanceId</code>. There can be an unbounded
					number of instances per class.
				</li>
			</ul>
			<p>
				So <code>/chat/alice</code> and <code>/chat/bob</code> are two
				different <em>instances</em> of the same <code>ChatAgent</code>{" "}
				<em>class</em>, sharing one <code>CHAT_AGENT</code>{" "}
				<em>binding</em>. Each has its own state, storage, in-memory lifetime,
				and hibernation cycle.
			</p>

			<h2>Declaring state</h2>
			<p>
				State is a typed field on the agent class. Declare its shape as the
				second generic on <code>Agent&lt;Env, State&gt;</code> and provide an{" "}
				<code>initialState</code>:
			</p>
			<CodeBlock
				filename="agents/chat/agent.ts"
				lang="ts"
				code={`import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Message = { role: "user" | "assistant"; text: string; at: number };
type State = { messages: Message[]; topic: string };

export default class ChatAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    messages: [],
    topic: "general",
  };
  // ...
}`}
			/>

			<p>
				The <code>override</code> keyword is required because the base class
				declares <code>initialState</code> as a field. Your <code>State</code>{" "}
				type must be JSON-serializable: no functions, no class instances, no{" "}
				<code>Date</code> objects (store as <code>number</code> for epoch ms),
				no <code>Map</code>/<code>Set</code> (use plain objects/arrays).
			</p>

			<h2>Reading state</h2>
			<p>
				Inside the class, <code>this.state</code> is always a current,
				strongly-typed snapshot:
			</p>
			<CodeBlock
				lang="ts"
				code={`override async onRequest(): Promise<Response> {
  return Response.json({
    topic: this.state.topic,
    count: this.state.messages.length,
    recent: this.state.messages.slice(-5),
  });
}`}
			/>
			<p>
				On the first request to a new instance, the SDK initializes{" "}
				<code>this.state</code> to your <code>initialState</code>. On every
				subsequent request, it&apos;s whatever <code>setState</code> last
				wrote — even if the DO was hibernated in between.
			</p>

			<h2>Writing state</h2>
			<p>
				Call <code>this.setState(newState)</code>. Pass the complete next
				state, not a diff — the SDK replaces the whole object and broadcasts
				it:
			</p>
			<CodeBlock
				lang="ts"
				code={`async append(msg: Message) {
  this.setState({
    ...this.state,
    messages: [...this.state.messages, msg],
  });
}`}
			/>
			<Callout kind="danger" title="Don't mutate this.state">
				<p>
					<code>this.state.messages.push(msg)</code> appears to work but is a
					bug:
				</p>
				<ul>
					<li>The storage persistence hook doesn&apos;t fire.</li>
					<li>Connected clients don&apos;t receive a broadcast.</li>
					<li>On next DO hibernation, your mutation is lost.</li>
				</ul>
				<p>
					Treat <code>this.state</code> as immutable. <code>setState</code>{" "}
					is the only writer.
				</p>
			</Callout>

			<h2>What setState actually does</h2>
			<p>
				From the SDK side, every <code>setState</code> call:
			</p>
			<ol>
				<li>Replaces the in-memory <code>this.state</code> synchronously.</li>
				<li>
					Enqueues a persistence write against the DO&apos;s SQLite-backed
					storage. (This is handled by the SDK — you don&apos;t write SQL.)
				</li>
				<li>
					Broadcasts a <code>CF_AGENT_STATE</code> message to every currently
					connected WebSocket client. The <code>useAgent</code> React hook
					picks it up and re-renders.
				</li>
			</ol>

			<h2>State survives restarts</h2>
			<p>
				Durable Object state is persistent by design. The worker process can
				be evicted, the region can fail over, your deployment can cycle — the
				next request to{" "}
				<code>/chat/alice</code> reloads that instance&apos;s state from
				storage. This is usually what you want (agents remember their
				conversations across restarts), but it&apos;s a notable trap in
				development.
			</p>
			<Callout kind="warn" title="Dev state persists too">
				When you&apos;re iterating locally, state persists in{" "}
				<code>.wrangler/</code> across <code>ayjnt dev</code> restarts. If a
				demo script depends on starting fresh, either:
				<ul>
					<li>
						Wipe storage with{" "}
						<code>rm -rf .wrangler && bun run dev</code>.
					</li>
					<li>
						Add a reset endpoint or method to your agent that sets state back
						to <code>initialState</code>, and call it at the top of your
						script.
					</li>
				</ul>
				The <code>examples/inter-agent</code> sample uses both techniques —
				see its client.ts.
			</Callout>

			<h2>State size limits</h2>
			<p>
				Cloudflare DO storage has a per-key-value size limit (currently 128
				KB for SQLite-backed storage, higher for KV-backed storage — check
				the{" "}
				<a
					href="https://developers.cloudflare.com/durable-objects/platform/limits/"
					target="_blank"
					rel="noreferrer"
					className="link-underline"
				>
					Cloudflare DO limits docs
				</a>{" "}
				for current values). <code>setState</code> serializes your whole
				state as one value, so very large states (thousands of messages,
				hundreds of KB of text) start hitting that ceiling.
			</p>
			<p>For chat-like workloads with unbounded growth:</p>
			<ul>
				<li>
					Keep a summary / recent-window in <code>state</code>, archive older
					data to direct DO storage via the lower-level{" "}
					<code>this.ctx.storage</code> API.
				</li>
				<li>
					Or shard by instance — one DO per conversation keeps each
					individual state small.
				</li>
				<li>
					Or externalize to R2/D1 and keep only pointers in agent state.
				</li>
			</ul>
			<p>
				The <code>this.sql</code> helper on the Agent base class gives you
				direct access to the DO&apos;s embedded SQLite; for anything past
				trivial state sizes that&apos;s the API you want.
			</p>

			<h2>Reading state from the client</h2>
			<p>
				When you use the React <code>useAgent</code> hook, the initial state
				arrives on connect (as a <code>CF_AGENT_STATE</code> WebSocket
				message) and every subsequent <code>setState</code> call on the
				server re-broadcasts. The client hook exposes it as{" "}
				<code>agent.state</code>:
			</p>
			<CodeBlock
				filename="agents/chat/app.tsx"
				lang="tsx"
				code={`import { useAgent } from "@ayjnt/chat";

export function Chat() {
  const agent = useAgent();
  // Undefined until the first CF_AGENT_STATE message arrives:
  const messages = agent.state?.messages ?? [];
  // ...
}`}
			/>
			<p>
				<code>agent.state</code> can be <code>undefined</code> before the
				first state message lands. Handle that case — it&apos;s the difference
				between a render that flashes <code>NaN</code> and one that shows a
				loading placeholder. The generated hook types it correctly, so
				TypeScript will force you to handle it.
			</p>

			<Callout kind="tip" title="Writing state from the client">
				<code>agent.setState(newState)</code> also exists on the client. It
				sends an update to the server, which persists and re-broadcasts. This
				is what the <code>with-ui</code> counter example uses — no server
				method needed, just optimistic state replacement from the UI.
			</Callout>
		</DocPageShell>
	);
}
