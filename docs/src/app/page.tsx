import Link from "next/link";
import {
	Code2,
	GitBranch,
	LayoutGrid,
	Package,
} from "lucide-react";
import { ButtonLink } from "@/components/Button";
import { Terminal } from "@/components/Terminal";
import { FileTree } from "@/components/FileTree";
import { FeatureContent } from "@/components/FeatureContent";
import { CodeBlock } from "@/components/CodeBlock";
import { ExampleCard } from "@/components/ExampleCard";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { EXAMPLES } from "@/content/examples";

export default function Home() {
	const featured = EXAMPLES.filter((e) => e.status === "stable").slice(0, 6);
	return (
		<div>
			<Hero />
			<QuickStart />
			<FileTreeShowcase />
			<Features />
			<InterAgent />
			<Pipeline />
			<FeaturedExamples featured={featured} />
			<Cta />
		</div>
	);
}

function Hero() {
	return (
		<section className="relative isolate overflow-hidden border-b border-[var(--ink)]">
			<div className="grid-paper absolute inset-0 opacity-60" />
			<div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 md:pt-28 md:pb-32">
				<span className="tag mb-5">v0.1 · Bun-first · for Cloudflare Workers</span>
				<h1 className="text-balance font-sans text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
					Write the agent.
					<br />
					<span className="relative inline-block">
						ayjnt writes
						<span aria-hidden className="absolute inset-x-0 -bottom-1 h-3 bg-[var(--amber-glow)]" />
					</span>{" "}
					everything else.
				</h1>
				<p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--ink-soft)] md:text-xl">
					Agent-first framework for Cloudflare. File-based routing,
					auto-generated wrangler config, typed inter-agent RPC, co-located
					React UIs, and MCP support — so you can ship Durable Object agents
					without ever opening <code className="font-mono">wrangler.jsonc</code>.
				</p>
				<div className="mt-8 flex flex-wrap items-center gap-3">
					<ButtonLink href="/docs" variant="primary">
						<Code2 className="h-4 w-4" /> Read the docs
					</ButtonLink>
					<ButtonLink href="/examples" variant="secondary">
						<LayoutGrid className="h-4 w-4" /> Browse examples
					</ButtonLink>
					<ButtonLink href="https://github.com/northclock/ayjnt" variant="ghost" external>
						<GitBranch className="h-4 w-4" /> GitHub
					</ButtonLink>
				</div>
			</div>
		</section>
	);
}

function QuickStart() {
	return (
		<section className="border-b border-[var(--ink)] bg-[var(--paper-edge)]">
			<div className="mx-auto grid max-w-6xl items-start gap-10 px-6 py-20 md:grid-cols-[1.1fr_1fr]">
				<div>
					<h2 className="section-title">Quick start</h2>
					<p className="mt-4 max-w-lg text-lg leading-relaxed text-[var(--ink-soft)]">
						One command scaffolds a project with a working agent. A second
						command starts a local Cloudflare worker you can hit from curl or
						the Agents client SDK.
					</p>
					<ul className="mt-6 space-y-3 text-sm">
						{[
							"New project with minimal or with-ui template",
							"Generated wrangler config, migrations, and entry point",
							"HMR-backed dev server that rebuilds on file-tree changes",
						].map((item) => (
							<li key={item} className="flex items-start gap-2">
								<span className="mt-2 inline-block h-1.5 w-1.5 bg-[var(--amber)]" aria-hidden />
								<span className="text-[var(--ink-soft)]">{item}</span>
							</li>
						))}
					</ul>
				</div>
				<Terminal
					title="terminal — zsh"
					lines={[
						{ kind: "command", text: "bunx ayjnt new my-agent-app" },
						{ kind: "output", text: "✓ scaffolded my-agent-app/ (minimal)" },
						{ kind: "blank" },
						{ kind: "command", text: "cd my-agent-app && bun install" },
						{ kind: "output", text: "✓ 237 packages installed [3.2s]" },
						{ kind: "blank" },
						{ kind: "command", text: "bun run dev" },
						{ kind: "success", text: "✓ ayjnt: 1 agent(s) → .ayjnt/dist/wrangler.jsonc" },
						{ kind: "output", text: "⎔ Listening on http://localhost:8787" },
					]}
				/>
			</div>
		</section>
	);
}

function FileTreeShowcase() {
	return (
		<section className="border-b border-[var(--ink)]">
			<div className="mx-auto grid max-w-6xl items-start gap-10 px-6 py-20 md:grid-cols-[1fr_1.1fr]">
				<FileTree
					title="agents/ — the whole API"
					root={[
						{
							type: "folder",
							name: "agents",
							defaultOpen: true,
							children: [
								{
									type: "folder",
									name: "chat",
									defaultOpen: true,
									children: [
										{ type: "file", name: "agent.ts", kind: "ts", note: "state + methods" },
										{ type: "file", name: "app.tsx", kind: "tsx", note: "React UI" },
									],
								},
								{
									type: "folder",
									name: "admin",
									defaultOpen: true,
									children: [
										{ type: "file", name: "middleware.ts", kind: "ts", note: "auth" },
										{
											type: "folder",
											name: "users",
											defaultOpen: true,
											children: [{ type: "file", name: "agent.ts", kind: "ts" }],
										},
									],
								},
								{
									type: "folder",
									name: "(public)",
									defaultOpen: true,
									note: "route group",
									children: [
										{
											type: "folder",
											name: "status",
											defaultOpen: true,
											children: [{ type: "file", name: "agent.ts", kind: "ts" }],
										},
									],
								},
							],
						},
					]}
				/>
				<div>
					<h2 className="section-title">The folder is the framework</h2>
					<p className="mt-4 text-lg leading-relaxed text-[var(--ink-soft)]">
						The shape you draft in <code className="font-mono">agents/</code>{" "}
						maps 1:1 to URLs, DO bindings, migrations, and the worker
						entrypoint. There is no config file to author — just files and
						folders.
					</p>
					<dl className="mt-8 grid gap-5 sm:grid-cols-2">
						<div>
							<dt className="font-mono text-xs uppercase tracking-widest text-[var(--amber)]">agent.ts</dt>
							<dd className="mt-1 text-sm text-[var(--ink-soft)]">
								One default-exported class per folder. Name + state + methods.
							</dd>
						</div>
						<div>
							<dt className="font-mono text-xs uppercase tracking-widest text-[var(--amber)]">middleware.ts</dt>
							<dd className="mt-1 text-sm text-[var(--ink-soft)]">
								Applies to descendant agents. Root → leaf chaining, Hono-style{" "}
								<code className="font-mono">next()</code>.
							</dd>
						</div>
						<div>
							<dt className="font-mono text-xs uppercase tracking-widest text-[var(--amber)]">app.tsx</dt>
							<dd className="mt-1 text-sm text-[var(--ink-soft)]">
								Optional React UI. Gets a typed{" "}
								<code className="font-mono">useAgent()</code> bound to this
								folder.
							</dd>
						</div>
						<div>
							<dt className="font-mono text-xs uppercase tracking-widest text-[var(--amber)]">(parens)</dt>
							<dd className="mt-1 text-sm text-[var(--ink-soft)]">
								Route groups — share middleware without nesting the URL.
							</dd>
						</div>
					</dl>
				</div>
			</div>
		</section>
	);
}

function Features() {
	return (
		<section className="border-b border-[var(--ink)] bg-[var(--paper)]">
			<div className="mx-auto max-w-6xl px-6 py-20">
				<header className="mb-10 max-w-2xl">
					<h2 className="section-title">What you get</h2>
					<p className="mt-3 text-lg leading-relaxed text-[var(--ink-soft)]">
						Six tools-in-one: routing, migrations, RPC, UI, MCP, dev loop.
						None of the glue.{" "}
						<span className="font-mono text-xs uppercase tracking-widest text-[var(--amber)]">
							click any card for a visual deep-dive
						</span>
					</p>
				</header>
				<FeatureContent />
			</div>
		</section>
	);
}

async function InterAgent() {
	const code = `// agents/orders/agent.ts
import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type InventoryAgent from "../inventory/agent.ts";

export default class OrdersAgent extends Agent<Env, State> {
  override async onRequest(request: Request): Promise<Response> {
    const { sku, qty } = await request.json();
    const inventory = await getAgent<InventoryAgent>(
      this.env.INVENTORY_AGENT,
      "main",
    );
    const remaining = await inventory.decrement(sku, qty);
    return Response.json({ ok: true, remaining });
  }
}`;
	return (
		<section className="border-b border-[var(--ink)] bg-[var(--paper-edge)]">
			<div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 md:grid-cols-[1.1fr_1fr]">
				<div>
					<h2 className="section-title">Agents that call each other, typed.</h2>
					<p className="mt-4 text-lg leading-relaxed text-[var(--ink-soft)]">
						<code className="font-mono">getAgent&lt;T&gt;</code> returns a
						typed DurableObject stub. Method autocomplete from the target
						class. Errors propagate across the RPC boundary as exceptions.
						Rename a method and both sides break at compile time.
					</p>
					<ul className="mt-6 space-y-3 text-sm">
						{[
							["native Workers RPC", "no HTTP, no JSON round-trip"],
							["method autocomplete", "from the target class"],
							["exceptions propagate", "throw in callee, catch in caller"],
						].map(([k, v]) => (
							<li key={k} className="flex items-baseline gap-3">
								<span className="font-mono text-xs uppercase tracking-widest text-[var(--amber)]">
									{k}
								</span>
								<span className="text-[var(--ink-soft)]">→ {v}</span>
							</li>
						))}
					</ul>
				</div>
				<CodeBlock
					filename="agents/orders/agent.ts"
					lang="ts"
					code={code}
					highlightLines={[3, 9, 10, 11, 12]}
				/>
			</div>
		</section>
	);
}

function Pipeline() {
	return (
		<section className="border-b border-[var(--ink)]">
			<div className="mx-auto max-w-6xl px-6 py-20">
				<header className="mb-10 max-w-2xl">
					<h2 className="section-title">Under the hood</h2>
					<p className="mt-3 text-lg leading-relaxed text-[var(--ink-soft)]">
						Every build is a pure function of your file tree. The pipeline is
						small and inspectable — peek at{" "}
						<code className="font-mono">.ayjnt/dist/entry.ts</code> any time.
					</p>
				</header>
				<ArchitectureDiagram />
			</div>
		</section>
	);
}

function FeaturedExamples({ featured }: { featured: typeof EXAMPLES }) {
	return (
		<section className="border-b border-[var(--ink)] bg-[var(--paper-edge)]">
			<div className="mx-auto max-w-6xl px-6 py-20">
				<header className="mb-10 flex items-end justify-between gap-4">
					<div className="max-w-2xl">
						<h2 className="section-title">Build these</h2>
						<p className="mt-3 text-lg leading-relaxed text-[var(--ink-soft)]">
							Every example in the gallery has a scaffold command, the code
							you&apos;d add to which file, an animated terminal walkthrough,
							and the deploy step.
						</p>
					</div>
					<Link href="/examples" className="link-underline hidden shrink-0 font-mono text-sm md:inline">
						All examples →
					</Link>
				</header>
				<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
					{featured.map((e) => (
						<ExampleCard key={e.slug} example={e} />
					))}
				</div>
			</div>
		</section>
	);
}

function Cta() {
	return (
		<section className="relative border-b border-[var(--ink)]">
			<div className="grid-paper-dots absolute inset-0 opacity-50" />
			<div className="relative mx-auto max-w-4xl px-6 py-20 text-center">
				<h2 className="section-title inline-block">Ready when you are.</h2>
				<p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[var(--ink-soft)]">
					One command scaffolds the project. One command ships it.
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<ButtonLink href="/docs" variant="primary">
						<Code2 className="h-4 w-4" /> Start the docs
					</ButtonLink>
					<ButtonLink href="https://www.npmjs.com/package/ayjnt" variant="secondary" external>
						<Package className="h-4 w-4" /> ayjnt on npm
					</ButtonLink>
					<ButtonLink href="https://github.com/northclock/ayjnt" variant="ghost" external>
						<GitBranch className="h-4 w-4" /> Source on GitHub
					</ButtonLink>
				</div>
			</div>
		</section>
	);
}
