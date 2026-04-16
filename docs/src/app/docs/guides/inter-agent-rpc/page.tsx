import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
	title: "Inter-agent RPC — ayjnt docs",
	description:
		"Calling one agent's methods from another. Typed DO stubs, method autocomplete, exception propagation, and the structured-clone contract.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="guides/inter-agent-rpc"
			lede="One agent can call another's methods directly via getAgent<T>. Typed at compile time, native Workers RPC at runtime, no HTTP round-trip."
		>
			<h2>Why this exists</h2>
			<p>
				Cloudflare Agents are Durable Objects, and DOs already support RPC
				between instances. The SDK ships{" "}
				<code>getAgentByName(namespace, name)</code> which returns a typed
				stub. ayjnt wraps it as{" "}
				<code>getAgent&lt;T&gt;(namespace, name)</code> with a nicer generic
				order, so the call site reads cleanly without threading <code>Env</code>{" "}
				as a type argument.
			</p>

			<h2>Signature</h2>
			<CodeBlock
				lang="ts"
				code={`import { getAgent } from "ayjnt/rpc";

function getAgent<T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
  name: string,
): Promise<DurableObjectStub<T>>;`}
			/>

			<p>
				<code>T</code> is the agent class. <code>namespace</code> is the DO
				binding from your env (<code>env.INVENTORY_AGENT</code>).{" "}
				<code>name</code> is the instance id — same thing you&apos;d use in a
				URL. The returned stub is typed to <code>T</code>, so every method
				declared on the class is available with full argument and return
				type inference.
			</p>

			<h2>A complete example</h2>
			<p>
				The callee holds the stock counters and exposes a method that can
				throw:
			</p>
			<CodeBlock
				filename="agents/inventory/agent.ts"
				lang="ts"
				code={`import { Agent } from "agents";

type State = { stock: Record<string, number> };

export default class InventoryAgent extends Agent<{}, State> {
  override initialState: State = { stock: { widget: 10 } };

  async decrement(sku: string, qty: number): Promise<number> {
    const current = this.state.stock[sku] ?? 0;
    if (current < qty) {
      throw new Error(\`insufficient stock for \${sku}: have \${current}\`);
    }
    const remaining = current - qty;
    this.setState({ stock: { ...this.state.stock, [sku]: remaining } });
    return remaining;
  }
}`}
				highlightLines={[8, 9, 10, 11]}
			/>
			<p>
				The caller imports the <em>type</em> of the callee, declares its
				binding in <code>Env</code>, and calls the method:
			</p>
			<CodeBlock
				filename="agents/orders/agent.ts"
				lang="ts"
				code={`import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type InventoryAgent from "../inventory/agent.ts";

type Env = {
  INVENTORY_AGENT: DurableObjectNamespace<InventoryAgent>;
};

type State = { orders: { sku: string; qty: number; remaining: number }[] };

export default class OrdersAgent extends Agent<Env, State> {
  override initialState: State = { orders: [] };

  override async onRequest(request: Request): Promise<Response> {
    const { sku, qty } = (await request.json()) as { sku: string; qty: number };
    try {
      const inv = await getAgent<InventoryAgent>(this.env.INVENTORY_AGENT, "main");
      const remaining = await inv.decrement(sku, qty);
      this.setState({
        orders: [...this.state.orders, { sku, qty, remaining }],
      });
      return Response.json({ ok: true, remaining });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: message }, { status: 409 });
    }
  }
}`}
				highlightLines={[2, 3, 17, 18, 23, 24]}
			/>

			<h2>What happens at runtime</h2>
			<ol>
				<li>
					<code>getAgent</code> internally calls{" "}
					<code>env.INVENTORY_AGENT.idFromName(&quot;main&quot;)</code> and{" "}
					<code>.get(id)</code> to get a stub.
				</li>
				<li>
					It calls <code>stub.setName(&quot;main&quot;)</code> so the
					target DO knows its own identity (same reason the dispatch layer
					does this — see{" "}
					<a href="/docs/guides/routing" className="link-underline">
						Routing
					</a>
					).
				</li>
				<li>
					<code>await inv.decrement(sku, qty)</code> triggers Workers
					native DO RPC. The call is serialized (structured clone), sent to
					the target DO, executed, and the return value or thrown exception
					comes back the same way.
				</li>
				<li>
					If the callee throws, the caller&apos;s <code>await</code> re-throws
					the same error. Exception propagation just works.
				</li>
			</ol>

			<h2>Typing guarantees</h2>
			<ul>
				<li>
					Method names autocomplete on the stub —{" "}
					<code>inv.decrement</code> shows up in your editor, arbitrary
					strings don&apos;t.
				</li>
				<li>Argument types are checked. <code>inv.decrement(&quot;widget&quot;)</code> is a compile error.</li>
				<li>
					Return type is inferred. <code>remaining: number</code> without
					annotating it.
				</li>
				<li>
					Rename <code>decrement</code> → <code>debit</code> on the callee
					and TypeScript immediately flags every call site.
				</li>
			</ul>

			<h2>Five gotchas worth memorizing</h2>

			<h3>Arguments must be structured-cloneable</h3>
			<p>
				Workers RPC uses structured clone to cross the DO boundary. Plain
				data — strings, numbers, arrays, plain objects, <code>Uint8Array</code>,{" "}
				<code>Map</code>, <code>Set</code> — works. What doesn&apos;t:
			</p>
			<ul>
				<li>Functions</li>
				<li>Class instances with methods</li>
				<li>DOM nodes / React elements</li>
				<li>WebSocket / Request / Response objects (use their plain fields instead)</li>
			</ul>
			<p>
				See{" "}
				<a
					href="https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/"
					target="_blank"
					rel="noreferrer"
					className="link-underline"
				>
					Cloudflare&apos;s RPC lifecycle docs
				</a>{" "}
				for the full list.
			</p>

			<h3>Errors propagate — translate at HTTP boundaries</h3>
			<Callout kind="warn" title="Common failure mode">
				<p>
					<code>InventoryAgent.decrement</code> throws &ldquo;insufficient
					stock&rdquo;. The caller <code>await inv.decrement(...)</code>{" "}
					re-throws it. If the caller&apos;s <code>onRequest</code> doesn&apos;t
					catch, the worker returns a <code>500</code> with a plain-text
					stack trace. Any client doing <code>res.json()</code> on that
					response crashes with &ldquo;Failed to parse JSON.&rdquo;
				</p>
				<p>
					The fix (shown in the example above): wrap every{" "}
					<code>getAgent</code> call in <code>try/catch</code> and translate
					domain errors into structured responses with meaningful status
					codes. A <code>409 Conflict</code> with{" "}
					<code>{`{ ok: false, error }`}</code> is a lot easier to handle
					client-side than a 500 plus stack trace.
				</p>
			</Callout>

			<h3>Every call is an async trip</h3>
			<p>
				Each <code>await stub.method(...)</code> round-trips to the target
				DO, possibly on another machine. It&apos;s much cheaper than HTTP
				(no URL parsing, no body parse), but it isn&apos;t free — sequential
				awaits in a loop will be slow.
			</p>
			<CodeBlock
				lang="ts"
				code={`// Bad: N round-trips
for (const item of items) {
  await inv.decrement(item.sku, item.qty);
}

// Better: one method that handles the batch
await inv.decrementMany(items);`}
			/>
			<p>
				When you catch yourself making N RPC calls, consider adding a batch
				method to the callee.
			</p>

			<h3>The binding type is your responsibility (for now)</h3>
			<p>
				The caller&apos;s <code>Env</code> must declare{" "}
				<code>DurableObjectNamespace&lt;InventoryAgent&gt;</code> on the
				binding you&apos;re using. ayjnt generates <code>GeneratedEnv</code>{" "}
				with these types filled in — extend it:
			</p>
			<CodeBlock
				lang="ts"
				code={`import type { GeneratedEnv } from "@ayjnt/env";

export default class OrdersAgent extends Agent<GeneratedEnv, State> {
  // this.env.INVENTORY_AGENT is now typed to DurableObjectNamespace<InventoryAgent>
}`}
			/>
			<p>
				If you need extra non-DO bindings,{" "}
				<code>type MyEnv = GeneratedEnv &amp; {`{ KV: KVNamespace }`}</code>.
			</p>

			<h3>Methods vs. onRequest — pick by use case</h3>
			<p>
				Methods are great for server-to-server calls where types matter and
				HTTP ceremony is wasteful. For client-facing interaction, prefer{" "}
				<code>onRequest</code> (REST-style) or WebSocket state sync (via the
				SDK&apos;s connection API). Methods aren&apos;t accessible from the
				outside world directly — only from other workers, agents, or
				WebSocket RPC.
			</p>

			<h2>Sharding — picking the right instance id</h2>
			<p>
				<code>getAgent&lt;T&gt;(namespace, &quot;main&quot;)</code> always
				talks to the <em>same</em> instance, because &ldquo;main&rdquo; is a
				single string. If you need concurrency / independence, shard the
				instance id:
			</p>
			<CodeBlock
				lang="ts"
				code={`// Single global inventory — serializes all decrements through one DO.
const inv = await getAgent<InventoryAgent>(env.INVENTORY_AGENT, "main");

// One inventory per SKU — separate DOs, separate storage, decrements in parallel.
const inv = await getAgent<InventoryAgent>(env.INVENTORY_AGENT, sku);

// One per warehouse — scales with warehouses, locality per region.
const inv = await getAgent<InventoryAgent>(env.INVENTORY_AGENT, warehouseId);`}
			/>
			<p>
				This is the same decision you make when using the SDK directly —
				it&apos;s a DO design question, not an ayjnt one. But it&apos;s the
				first thing to think about when designing a multi-agent system.
			</p>
		</DocPageShell>
	);
}
