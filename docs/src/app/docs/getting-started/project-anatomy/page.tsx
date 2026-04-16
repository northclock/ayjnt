import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { FileTree } from "@/components/FileTree";

export const metadata = {
	title: "Project anatomy — ayjnt docs",
	description:
		"A tour of the files you author vs the files ayjnt regenerates.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="getting-started/project-anatomy"
			lede="There are two kinds of files in an ayjnt project: the ones you write, and the ones the framework regenerates. Knowing which is which saves hours of future confusion."
		>
			<h2>The full tree</h2>
			<FileTree
				root={[
					{
						type: "folder",
						name: "agents",
						defaultOpen: true,
						note: "you write this",
						children: [
							{
								type: "folder",
								name: "counter",
								defaultOpen: true,
								children: [
									{ type: "file", name: "agent.ts", kind: "ts" },
									{ type: "file", name: "app.tsx", kind: "tsx", note: "optional UI" },
								],
							},
							{ type: "file", name: "middleware.ts", kind: "ts", note: "optional" },
						],
					},
					{
						type: "folder",
						name: ".ayjnt",
						defaultOpen: true,
						note: "generated",
						children: [
							{ type: "file", name: "migrations.json", kind: "json", note: "COMMIT THIS" },
							{ type: "file", name: "tsconfig.json", kind: "jsonc", note: "gitignored" },
							{ type: "file", name: "env.d.ts", kind: "ts", note: "gitignored" },
							{
								type: "folder",
								name: "client",
								defaultOpen: false,
								note: "gitignored",
								children: [
									{
										type: "folder",
										name: "counter",
										defaultOpen: false,
										children: [{ type: "file", name: "index.tsx", kind: "tsx" }],
									},
								],
							},
							{
								type: "folder",
								name: "dist",
								defaultOpen: false,
								note: "gitignored",
								children: [
									{ type: "file", name: "entry.ts", kind: "ts" },
									{ type: "file", name: "wrangler.jsonc", kind: "jsonc" },
								],
							},
							{
								type: "folder",
								name: "assets",
								defaultOpen: false,
								note: "gitignored (if UI)",
								children: [
									{
										type: "folder",
										name: "__ayjnt",
										defaultOpen: false,
										children: [
											{
												type: "folder",
												name: "counter",
												defaultOpen: false,
												children: [
													{ type: "file", name: "index.html" },
													{ type: "file", name: "app.js" },
												],
											},
										],
									},
								],
							},
						],
					},
					{ type: "file", name: "package.json", kind: "json" },
					{ type: "file", name: "tsconfig.json", kind: "json" },
					{ type: "file", name: ".gitignore", kind: "txt" },
				]}
			/>

			<h2>Files you author</h2>

			<h3>
				<code>agents/&lt;name&gt;/agent.ts</code>
			</h3>
			<p>
				One class per folder, default-exported, extending <code>Agent</code>{" "}
				(or <code>McpAgent</code>). The folder name becomes the URL prefix;
				the class name becomes the DO binding (<code>CounterAgent</code> →{" "}
				<code>COUNTER_AGENT</code>).
			</p>

			<h3>
				<code>agents/&lt;name&gt;/app.tsx</code> (optional)
			</h3>
			<p>
				React UI for this agent. Imports <code>useAgent</code> from{" "}
				<code>@ayjnt/&lt;route&gt;</code>, which is a typed hook the framework
				generates. Bundled with Bun and served at the same URL via Cloudflare
				Assets.
			</p>

			<h3>
				<code>agents/.../middleware.ts</code> (optional)
			</h3>
			<p>
				Applies to every agent at or below this folder. Hono-style{" "}
				<code>(c, next) =&gt; Response</code>. Root → leaf chaining; the{" "}
				<code>agents/middleware.ts</code> at the top of the tree runs first,
				nested ones run next, then the agent.
			</p>

			<h3>
				<code>package.json</code>
			</h3>
			<p>
				Standard Bun/npm manifest. The ayjnt scripts you run (<code>dev</code>,
				<code>build</code>, <code>deploy</code>, <code>migrate</code>) invoke
				the CLI. You own this file.
			</p>

			<h3>
				<code>tsconfig.json</code>
			</h3>
			<p>
				You own this file. The <code>ayjnt new</code> template pre-fills it
				with two path aliases that make the generated hooks importable:
			</p>
			<CodeBlock
				filename="tsconfig.json"
				lang="jsonc"
				code={`{
  "compilerOptions": {
    "paths": {
      "@ayjnt/env": ["./.ayjnt/env.d.ts"],
      "@ayjnt/*": ["./.ayjnt/client/*"]
    }
  }
}`}
				highlightLines={[4, 5]}
			/>
			<p>
				The <code>./</code> prefix is required — TypeScript rejects path
				mappings without <code>baseUrl</code> unless they&apos;re relative.
			</p>

			<h2>Files ayjnt regenerates</h2>

			<h3>
				<code>.ayjnt/migrations.json</code> <span className="tag">committed</span>
			</h3>
			<p>
				The only file in <code>.ayjnt/</code> that is checked into git. It&apos;s
				the source of truth for what DO schema is in production. Every build
				diffs the current file tree against this lockfile and stages a new
				migration entry if anything changed.{" "}
				<code>ayjnt deploy</code> refuses to run if your git tree is
				out of sync with origin/main.
			</p>

			<h3>
				<code>.ayjnt/dist/entry.ts</code> <span className="tag">gitignored</span>
			</h3>
			<p>
				The worker&apos;s actual entrypoint. It re-exports every agent class
				(so the Durable Object runtime can find them by name), builds a
				route table sorted longest-prefix first, and dispatches requests —
				HTML goes to the Assets binding, MCP agents go to{" "}
				<code>McpAgent.serve()</code>, everything else gets forwarded to the
				matching DO via <code>getAgentByName</code>.
			</p>

			<h3>
				<code>.ayjnt/dist/wrangler.jsonc</code> <span className="tag">gitignored</span>
			</h3>
			<p>
				The wrangler config ayjnt hands to the CLI. DO bindings, migrations,
				compatibility flags, and (when you have <code>app.tsx</code> files)
				the Assets binding are all filled in automatically.
			</p>

			<h3>
				<code>.ayjnt/env.d.ts</code> <span className="tag">gitignored</span>
			</h3>
			<p>
				Declares the <code>GeneratedEnv</code> type with every DO binding
				pointed at its specific agent class. Import it when you write an
				agent: <code>import type {"{"} GeneratedEnv {"}"} from &quot;@ayjnt/env&quot;</code>.
				Extend it with any extra bindings you declare in wrangler.
			</p>

			<h3>
				<code>.ayjnt/tsconfig.json</code> <span className="tag">gitignored</span>
			</h3>
			<p>
				Declares the <code>@ayjnt/*</code> path aliases the generated hooks
				live under. Your own <code>tsconfig.json</code> can either inline the
				paths (what <code>ayjnt new</code> does) or extend this file via{" "}
				<code>&quot;extends&quot;: &quot;./.ayjnt/tsconfig.json&quot;</code>.
			</p>

			<h3>
				<code>.ayjnt/client/&lt;route&gt;/index.tsx</code>{" "}
				<span className="tag">gitignored</span>
			</h3>
			<p>
				One file per agent. Contains the typed <code>useAgent()</code> hook,
				bound to that agent&apos;s class and route prefix. Users import from{" "}
				<code>@ayjnt/&lt;route&gt;</code>, which resolves here via the path
				alias. Regenerated on every build.
			</p>

			<h3>
				<code>.ayjnt/assets/__ayjnt/&lt;route&gt;/*</code>{" "}
				<span className="tag">gitignored</span>
			</h3>
			<p>
				Only exists when at least one agent has an <code>app.tsx</code>. Contains
				the bundled JS and HTML shell for each UI. Cloudflare Assets serves
				these as static files; the <code>__ayjnt</code> prefix keeps them out
				of the user&apos;s route namespace.
			</p>

			<h2>The gitignore</h2>
			<p>
				The <code>ayjnt new</code> template writes this <code>.gitignore</code>{" "}
				rule which captures the whole contract in two lines:
			</p>
			<CodeBlock
				filename=".gitignore"
				lang="sh"
				code={`.ayjnt/*
!.ayjnt/migrations.json`}
				highlightLines={[1, 2]}
			/>
			<p>
				Ignore everything in <code>.ayjnt/</code>{" "}
				<em>except</em> <code>migrations.json</code>. Every other file
				regenerates on the next <code>ayjnt build</code>, so tracking them
				just generates noise in code review.
			</p>

			<Callout kind="tip" title="Safe to wipe">
				If you ever suspect the generated tree is stale (after a rebase,
				switching branches, or just debugging), <code>rm -rf .ayjnt/dist
				.ayjnt/client .ayjnt/tsconfig.json .ayjnt/env.d.ts .ayjnt/assets</code>{" "}
				is always safe. The next <code>ayjnt dev</code> or{" "}
				<code>ayjnt build</code> regenerates everything.
			</Callout>
		</DocPageShell>
	);
}
