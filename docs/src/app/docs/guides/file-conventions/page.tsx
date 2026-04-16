import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { FileTree } from "@/components/FileTree";

export const metadata = {
	title: "File conventions — ayjnt docs",
	description:
		"Every convention that turns files on disk into a running worker: folders as agents, nested URLs, middleware, route groups, and agent ids.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="guides/file-conventions"
			lede="The folder tree under agents/ is the entire framework configuration. Four file names are special — everything else is yours."
		>
			<h2>The four special files</h2>
			<p>
				ayjnt&apos;s scanner walks <code>agents/**/</code> looking for four
				filenames. Every other file you place in the tree is ignored by the
				framework itself (though you can still import from them normally).
			</p>

			<table>
				<thead>
					<tr>
						<th>File</th>
						<th>Purpose</th>
						<th>Required?</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>agent.ts</code>
						</td>
						<td>
							Default-exports a class extending <code>Agent</code> or{" "}
							<code>McpAgent</code>. The folder becomes this agent&apos;s URL
							prefix and DO binding.
						</td>
						<td>Yes (for the folder to be an agent)</td>
					</tr>
					<tr>
						<td>
							<code>app.tsx</code>
						</td>
						<td>
							React UI for this agent. Gets a typed{" "}
							<code>useAgent()</code> hook generated at{" "}
							<code>@ayjnt/&lt;route&gt;</code>.
						</td>
						<td>No</td>
					</tr>
					<tr>
						<td>
							<code>middleware.ts</code>
						</td>
						<td>
							Default-exports a <code>Middleware</code> function. Applies to
							every descendant agent.
						</td>
						<td>No</td>
					</tr>
					<tr>
						<td>
							<code>(group-name)/</code>
						</td>
						<td>
							Folder wrapped in parens. Stripped from the URL, but still
							contributes to the middleware chain of its children.
						</td>
						<td>No</td>
					</tr>
				</tbody>
			</table>

			<h2>Folder = agent</h2>
			<p>
				A folder is an agent if and only if it contains{" "}
				<code>agent.ts</code> at its root. The folder&apos;s path (relative
				to <code>agents/</code>) becomes the URL prefix, and every segment
				after is the DO instance id.
			</p>

			<FileTree
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
									{ type: "file", name: "agent.ts", kind: "ts", note: "→ /chat/:id" },
								],
							},
							{
								type: "folder",
								name: "admin",
								defaultOpen: true,
								children: [
									{
										type: "folder",
										name: "users",
										defaultOpen: true,
										children: [
											{
												type: "file",
												name: "agent.ts",
												kind: "ts",
												note: "→ /admin/users/:id",
											},
										],
									},
									{
										type: "folder",
										name: "audit",
										defaultOpen: true,
										children: [
											{
												type: "file",
												name: "agent.ts",
												kind: "ts",
												note: "→ /admin/audit/:id",
											},
										],
									},
								],
							},
						],
					},
				]}
			/>

			<p>
				The class name inside <code>agent.ts</code> becomes the Durable
				Object binding, converted from PascalCase to{" "}
				<code>UPPER_SNAKE_CASE</code>:{" "}
				<code>ChatAgent</code> → <code>CHAT_AGENT</code>,{" "}
				<code>AdminUsersAgent</code> → <code>ADMIN_USERS_AGENT</code>.
			</p>

			<h2>Stable identity with explicit agentId</h2>
			<p>
				By default, each agent&apos;s identity in the migration lockfile is
				derived from its folder path —{" "}
				<code>agents/admin/users</code> becomes{" "}
				<code>admin_users</code>. That means <strong>renaming a folder
				breaks migration continuity</strong>: the lockfile sees an{" "}
				<code>admin_users</code> deletion and an{" "}
				<code>admin_members</code> addition, so the DO storage gets wiped.
			</p>
			<p>To make identity survive folder moves, export an explicit{" "}
				<code>agentId</code>:
			</p>
			<CodeBlock
				filename="agents/admin/users/agent.ts"
				lang="ts"
				code={`export const agentId = "admin_users_v1";

export default class AdminUsersAgent extends Agent<Env, State> {
  // ...
}`}
				highlightLines={[1]}
			/>
			<p>
				The string is arbitrary — pick something that won&apos;t change. Once
				set, you can freely rename the folder and the DO migration engine
				will track the class as a rename, not a delete.
			</p>

			<Callout kind="tip" title="Recommended for production">
				Add an explicit <code>agentId</code> to every shipped agent before
				you need it. Retrofitting later is harder than setting it up front.
			</Callout>

			<h2>Middleware and the chain</h2>
			<p>
				<code>middleware.ts</code> applies to every agent at or below the
				folder it sits in. The chain runs root → leaf:
			</p>
			<FileTree
				root={[
					{
						type: "folder",
						name: "agents",
						defaultOpen: true,
						children: [
							{
								type: "file",
								name: "middleware.ts",
								kind: "ts",
								note: "runs for all requests",
								highlight: true,
							},
							{
								type: "folder",
								name: "public",
								defaultOpen: true,
								children: [
									{
										type: "folder",
										name: "status",
										defaultOpen: true,
										children: [
											{ type: "file", name: "agent.ts", kind: "ts", note: "chain: [root]" },
										],
									},
								],
							},
							{
								type: "folder",
								name: "admin",
								defaultOpen: true,
								children: [
									{
										type: "file",
										name: "middleware.ts",
										kind: "ts",
										note: "admin-only auth",
										highlight: true,
									},
									{
										type: "folder",
										name: "users",
										defaultOpen: true,
										children: [
											{
												type: "file",
												name: "agent.ts",
												kind: "ts",
												note: "chain: [root, admin]",
											},
										],
									},
								],
							},
						],
					},
				]}
			/>
			<p>
				Deep coverage of the middleware contract, response wrapping, and the
				request context is in{" "}
				<a href="/docs/guides/middleware" className="link-underline">
					Middleware
				</a>
				.
			</p>

			<h2>Route groups — parens in folder names</h2>
			<p>
				A folder wrapped in parens (<code>(public)</code>, <code>(authenticated)</code>) is
				stripped from the URL but still contributes to the middleware chain.
				Use it when you want several agents to share middleware{" "}
				<em>without</em> sharing a URL prefix.
			</p>
			<FileTree
				root={[
					{
						type: "folder",
						name: "agents",
						defaultOpen: true,
						children: [
							{
								type: "folder",
								name: "(authenticated)",
								defaultOpen: true,
								note: "not in URL",
								children: [
									{ type: "file", name: "middleware.ts", kind: "ts", note: "requires JWT" },
									{
										type: "folder",
										name: "account",
										defaultOpen: true,
										children: [
											{ type: "file", name: "agent.ts", kind: "ts", note: "→ /account/:id" },
										],
									},
									{
										type: "folder",
										name: "billing",
										defaultOpen: true,
										children: [
											{ type: "file", name: "agent.ts", kind: "ts", note: "→ /billing/:id" },
										],
									},
								],
							},
						],
					},
				]}
			/>
			<p>
				The <code>(authenticated)</code> folder is invisible in URLs, but
				both <code>/account/:id</code> and <code>/billing/:id</code>{" "}
				inherit the JWT middleware. The same pattern works for logging,
				rate-limiting, CORS, anything you want to apply to a subset of
				agents that don&apos;t share a route segment.
			</p>

			<h2>What happens at build time</h2>
			<p>
				On every <code>ayjnt build</code> (which <code>dev</code> and{" "}
				<code>deploy</code> both invoke), the scanner:
			</p>
			<ol>
				<li>
					Walks <code>agents/**/agent.ts</code> with a <code>Bun.Glob</code>.
				</li>
				<li>
					Parses each file with a small regex to extract the default-exported
					class name, base class, and optional <code>agentId</code> export.
					(No full TypeScript parse — we&apos;re deliberate about keeping
					this fast and predictable.)
				</li>
				<li>
					Computes the route path by stripping route groups from the folder
					path.
				</li>
				<li>
					Walks up every agent&apos;s folder collecting{" "}
					<code>middleware.ts</code> files into an ordered chain.
				</li>
				<li>
					Checks for a sibling <code>app.tsx</code> file.
				</li>
				<li>
					Passes the resulting manifest to the codegen emitters
					(wrangler config, entry.ts, env types, per-agent hooks).
				</li>
			</ol>
			<p>
				If you&apos;re curious about what exactly the scanner does,
				everything lives in{" "}
				<a
					href="https://github.com/northclock/ayjnt/blob/main/src/codegen/scan.ts"
					target="_blank"
					rel="noreferrer"
					className="link-underline"
				>
					src/codegen/scan.ts
				</a>
				. It&apos;s ~200 lines and covered by tests.
			</p>

			<h2>Things the scanner won&apos;t detect</h2>
			<ul>
				<li>
					<strong>Aliased imports of <code>Agent</code> or <code>McpAgent</code>.</strong>{" "}
					The scanner is regex-based. If you write{" "}
					<code>import {"{"} McpAgent as M {"}"} from &quot;agents/mcp&quot;</code>{" "}
					and <code>extends M</code>, ayjnt won&apos;t know this is an MCP
					agent. Keep imports plain.
				</li>
				<li>
					<strong>Multiple classes per file.</strong> We extract the first
					default-exported class. Additional classes in the same file are
					regular TypeScript — they just don&apos;t become agents.
				</li>
				<li>
					<strong>Dynamic folder names.</strong> The filesystem is walked at
					build time. Folder names can&apos;t contain template expressions or
					runtime values.
				</li>
			</ul>
		</DocPageShell>
	);
}
