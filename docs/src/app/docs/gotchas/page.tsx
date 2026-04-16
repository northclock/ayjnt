import Link from "next/link";
import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
	title: "Gotchas — ayjnt docs",
	description:
		"The failure modes we've documented so you don't have to rediscover them. Consolidated in one place for quick reference.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="gotchas"
			lede="Every sharp edge we've found so far, documented. Most of these are surprising on first encounter but obvious in retrospect — the goal is to make them discoverable before you hit them."
		>
			<h2>Client SDK: basePath, not path</h2>
			<p>
				The Agents client SDK builds URLs as{" "}
				<code>/agents/&lt;kebab-class-name&gt;/&lt;instance&gt;</code>.
				<code>path</code> appends to that default; <code>basePath</code>{" "}
				replaces it.
			</p>
			<CodeBlock
				lang="ts"
				code={`// WRONG — appends to the default, hits 404 in an ayjnt worker
useAgent({ agent: "ChatAgent", name: "42", path: "/custom" });
//                  → wss://host/agents/chat-agent/42/custom

// RIGHT — replaces the default
useAgent({ agent: "ChatAgent", basePath: "chat/42" });
//                  → wss://host/chat/42`}
			/>
			<p>
				ayjnt&apos;s URL shape is <code>/&lt;route&gt;/&lt;instance&gt;</code>,
				not <code>/agents/&lt;kebab&gt;/&lt;instance&gt;</code>, so the
				default SDK URL doesn&apos;t match any route in our generated
				worker. <code>basePath</code> is the fix.
			</p>
			<p>
				Full detail:{" "}
				<Link href="/docs/guides/client-integration" className="link-underline">
					Client integration
				</Link>
				.
			</p>

			<h2>Durable Object state persists across dev restarts</h2>
			<p>
				This is correct platform behavior and surprising the first time
				you hit it. <code>rm -rf .wrangler</code> wipes local DO storage;
				without that, state from your previous dev session is still there.
			</p>
			<Callout kind="warn">
				If you&apos;re running a demo script that expects a fresh state
				every time (the <code>inter-agent</code> example, for instance),
				either expose a reset endpoint and call it first, or wipe{" "}
				<code>.wrangler/</code> between runs.
			</Callout>

			<h2>RPC errors propagate — translate at HTTP boundaries</h2>
			<p>
				When you <code>await stub.method(...)</code> and the method
				throws, the exception comes back to the caller. If the caller is
				an HTTP handler and doesn&apos;t catch, the worker returns a 500
				with a plain-text stack trace — breaking any client doing{" "}
				<code>res.json()</code> on it.
			</p>
			<CodeBlock
				lang="ts"
				code={`// BAD — "insufficient stock" → 500 → client crashes on res.json()
const remaining = await inv.decrement(sku, qty);

// GOOD — translate into a 409
try {
  const remaining = await inv.decrement(sku, qty);
  return Response.json({ ok: true, remaining });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ ok: false, error: message }, { status: 409 });
}`}
			/>
			<p>
				Full detail:{" "}
				<Link href="/docs/guides/inter-agent-rpc" className="link-underline">
					Inter-agent RPC
				</Link>
				.
			</p>

			<h2>MCP detection is source-level</h2>
			<p>
				The scanner looks at the literal text{" "}
				<code>extends McpAgent</code> in your source. Aliased imports
				don&apos;t work:
			</p>
			<CodeBlock
				lang="ts"
				code={`// ✗ NOT detected as an MCP agent
import { McpAgent as M } from "agents/mcp";
export default class Tools extends M { ... }

// ✓ Detected
import { McpAgent } from "agents/mcp";
export default class Tools extends McpAgent { ... }`}
			/>
			<p>
				If detection fails, the agent is treated as a regular agent and
				dispatched normally — which means the MCP protocol handler never
				runs and tool calls don&apos;t work.
			</p>

			<h2>tsconfig paths need the leading ./</h2>
			<p>
				TypeScript rejects path mappings without <code>baseUrl</code> set
				unless the path starts with <code>./</code>. This comes up if you
				inline the paths yourself instead of extending{" "}
				<code>.ayjnt/tsconfig.json</code>:
			</p>
			<CodeBlock
				lang="jsonc"
				code={`// WRONG — TS5090: Non-relative paths are not allowed when 'baseUrl' is not set
{
  "paths": {
    "@ayjnt/env": [".ayjnt/env.d.ts"],
    "@ayjnt/*": [".ayjnt/client/*"]
  }
}

// RIGHT
{
  "paths": {
    "@ayjnt/env": ["./.ayjnt/env.d.ts"],
    "@ayjnt/*": ["./.ayjnt/client/*"]
  }
}`}
			/>

			<h2>Don&apos;t consume the response stream in middleware</h2>
			<p>
				Response bodies are streams. If you <code>await res.text()</code>{" "}
				or <code>await res.json()</code> inside middleware and then return
				the original Response, the client sees an empty body — the stream
				was already consumed.
			</p>
			<CodeBlock
				lang="ts"
				code={`// WRONG — consumes the body, the client sees nothing
const res = await next();
await res.text();
return res;

// RIGHT — copy headers + pass the body stream through
const res = await next();
const headers = new Headers(res.headers);
headers.set("x-custom", "value");
return new Response(res.body, {
  status: res.status,
  statusText: res.statusText,
  headers,
});`}
			/>

			<h2>Middleware c.set doesn&apos;t reach the agent</h2>
			<p>
				<code>c.set(&quot;user&quot;, token.user)</code> in middleware is
				visible only to <em>other middleware</em> in the same request. The
				agent runs inside a Durable Object — a different execution context
				— and doesn&apos;t see the stash.
			</p>
			<p>
				To pass a value into the agent, put it in a request header before
				calling <code>next()</code>, or include it in the request body.
			</p>

			<h2>Assets: html_handling must be &ldquo;none&rdquo;</h2>
			<p>
				The generated <code>wrangler.jsonc</code> sets{" "}
				<code>html_handling: &quot;none&quot;</code> on the Assets binding.
				If you override this to the default (<code>auto-trailing-slash</code>),
				Cloudflare redirects <code>/foo/index.html</code> →{" "}
				<code>/foo/</code>, which breaks the <code>useAgent</code> hook (it
				reads <code>window.location.pathname</code> to derive the instance
				name; if the URL gets rewritten, every user ends up on the{" "}
				<code>default</code> instance).
			</p>
			<p>
				Don&apos;t override this unless you know what you&apos;re doing
				and have a plan for deriving the instance differently.
			</p>

			<h2>McpAgent URL shape doesn&apos;t include an instanceId</h2>
			<p>
				Normal agents are at <code>/&lt;route&gt;/&lt;instance&gt;</code>.
				MCP agents are at just <code>/&lt;route&gt;</code>. The MCP
				protocol manages sessions via the <code>Mcp-Session-Id</code>{" "}
				header (or <code>sessionId</code> query param for SSE), and one
				DO instance is created per session.
			</p>
			<p>
				This means you can&apos;t pick an MCP agent&apos;s instance from
				the URL. If you need shared state across sessions (global rate
				limit, counters across all tool calls), keep it in KV or in
				another DO and fetch from tool handlers.
			</p>

			<h2>Renaming a folder without an agentId wipes storage</h2>
			<p>
				Default <code>agentId</code> is derived from the folder path. If
				you rename <code>agents/chat/</code> to{" "}
				<code>agents/messaging/</code> without setting an explicit{" "}
				<code>agentId</code>, the migration diff sees{" "}
				<code>chat</code> as deleted and <code>messaging</code> as new —
				wrangler deletes the old DO storage on next deploy.
			</p>
			<CodeBlock
				lang="ts"
				code={`// Before you rename, add:
export const agentId = "chat_v1";  // stable across folder moves

export default class ChatAgent extends Agent<Env, State> { ... }`}
			/>
			<p>
				Recommended: set <code>agentId</code> on every agent at creation
				time. Details in{" "}
				<Link href="/docs/guides/migrations" className="link-underline">
					Migrations
				</Link>
				.
			</p>

			<h2>Initial state on the client is undefined until first message</h2>
			<p>
				<code>agent.state</code> from <code>useAgent()</code> is{" "}
				<code>undefined</code> until the first <code>CF_AGENT_STATE</code>{" "}
				message arrives over WebSocket. Handle it with optional chaining
				or a loading guard:
			</p>
			<CodeBlock
				lang="tsx"
				code={`const count = agent.state?.count ?? 0;  // safe default
// or
if (!agent.state) return <Loading />;`}
			/>
			<p>
				The generated typed hook types it as <code>State | undefined</code>,
				so TypeScript will force you to handle the undefined case.
			</p>

			<h2>Don&apos;t mutate this.state directly</h2>
			<p>
				<code>this.state</code> looks like a regular object; appending to
				an array on it appears to work. But no persistence hook fires and
				no clients get broadcast. Next hibernation, the mutation is lost.
			</p>
			<CodeBlock
				lang="ts"
				code={`// WRONG
this.state.messages.push(newMsg);

// RIGHT
this.setState({
  ...this.state,
  messages: [...this.state.messages, newMsg],
});`}
			/>

			<h2>When ayjnt deploy refuses</h2>
			<p>
				Three preflight checks gate every deploy. If any fails, the
				deploy aborts. Remedy for each:
			</p>
			<table>
				<thead>
					<tr>
						<th>Error</th>
						<th>Fix</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>uncommitted changes detected</td>
						<td><code>git commit</code> or <code>git stash</code></td>
					</tr>
					<tr>
						<td>N unpushed commits</td>
						<td><code>git push</code></td>
					</tr>
					<tr>
						<td>N unpulled commits from origin</td>
						<td><code>git pull --rebase</code></td>
					</tr>
					<tr>
						<td>pending migration detected</td>
						<td>
							<code>ayjnt build</code>, commit{" "}
							<code>.ayjnt/migrations.json</code>, push, retry.
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				<code>--force</code> exists for emergencies but is loud about it.
				Details in{" "}
				<Link href="/docs/guides/deployment" className="link-underline">
					Deployment
				</Link>
				.
			</p>
		</DocPageShell>
	);
}
