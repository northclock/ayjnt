"use client";

import Link from "next/link";
import {
	CircuitBoard,
	FileStack,
	GitBranch,
	LayoutGrid,
	Plug,
	Zap,
} from "lucide-react";
import { FeatureGrid, type FeatureItem } from "./FeatureGrid";
import { FileRoutingViz } from "./viz/FileRoutingViz";
import { MigrationsViz } from "./viz/MigrationsViz";
import { RpcViz } from "./viz/RpcViz";
import { CoLocatedViz } from "./viz/CoLocatedViz";
import { McpViz } from "./viz/McpViz";
import { HmrViz } from "./viz/HmrViz";

const ICON = "h-5 w-5";

/**
 * The six pillar features. Each item has a short sell (blurb), a deep-
 * dive explanation (detail), and a purpose-built animated visualization
 * (viz). Keep these together in one module so the list + the viz
 * imports + the deep-dive copy stay in sync when we tweak the story.
 */
const ITEMS: FeatureItem[] = [
	{
		id: "file-routing",
		icon: <FileStack className={ICON} strokeWidth={1.75} />,
		title: "File-based routing",
		blurb:
			"Folder = agent. Nested folders = nested URLs. Route groups share middleware without leaking into the URL.",
		detail: (
			<>
				<p>
					Every folder under <code className="font-mono">agents/</code> with
					an <code className="font-mono">agent.ts</code> becomes one Durable
					Object-backed agent. The folder path is the URL prefix.{" "}
					<code className="font-mono">agents/admin/users/agent.ts</code> →{" "}
					<code className="font-mono">/admin/users/:id</code>.
				</p>
				<p className="mt-3">
					Route groups (parens) don&apos;t appear in the URL but still
					contribute to the middleware chain. Use them when a handful of
					agents should share auth without living under a common segment.
				</p>
				<p className="mt-3 font-mono text-[13px] text-[var(--ink-muted)]">
					No config file. The folder tree is the config.
				</p>
			</>
		),
		viz: <FileRoutingViz />,
		cta: (
			<Link
				href="/examples/basic"
				className="link-underline font-mono text-xs uppercase tracking-widest"
			>
				See the basic example →
			</Link>
		),
	},
	{
		id: "migrations",
		icon: <GitBranch className={ICON} strokeWidth={1.75} />,
		title: "Git-safe migrations",
		blurb:
			".ayjnt/migrations.json is committed. Deploy refuses to run from an out-of-sync tree.",
		detail: (
			<>
				<p>
					Durable Object schemas evolve with <em>migrations</em>. ayjnt
					tracks them in <code className="font-mono">.ayjnt/migrations.json</code>{" "}
					— a committed lockfile that records every add, rename, and delete.
				</p>
				<p className="mt-3">
					The crucial rule: <code className="font-mono">ayjnt deploy</code>{" "}
					refuses to run unless <code>git status</code> is clean and your
					branch matches <code>origin/&lt;branch&gt;</code>. Two developers
					can&apos;t race a deploy and produce divergent migration histories
					in production.
				</p>
				<p className="mt-3">
					Renames are detected by a stable <code className="font-mono">agentId</code>{" "}
					— derived from the folder path or set explicitly — so you can
					rename a class without losing DO storage.
				</p>
			</>
		),
		viz: <MigrationsViz />,
		cta: (
			<Link
				href="/docs#migrations-as-lockfile"
				className="link-underline font-mono text-xs uppercase tracking-widest"
			>
				Read the migrations docs →
			</Link>
		),
	},
	{
		id: "rpc",
		icon: <Plug className={ICON} strokeWidth={1.75} />,
		title: "Typed inter-agent RPC",
		blurb:
			"getAgent<T>(env.BINDING, id). Native Workers RPC, method autocomplete, exceptions cross the boundary.",
		detail: (
			<>
				<p>
					One agent can call another&apos;s methods directly.{" "}
					<code className="font-mono">
						getAgent&lt;InventoryAgent&gt;(this.env.INVENTORY_AGENT, id)
					</code>{" "}
					returns a typed Durable Object stub — you get method autocomplete
					from the target class, argument validation, and typed return
					values.
				</p>
				<p className="mt-3">
					This is not HTTP. It&apos;s Workers DO RPC: no URL parsing, no
					JSON round-trip, exceptions propagate as exceptions across the
					call site. Rename a method on the callee and TypeScript breaks
					both ends at compile time.
				</p>
				<p className="mt-3 font-mono text-[13px] text-[var(--ink-muted)]">
					Catch errors at your HTTP boundary and translate them into
					structured responses — otherwise the Worker returns a 500 plain
					text stack trace.
				</p>
			</>
		),
		viz: <RpcViz />,
		cta: (
			<Link
				href="/examples/inter-agent"
				className="link-underline font-mono text-xs uppercase tracking-widest"
			>
				See the inter-agent example →
			</Link>
		),
	},
	{
		id: "ui",
		icon: <LayoutGrid className={ICON} strokeWidth={1.75} />,
		title: "Co-located React UIs",
		blurb:
			"Drop an app.tsx next to agent.ts. Generated useAgent() hook syncs state across every tab.",
		detail: (
			<>
				<p>
					Place an <code className="font-mono">app.tsx</code> next to any{" "}
					<code className="font-mono">agent.ts</code> and ayjnt generates a
					per-agent typed <code className="font-mono">useAgent()</code> hook
					at <code className="font-mono">@ayjnt/&lt;route&gt;</code>.
				</p>
				<p className="mt-3">
					The UI is bundled with Bun, served by the worker through
					Cloudflare Assets, and connects back to the same URL via
					WebSocket. State changes from any connected tab round-trip
					through the DO and broadcast to every other tab automatically.
				</p>
				<p className="mt-3">
					HTML requests and WebSocket upgrades hit the same URL — the
					generated entry disambiguates based on the{" "}
					<code className="font-mono">Accept</code> and{" "}
					<code className="font-mono">Upgrade</code> headers.
				</p>
			</>
		),
		viz: <CoLocatedViz />,
		cta: (
			<Link
				href="/examples/with-ui"
				className="link-underline font-mono text-xs uppercase tracking-widest"
			>
				See the with-ui example →
			</Link>
		),
	},
	{
		id: "mcp",
		icon: <CircuitBoard className={ICON} strokeWidth={1.75} />,
		title: "MCP agents built in",
		blurb:
			"Classes extending McpAgent dispatch through McpAgent.serve() automatically. Streamable HTTP + SSE handled.",
		detail: (
			<>
				<p>
					Write a class that extends <code className="font-mono">McpAgent</code>{" "}
					from the Cloudflare Agents SDK, register tools via{" "}
					<code className="font-mono">McpServer.tool(name, schema, handler)</code>,
					and ayjnt routes <code className="font-mono">/your-agent</code>{" "}
					through the SDK&apos;s{" "}
					<code className="font-mono">McpAgent.serve()</code> handler.
				</p>
				<p className="mt-3">
					The transport layer — streamable HTTP, SSE, session management — is
					handled by the SDK. Middleware still runs. Any MCP client (Claude
					Desktop, the <code className="font-mono">@modelcontextprotocol/sdk</code>{" "}
					TypeScript client) can connect.
				</p>
				<p className="mt-3 font-mono text-[13px] text-[var(--ink-muted)]">
					Detection is source-level: keep your import as
					<code> import {"{"} McpAgent {"}"} from &quot;agents/mcp&quot;</code>{" "}
					— aliasing the import breaks detection.
				</p>
			</>
		),
		viz: <McpViz />,
		cta: (
			<Link
				href="/examples/mcp"
				className="link-underline font-mono text-xs uppercase tracking-widest"
			>
				See the mcp example →
			</Link>
		),
	},
	{
		id: "hmr",
		icon: <Zap className={ICON} strokeWidth={1.75} />,
		title: "HMR-backed dev loop",
		blurb:
			"ayjnt dev watches agents/, re-runs codegen on structural change, lets wrangler reload. 26ms rebuilds.",
		detail: (
			<>
				<p>
					<code className="font-mono">ayjnt dev</code> does an initial build
					then spawns <code className="font-mono">wrangler dev</code>, keeping
					an <code className="font-mono">fs.watch</code> loop on{" "}
					<code className="font-mono">agents/</code> alongside it.
				</p>
				<p className="mt-3">
					Adding, renaming, or deleting any{" "}
					<code className="font-mono">agent.ts</code>,{" "}
					<code className="font-mono">middleware.ts</code>, or{" "}
					<code className="font-mono">app.tsx</code> fires a 150ms-debounced
					re-run of the codegen pipeline. Wrangler picks up the new{" "}
					<code className="font-mono">.ayjnt/dist/entry.ts</code> and reloads
					the worker — the UI side reloads automatically too because the
					bundled <code>app.js</code> lives in the assets directory that
					wrangler watches.
				</p>
				<p className="mt-3">
					The codegen itself is fast: ~26ms via bunup when a library file
					changes.
				</p>
			</>
		),
		viz: <HmrViz />,
		cta: (
			<Link
				href="/docs#hmr"
				className="link-underline font-mono text-xs uppercase tracking-widest"
			>
				Read the dev loop docs →
			</Link>
		),
	},
];

export function FeatureContent() {
	return <FeatureGrid items={ITEMS} />;
}
