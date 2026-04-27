// Source of truth for the docs sidebar. Pages are organized into four
// arcs that take a reader from "what is this" → "ship something" →
// "use every feature" → "reference". Each entry's `slug` is the URL
// segment after /docs/; the top-level index has no slug.

export type DocsSection = {
	title: string;
	items: DocsItem[];
};

export type DocsItem = {
	slug: string;
	title: string;
	/** One-liner shown on the docs landing page TOC. */
	blurb?: string;
};

export const DOCS_SECTIONS: DocsSection[] = [
	{
		title: "Getting Started",
		items: [
			{
				slug: "getting-started/introduction",
				title: "Introduction",
				blurb:
					"What ayjnt is, who it's for, how it relates to the Cloudflare Agents SDK.",
			},
			{
				slug: "getting-started/installation",
				title: "Installation",
				blurb:
					"Bun, Cloudflare account, and scaffolding your first project with ayjnt new.",
			},
			{
				slug: "getting-started/your-first-agent",
				title: "Your first agent",
				blurb:
					"Build a working agent end-to-end: write, run, and hit it with curl.",
			},
			{
				slug: "getting-started/project-anatomy",
				title: "Project anatomy",
				blurb:
					"Tour the generated .ayjnt/ directory and the files you author vs the files you never touch.",
			},
		],
	},
	{
		title: "Guides",
		items: [
			{
				slug: "guides/file-conventions",
				title: "File conventions",
				blurb:
					"agent.ts, middleware.ts, app.tsx, route groups, nested folders — the tree is the config.",
			},
			{
				slug: "guides/state",
				title: "Agent state",
				blurb:
					"this.state, this.setState, persistence, and the relationship between DOs and agent instances.",
			},
			{
				slug: "guides/routing",
				title: "Routing & URL shape",
				blurb:
					"How folder paths become URLs, route groups, instance id parsing, HTML vs agent dispatch.",
			},
			{
				slug: "guides/middleware",
				title: "Middleware",
				blurb:
					"Writing middleware.ts, root→leaf chaining, short-circuiting, response wrapping, context stash.",
			},
			{
				slug: "guides/inter-agent-rpc",
				title: "Inter-agent RPC",
				blurb:
					"getAgent<T>(), typed DO stubs, method autocomplete, exception propagation, structured clone args.",
			},
			{
				slug: "guides/client-integration",
				title: "Client integration",
				blurb:
					"useAgent, agentFetch, the basePath gotcha, and why ayjnt's URL shape is different.",
			},
			{
				slug: "guides/co-located-ui",
				title: "Co-located React UI",
				blurb:
					"app.tsx next to agent.ts, the generated typed hook, and Cloudflare Assets under the hood.",
			},
			{
				slug: "guides/mcp",
				title: "MCP agents",
				blurb:
					"Extending McpAgent, registering tools, streamable HTTP and SSE, Claude Desktop integration.",
			},
			{
				slug: "guides/migrations",
				title: "Migrations",
				blurb:
					"The committed lockfile, stable agentIds, rename detection, and the git-safety contract.",
			},
			{
				slug: "guides/deployment",
				title: "Deployment",
				blurb:
					"ayjnt deploy, git preflight checks, wrangler passthrough, environments, secrets.",
			},
		],
	},
	{
		title: "Reference",
		items: [
			{
				slug: "reference/cli",
				title: "CLI",
				blurb:
					"Every ayjnt command: arguments, flags, exit codes, forwarded-to-wrangler flags.",
			},
			{
				slug: "reference/runtime-api",
				title: "Runtime API",
				blurb:
					"Every module and export the framework provides: ayjnt, ayjnt/rpc, ayjnt/middleware, @ayjnt/*.",
			},
			{
				slug: "reference/generated-files",
				title: "Generated files",
				blurb:
					"Every file under .ayjnt/ — what it is, whether it's committed, and how it gets regenerated.",
			},
		],
	},
	{
		title: "Troubleshooting",
		items: [
			{
				slug: "gotchas",
				title: "Gotchas",
				blurb:
					"Every failure mode we've documented: basePath vs path, DO state persistence, RPC errors, MCP detection.",
			},
		],
	},
];

/** Flat list in reading order — drives previous/next navigation. */
export const DOCS_ORDER: DocsItem[] = DOCS_SECTIONS.flatMap((s) => s.items);

export function getAdjacent(slug: string): {
	prev: DocsItem | null;
	next: DocsItem | null;
} {
	const idx = DOCS_ORDER.findIndex((i) => i.slug === slug);
	if (idx === -1) return { prev: null, next: null };
	return {
		prev: idx > 0 ? DOCS_ORDER[idx - 1]! : null,
		next: idx < DOCS_ORDER.length - 1 ? DOCS_ORDER[idx + 1]! : null,
	};
}

export function getDocItem(slug: string): DocsItem | undefined {
	return DOCS_ORDER.find((i) => i.slug === slug);
}

export function getSectionFor(slug: string): DocsSection | undefined {
	return DOCS_SECTIONS.find((s) => s.items.some((i) => i.slug === slug));
}
