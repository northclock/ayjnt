import Link from "next/link";
import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
	title: "Introduction — ayjnt docs",
	description:
		"What ayjnt is, why it exists, and how it sits on top of the Cloudflare Agents SDK.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="getting-started/introduction"
			lede="ayjnt is a thin, Bun-first framework for building Cloudflare Durable Object agents. It eliminates the config work around Agents so you can spend your time on the agent itself."
		>
			<h2>The problem</h2>
			<p>
				Cloudflare Agents are great. Setting them up is not. Every new agent
				means another entry in{" "}
				<code>wrangler.jsonc</code>, another Durable Object binding, another
				migration tag, another line in your worker&apos;s <code>fetch</code>{" "}
				handler to route requests to the right class. For a single agent this
				is fine. For a dozen agents with middleware, UI, and cross-calls, it
				becomes the majority of your work.
			</p>
			<p>
				ayjnt collapses that glue into a file-tree convention. Folders under{" "}
				<code>agents/</code> become agents, nested folders become nested URLs,
				and the framework writes the worker entrypoint, the wrangler config,
				and the DO migrations for you on every build.
			</p>

			<h2>What you get</h2>
			<p>
				Six capabilities that usually each take their own setup, built in:
			</p>
			<ul>
				<li>
					<strong>File-based routing.</strong> The folder tree is the API.
					One <code>agent.ts</code> per folder becomes one DO binding and one
					URL prefix. Route groups (parens) share middleware without leaking
					into the URL.
				</li>
				<li>
					<strong>Git-safe migrations.</strong>{" "}
					<code>.ayjnt/migrations.json</code> is committed to your repo and{" "}
					<code>ayjnt deploy</code> refuses to run from an out-of-sync tree.
					Two developers can&apos;t race a deploy and produce divergent DO
					schemas in production.
				</li>
				<li>
					<strong>Typed inter-agent RPC.</strong>{" "}
					<code>getAgent&lt;T&gt;(env.BINDING, id)</code> returns a typed
					Durable Object stub with method autocomplete from the target class.
					Errors propagate as exceptions.
				</li>
				<li>
					<strong>Co-located React UIs.</strong> Drop an{" "}
					<code>app.tsx</code> next to <code>agent.ts</code>. A generated
					typed <code>useAgent()</code> hook is available at{" "}
					<code>@ayjnt/&lt;route&gt;</code>. State syncs across every
					connected tab automatically.
				</li>
				<li>
					<strong>MCP agents.</strong> Classes extending{" "}
					<code>McpAgent</code> route through the SDK&apos;s{" "}
					<code>McpAgent.serve()</code> handler automatically — streamable
					HTTP + SSE transports are handled for you.
				</li>
				<li>
					<strong>HMR-backed dev loop.</strong> <code>ayjnt dev</code>{" "}
					watches <code>agents/</code>, re-runs codegen when the file tree
					changes, and lets <code>wrangler dev</code> reload. Full rebuilds
					take single-digit milliseconds via{" "}
					<a href="https://bunup.dev" className="link-underline">
						bunup
					</a>
					.
				</li>
			</ul>

			<h2>Who it&apos;s for</h2>
			<p>
				TypeScript engineers shipping one or more agents on Cloudflare Workers
				— from a single chat agent to a fleet of coordinating services. ayjnt
				is intentionally Bun-first: the CLI is a Bun script, the framework is
				written in TypeScript we ship as source, and the bundler is Bun. If
				your team is on Node without Bun, ayjnt still works (the compiled JS
				is shipped to npm), but the dev experience is smoother on Bun.
			</p>

			<h2>Relationship to the Cloudflare Agents SDK</h2>
			<p>
				ayjnt is a layer on top of{" "}
				<a
					href="https://developers.cloudflare.com/agents/"
					target="_blank"
					rel="noreferrer"
					className="link-underline"
				>
					Cloudflare&apos;s Agents SDK
				</a>
				. You still extend <code>Agent</code> from the <code>agents</code>{" "}
				package, and every runtime feature — state, <code>this.setState</code>
				, scheduling, WebSockets, identity messages — comes from the SDK, not
				from ayjnt. What ayjnt adds is build-time:
			</p>
			<ul>
				<li>Scanning the <code>agents/</code> folder for DO classes</li>
				<li>Emitting the worker entrypoint + dispatch logic</li>
				<li>Emitting the <code>wrangler.jsonc</code> including DO bindings and migrations</li>
				<li>Generating per-agent typed React hooks</li>
				<li>Enforcing the git-safe migration contract at deploy time</li>
			</ul>
			<p>
				When something goes wrong at runtime — a request handler throws, a
				WebSocket disconnects, the Agent SDK misbehaves — the Cloudflare docs
				are the authoritative reference. When something goes wrong at build
				time — the wrong migration was staged, the URL shape is unexpected,
				the generated entry.ts does something odd — that&apos;s on ayjnt.
			</p>
			<Callout kind="note" title="Not affiliated">
				ayjnt is an independent open-source project. It&apos;s not made by
				Cloudflare, and Cloudflare doesn&apos;t sponsor or support it.
			</Callout>

			<h2>Where to go next</h2>
			<p>If you&apos;re ready to install:</p>
			<CodeBlock
				lang="sh"
				code={`bunx ayjnt new my-app
cd my-app && bun install
bun run dev`}
			/>
			<p>
				Then read{" "}
				<Link href="/docs/getting-started/installation" className="link-underline">
					Installation
				</Link>{" "}
				for the full setup and{" "}
				<Link
					href="/docs/getting-started/your-first-agent"
					className="link-underline"
				>
					Your first agent
				</Link>{" "}
				for a walkthrough with code. If you want the feature tour first, the{" "}
				<Link href="/" className="link-underline">
					home page
				</Link>{" "}
				has click-to-expand cards for each of the six pillars.
			</p>
		</DocPageShell>
	);
}
