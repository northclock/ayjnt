import Link from "next/link";
import {
	ArrowRight,
	Cloud,
	GitBranch,
	Package,
	Terminal as TerminalIcon,
} from "lucide-react";
import { ButtonLink } from "@/components/Button";
import { CodeBlock } from "@/components/CodeBlock";
import { DOCS_SECTIONS } from "@/content/docs-nav";

export const metadata = {
	title: "Docs — ayjnt",
	description:
		"Comprehensive documentation for ayjnt — concepts, guides, reference, and troubleshooting, from beginner to expert.",
};

export default function DocsIndex() {
	return (
		<div>
			<header className="mb-10 border-b border-[var(--rule-strong)] pb-6">
				<span className="tag mb-3 inline-block">documentation</span>
				<h1 className="font-sans text-[38px] font-semibold leading-tight tracking-tight">
					Everything you need to ship an agent.
				</h1>
				<p className="mt-3 max-w-3xl text-[18px] leading-relaxed text-[var(--ink-soft)]">
					ayjnt is a thin framework over the Cloudflare Agents SDK. These
					docs walk you from your first scaffold to the last detail of
					the build pipeline. Read top-to-bottom to ramp up, or jump
					straight to the reference for daily lookups.
				</p>
				<div className="mt-6 flex flex-wrap gap-3">
					<ButtonLink
						href="/docs/getting-started/introduction"
						variant="primary"
					>
						<ArrowRight className="h-4 w-4" />
						Start reading
					</ButtonLink>
					<ButtonLink
						href="https://github.com/northclock/ayjnt"
						variant="secondary"
						external
					>
						<GitBranch className="h-4 w-4" />
						Source on GitHub
					</ButtonLink>
					<ButtonLink
						href="https://www.npmjs.com/package/ayjnt"
						variant="ghost"
						external
					>
						<Package className="h-4 w-4" />
						ayjnt on npm
					</ButtonLink>
				</div>
			</header>

			<QuickStart />

			<div className="mt-16 flex flex-col gap-12">
				{DOCS_SECTIONS.map((section, i) => (
					<section key={section.title}>
						<header className="mb-5 flex items-center gap-3">
							<span className="inline-flex h-7 w-7 items-center justify-center border border-[var(--ink)] bg-[var(--paper)] font-mono text-[11px] font-semibold">
								{String(i + 1).padStart(2, "0")}
							</span>
							<h2 className="font-sans text-[22px] font-semibold tracking-tight">
								{section.title}
							</h2>
						</header>
						<ol className="grid gap-3 md:grid-cols-2">
							{section.items.map((item) => (
								<li key={item.slug}>
									<Link
										href={`/docs/${item.slug}`}
										className="card card-interactive group flex h-full flex-col gap-1.5 p-4"
									>
										<span className="flex items-center justify-between">
											<span className="font-mono text-[13px] font-semibold">
												{item.title}
											</span>
											<ArrowRight className="h-3.5 w-3.5 text-[var(--ink-muted)] transition-colors group-hover:text-[var(--amber)]" />
										</span>
										{item.blurb && (
											<span className="text-[14px] leading-snug text-[var(--ink-soft)]">
												{item.blurb}
											</span>
										)}
									</Link>
								</li>
							))}
						</ol>
					</section>
				))}
			</div>

			<section className="mt-16 border-t border-[var(--rule-strong)] pt-8">
				<header className="mb-5 flex items-center gap-3">
					<Cloud className="h-5 w-5 text-[var(--ink-muted)]" />
					<h2 className="font-sans text-[22px] font-semibold tracking-tight">
						Cloudflare Agents reference
					</h2>
				</header>
				<p className="mb-4 max-w-3xl text-[15.5px] leading-relaxed text-[var(--ink-soft)]">
					ayjnt is built on top of Cloudflare&apos;s Agents SDK. For API
					reference, transport details, and Cloudflare-specific features
					(Workers AI, D1, R2, KV bindings, etc.) consult the official docs.
					ayjnt is not affiliated with Cloudflare.
				</p>
				<ul className="grid gap-3 md:grid-cols-2">
					{[
						{
							title: "Agents API reference",
							href: "https://developers.cloudflare.com/agents/api-reference/agents-api/",
						},
						{
							title: "Configuration (wrangler.jsonc)",
							href: "https://developers.cloudflare.com/agents/api-reference/configuration/",
						},
						{
							title: "Client SDK (useAgent, agentFetch)",
							href: "https://developers.cloudflare.com/agents/api-reference/client-sdk/",
						},
						{
							title: "Calling agents from another worker",
							href: "https://developers.cloudflare.com/agents/api-reference/calling-agents/",
						},
						{
							title: "Scheduling + alarms",
							href: "https://developers.cloudflare.com/agents/api-reference/schedule-tasks/",
						},
						{
							title: "Model Context Protocol (MCP)",
							href: "https://developers.cloudflare.com/agents/model-context-protocol/",
						},
					].map((item) => (
						<li key={item.href}>
							<a
								href={item.href}
								target="_blank"
								rel="noreferrer"
								className="card card-interactive flex items-center justify-between p-4"
							>
								<div>
									<div className="font-mono text-[13px] font-semibold">
										{item.title}
									</div>
									<div className="mt-0.5 truncate font-mono text-[11px] text-[var(--ink-muted)]">
										{item.href.replace(/^https:\/\//, "")}
									</div>
								</div>
								<ArrowRight className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
							</a>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}

/**
 * Opinionated five-minute quick start, right at the top of the docs
 * landing so a reader can go from zero to running agent without clicking
 * into individual pages first. Full walkthrough is under
 * /docs/getting-started/* — this is the pre-read.
 */
function QuickStart() {
	return (
		<section className="mt-4 border border-[var(--ink)] bg-[var(--paper-edge)]">
			<header className="flex items-center gap-3 border-b border-[var(--ink)] bg-[var(--paper)] px-5 py-3">
				<span
					className="inline-flex h-7 w-7 items-center justify-center border border-[var(--ink)] bg-[var(--amber-glow)]"
					aria-hidden
				>
					<TerminalIcon className="h-4 w-4" />
				</span>
				<div>
					<div className="font-mono text-[10px] uppercase tracking-widest text-[var(--amber)]">
						Quick start
					</div>
					<h2 className="font-sans text-[18px] font-semibold leading-tight">
						From zero to running agent in four steps
					</h2>
				</div>
				<Link
					href="/docs/getting-started/introduction"
					className="ml-auto hidden font-mono text-[11px] uppercase tracking-widest text-[var(--ink-muted)] hover:text-[var(--ink)] md:inline-flex"
				>
					Full walkthrough →
				</Link>
			</header>

			<div className="grid gap-6 p-5 md:grid-cols-[1fr_1.1fr] md:gap-8 md:p-8">
				<ol className="flex flex-col gap-5">
					<Step
						n={1}
						title="Install Bun"
						sub="ayjnt is Bun-first"
						command="curl -fsSL https://bun.com/install | bash"
					/>
					<Step
						n={2}
						title="Scaffold a project"
						sub="Minimal or with React UI"
						command="bunx ayjnt new my-app --with-ui"
					/>
					<Step
						n={3}
						title="Install + dev"
						sub="wrangler dev with live reload"
						command="cd my-app && bun install && bun run dev"
					/>
					<Step
						n={4}
						title="Deploy"
						sub="Git preflight, then wrangler deploy"
						command="bun run deploy"
					/>
				</ol>

				<CodeBlock
					filename="my-app/agents/counter/agent.ts"
					lang="ts"
					code={`import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { count: number };

export default class CounterAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { count: 0 };

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}`}
					highlightLines={[1, 2, 6, 7]}
				/>
			</div>
		</section>
	);
}

function Step({
	n,
	title,
	sub,
	command,
}: {
	n: number;
	title: string;
	sub: string;
	command: string;
}) {
	return (
		<li className="flex items-start gap-3">
			<span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--ink)] bg-[var(--paper)] font-mono text-[11px] font-semibold">
				{String(n).padStart(2, "0")}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-3">
					<h3 className="font-sans text-[15px] font-semibold text-[var(--ink)]">
						{title}
					</h3>
					<span className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
						{sub}
					</span>
				</div>
				<pre className="mt-2 overflow-x-auto border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 font-mono text-[12.5px] leading-snug">
					<span className="mr-2 text-[var(--amber)]">$</span>
					<span>{command}</span>
				</pre>
			</div>
		</li>
	);
}
