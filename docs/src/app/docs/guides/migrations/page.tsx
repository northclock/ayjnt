import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
	title: "Migrations — ayjnt docs",
	description:
		"The committed migration lockfile, stable agentIds, rename detection, and the git-safety contract that keeps deploys racing each other from corrupting your DO storage.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="guides/migrations"
			lede="Cloudflare Durable Object schemas evolve via migration entries in wrangler.jsonc. ayjnt generates those entries automatically from your file tree — and enforces a git discipline that makes divergent-migration races impossible."
		>
			<h2>What a Durable Object migration is</h2>
			<p>
				DO migrations are wrangler&apos;s way of declaring schema changes:
				when you add a new Agent class, rename one, or delete one, wrangler
				needs a <code>migration</code> entry describing what happened so the
				platform can allocate storage (or free it) safely. A fragment of a
				typical wrangler config:
			</p>
			<CodeBlock
				lang="jsonc"
				code={`{
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["ChatAgent"] },
    { "tag": "v2", "new_sqlite_classes": ["OrdersAgent", "InventoryAgent"] },
    { "tag": "v3", "renamed_classes": [{ "from": "ChatAgent", "to": "TalkAgent" }] },
    { "tag": "v4", "deleted_classes": ["OldAgent"] }
  ]
}`}
			/>
			<p>
				Once a migration is applied (by a successful{" "}
				<code>wrangler deploy</code>), it cannot be undone or reordered —
				wrangler refuses to rewind. Every future deploy must include the
				full history plus any new entries at the end.
			</p>

			<h2>The lockfile: .ayjnt/migrations.json</h2>
			<p>
				ayjnt treats the migration history as a lockfile. It lives at{" "}
				<code>.ayjnt/migrations.json</code>, it&apos;s committed to your
				repo, and it&apos;s the source of truth for what schema is in
				production.
			</p>
			<CodeBlock
				filename=".ayjnt/migrations.json"
				lang="json"
				code={`{
  "version": 1,
  "migrations": [
    {
      "tag": "v1",
      "timestamp": "2026-04-14T00:00:00Z",
      "new_sqlite_classes": ["ChatAgent", "OrdersAgent"]
    },
    {
      "tag": "v2",
      "timestamp": "2026-04-14T05:30:00Z",
      "renamed_classes": [{ "from": "ChatAgent", "to": "TalkAgent" }]
    }
  ],
  "classes": {
    "chat": { "agentId": "chat", "className": "TalkAgent", "firstTag": "v1" },
    "orders": { "agentId": "orders", "className": "OrdersAgent", "firstTag": "v1" }
  }
}`}
			/>

			<p>Two fields worth understanding:</p>
			<ul>
				<li>
					<code>migrations</code> — the append-only list that wrangler
					actually consumes. Don&apos;t edit past entries.
				</li>
				<li>
					<code>classes</code> — a derived snapshot of what each agent{" "}
					<em>currently</em> is after all migrations have been applied. This
					is what the diff algorithm compares against on the next build to
					figure out whether to stage a new migration.
				</li>
			</ul>

			<h2>How a new migration gets staged</h2>
			<p>
				On every <code>ayjnt build</code> (which <code>dev</code> and{" "}
				<code>deploy</code> both invoke), the lockfile is read and compared
				against the current file tree:
			</p>
			<ol>
				<li>The scanner produces a manifest: every agent found, with its className and agentId.</li>
				<li>
					The diff compares the manifest against{" "}
					<code>lockfile.classes</code>:
					<ul>
						<li>agentId in manifest but not in lockfile → new class (adds to <code>new_sqlite_classes</code>)</li>
						<li>
							agentId in both, different className → rename (adds to{" "}
							<code>renamed_classes</code>)
						</li>
						<li>agentId in lockfile but not manifest → deleted (adds to <code>deleted_classes</code>)</li>
					</ul>
				</li>
				<li>
					If anything changed, a new entry (<code>v1</code>, <code>v2</code>,{" "}
					…) is appended to <code>migrations</code> and{" "}
					<code>classes</code> is updated.
				</li>
				<li>
					<code>ayjnt build</code> writes the updated lockfile back to disk.{" "}
					<code>ayjnt deploy</code> deliberately does not — see below.
				</li>
			</ol>

			<h2>Stable agentIds</h2>
			<p>
				Rename detection relies on a stable <code>agentId</code>. By default
				it&apos;s derived from the folder path (<code>admin/users</code> →{" "}
				<code>admin_users</code>), which means renaming a folder will be
				misread as a delete + add — wiping the DO&apos;s storage. To make
				renames safe, export an explicit id from the agent:
			</p>
			<CodeBlock
				lang="ts"
				code={`export const agentId = "admin_users_v1";

export default class AdminUsersAgent extends Agent<Env, State> {
  // ...
}`}
				highlightLines={[1]}
			/>
			<p>
				The string is arbitrary — pick something that won&apos;t change.
				Once set, folder moves don&apos;t affect it, and class renames
				(changing the TypeScript class name) are detected as renames, not
				deletes.
			</p>
			<Callout kind="tip" title="Set agentIds before you need them">
				<p>
					The first time you actually need to rename an agent is usually
					the first time you discover the default <code>agentId</code>{" "}
					isn&apos;t stable. At that point, setting an explicit id still
					works — but you&apos;ll have to do one careful deploy to ensure
					the lockfile records your intent correctly.
				</p>
				<p>
					Easier: add <code>export const agentId = &quot;...&quot;</code> to
					every agent at creation time and treat it as part of the
					ceremony of defining an agent.
				</p>
			</Callout>

			<h2>Preview what would change</h2>
			<p>
				<code>ayjnt migrate</code> shows the migration diff without writing
				anything:
			</p>
			<CodeBlock
				lang="sh"
				code={`$ bun run migrate
Pending migration: v3 (2026-04-14T12:15:00Z)
  ~ renamed:
      ChatAgent -> TalkAgent (agentId: chat)
  - deleted (storage will be destroyed):
      OldAgent (agentId: old_agent)

Run \`ayjnt build\` to stage this migration in .ayjnt/migrations.json.`}
			/>
			<p>
				Use this before every deploy if you&apos;ve made structural changes,
				especially during refactors.
			</p>

			<h2>The git-safety contract</h2>
			<p>
				Here&apos;s the core rule: <strong>
					<code>ayjnt deploy</code> refuses to run from an out-of-sync
					working tree
				</strong>
				. Specifically, it checks:
			</p>
			<ol>
				<li>
					<code>git status --porcelain</code> is empty — no uncommitted
					changes.
				</li>
				<li>Your branch isn&apos;t ahead of <code>origin/&lt;branch&gt;</code> — no unpushed commits.</li>
				<li><code>origin/&lt;branch&gt;</code> isn&apos;t ahead of yours — no unpulled commits.</li>
				<li>
					Running the build wouldn&apos;t produce a new migration entry not
					yet in the committed <code>migrations.json</code>.
				</li>
			</ol>
			<p>
				If any of these fail, deploy aborts with an actionable error
				message. <code>--force</code> exists for emergencies but is loud
				about it.
			</p>
			<Callout kind="note" title="Why this matters">
				<p>
					Two developers can&apos;t race to deploy and produce divergent
					migration histories. Without this check, dev A could rename{" "}
					<code>ChatAgent</code> → <code>ChatV2Agent</code>, deploy it, and
					commit the lockfile; dev B (who hadn&apos;t pulled) could rename{" "}
					<code>ChatAgent</code> → <code>TalkAgent</code>, deploy
					<em>that</em>, overwriting the wrangler-side state. Production
					would be in an undefined state relative to both developers&apos;
					lockfiles. ayjnt catches this before the push happens.
				</p>
			</Callout>

			<h2>Typical workflow</h2>
			<p>
				The canonical flow for making a DO-schema-affecting change:
			</p>
			<ol>
				<li>Rename / add / delete an agent folder.</li>
				<li>
					<code>ayjnt migrate</code> — review the preview. Does it match
					your intent?
				</li>
				<li>
					<code>ayjnt build</code> — stages the new migration into{" "}
					<code>.ayjnt/migrations.json</code>.
				</li>
				<li>
					<code>git diff .ayjnt/migrations.json</code> — sanity check the
					committed version matches.
				</li>
				<li><code>git add -A && git commit -m &quot;rename chat to talk&quot;</code></li>
				<li><code>git push origin main</code></li>
				<li><code>ayjnt deploy</code></li>
			</ol>

			<h2>Deleting an agent</h2>
			<p>
				Removing an agent folder stages a <code>deleted_classes</code>{" "}
				entry. <strong>The next deploy permanently destroys the DO storage
				for that class.</strong> There&apos;s no recovery.
			</p>
			<Callout kind="danger" title="This is irreversible">
				<p>
					Wrangler deletes the SQLite storage for every DO instance of that
					class when the migration applies. If you weren&apos;t sure, put
					the migration off. Once shipped, the data is gone.
				</p>
				<p>
					In practice, if you want to retire an agent but keep the data:
					write a migration script that reads the agent&apos;s state and
					writes it to D1 or R2 before you delete the folder. Run it in
					dev or staging, confirm, then retire.
				</p>
			</Callout>

			<h2>Environments</h2>
			<p>
				Wrangler supports per-environment deployments (staging, production)
				via the <code>--env</code> flag. Each environment has its own DO
				storage and therefore its own migration tag state at Cloudflare. The
				lockfile you commit applies to all environments — the assumption is
				that every migration should apply everywhere in order.
			</p>
			<p>
				If you want environment-specific overrides (different KV binding,
				different routes), the wrangler pass-through in <code>ayjnt</code>{" "}
				accepts any extra flags: <code>ayjnt deploy --env staging</code>{" "}
				forwards to <code>wrangler deploy --env staging</code>. More on
				this under{" "}
				<a href="/docs/guides/deployment" className="link-underline">
					Deployment
				</a>
				.
			</p>
		</DocPageShell>
	);
}
