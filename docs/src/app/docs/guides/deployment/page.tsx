import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
	title: "Deployment — ayjnt docs",
	description:
		"ayjnt deploy: the git preflight checks, wrangler passthrough, environments, secrets, and what happens if checks fail.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="guides/deployment"
			lede="ayjnt deploy is git-safety rails around wrangler deploy. It regenerates, enforces that your working tree is in sync with origin, and hands off."
		>
			<h2>The happy path</h2>
			<CodeBlock
				lang="sh"
				code={`# In a clean, pushed tree:
bun run deploy

# Equivalent:
bunx ayjnt deploy`}
			/>
			<p>Under the hood, this:</p>
			<ol>
				<li>
					Runs preflight: git clean, in sync with origin, no uncommitted
					lockfile changes. If any fail, abort.
				</li>
				<li>
					Re-runs the build without writing a new migration — if a
					migration would be staged, abort with &ldquo;pending migration
					detected, commit it first.&rdquo;
				</li>
				<li>
					Spawns <code>bunx wrangler deploy --config .ayjnt/dist/wrangler.jsonc</code>{" "}
					with stdio inherited.
				</li>
				<li>Exits with wrangler&apos;s exit code.</li>
			</ol>

			<h2>Preflight in detail</h2>
			<p>
				The preflight runs three git checks and one migration check.
				You&apos;ll see an error message for the first one that fails; fix
				it, retry.
			</p>

			<h3>1. Working tree must be clean</h3>
			<CodeBlock
				lang="sh"
				code={`$ ayjnt deploy
uncommitted changes detected:
 M agents/chat/agent.ts
?? agents/new-thing/agent.ts

commit or stash before deploying. Use --force to bypass.`}
			/>
			<p>
				Any output from <code>git status --porcelain</code> is a failure.
				<code>git stash</code>, <code>git commit</code>, or delete the
				untracked file. Then retry.
			</p>

			<h3>2. Must be in sync with origin</h3>
			<CodeBlock
				lang="sh"
				code={`$ ayjnt deploy
3 unpushed commit(s) on main. Push before deploying. Use --force to bypass.
# or
2 unpulled commit(s) from origin/main. Pull before deploying. Use --force to bypass.`}
			/>
			<p>
				ayjnt checks <code>git rev-list --count origin/&lt;branch&gt;..HEAD</code>{" "}
				(unpushed) and <code>HEAD..origin/&lt;branch&gt;</code> (unpulled).
				Both must be zero.
			</p>

			<h3>3. No pending migration</h3>
			<CodeBlock
				lang="sh"
				code={`$ ayjnt deploy
pending migration detected — not yet committed to .ayjnt/migrations.json.
Run \`ayjnt build\` to stage it, then \`git add .ayjnt/migrations.json && git commit && git push\` before deploying.`}
			/>
			<p>
				If your file tree has changed in ways that would produce a new
				migration entry but <code>migrations.json</code> hasn&apos;t been
				updated (or has been updated but not committed), deploy refuses.
				The fix is literally what the message says: run{" "}
				<code>ayjnt build</code>, commit the lockfile, push, retry.
			</p>

			<h3>What <code>--force</code> does</h3>
			<p>
				<code>ayjnt deploy --force</code> skips all preflight. Useful in
				emergencies (&ldquo;Slack is down, production is broken, I need to
				ship a one-line fix NOW&rdquo;). Never skip the check by default —
				the whole point of the lockfile+git machinery is to make diverging
				migrations impossible, and <code>--force</code> is the trapdoor
				that lets you out in rare circumstances.
			</p>

			<Callout kind="warn" title="When not to force">
				<p>
					Resist the urge to use <code>--force</code> &ldquo;just to get
					the deploy out.&rdquo; If you&apos;re racing another developer
					and bypass the check, you can overwrite their migration state
					in wrangler&apos;s perception of the world. The cleanup is
					painful.
				</p>
				<p>
					Legitimate <code>--force</code> cases: solo incident response,
					a first-ever deploy from a repo without a remote yet, hotfix
					from a machine that can&apos;t <code>git push</code> for some
					reason.
				</p>
			</Callout>

			<h2>First-time deploy</h2>
			<p>
				Wrangler will prompt for authentication the first time:
			</p>
			<CodeBlock
				lang="sh"
				code={`$ bun run deploy
✓ git clean
✓ 1 agent(s), 1 staged migrations
⎔ wrangler: authenticating...
  (browser tab opens to Cloudflare OAuth; complete login)
✓ deployed https://my-app.your-account.workers.dev`}
			/>
			<p>
				After the first login, credentials are cached in{" "}
				<code>~/.config/.wrangler/</code>. Subsequent deploys don&apos;t
				prompt.
			</p>

			<h2>Forwarding flags to wrangler</h2>
			<p>
				Any flag ayjnt doesn&apos;t recognize is forwarded to wrangler
				untouched. Common ones:
			</p>
			<CodeBlock
				lang="sh"
				code={`# Deploy to staging
ayjnt deploy --env staging

# Deploy with dry-run (wrangler checks your config, doesn't upload)
ayjnt deploy --dry-run

# Deploy but don't create a rollback
ayjnt deploy --keep-vars

# Deploy with a specific compatibility date override
ayjnt deploy --compatibility-date 2025-01-01`}
			/>
			<p>
				<code>--force</code> is the only flag ayjnt consumes itself;
				everything else passes through.
			</p>

			<h2>Environments</h2>
			<p>
				Wrangler supports multiple environments in one config. ayjnt
				generates the top-level wrangler fields (main, DO bindings,
				migrations, assets) but doesn&apos;t currently manage per-env
				overrides. If you need environment-specific config, you have two
				options:
			</p>
			<ol>
				<li>
					Add a <code>wrangler.extras.jsonc</code> file (or similar) in
					your project and merge at deploy time with a pre-deploy script.
					Future ayjnt versions may support a{" "}
					<code>framework.config.ts</code> with per-env sections.
				</li>
				<li>
					Use wrangler environment variables + secrets via CLI rather
					than config overrides. This is often enough — the DO bindings
					are the same across envs anyway.
				</li>
			</ol>

			<h2>Secrets</h2>
			<p>
				Secrets (API keys, bearer tokens, etc.) should never live in the
				generated <code>wrangler.jsonc</code>. Use wrangler&apos;s secrets
				machinery:
			</p>
			<CodeBlock
				lang="sh"
				code={`# Set a secret (prompts for value)
bunx wrangler secret put OPENAI_API_KEY

# List secrets (names only, values never shown)
bunx wrangler secret list

# Delete
bunx wrangler secret delete OPENAI_API_KEY`}
			/>
			<p>
				Secrets are available as env bindings at runtime:{" "}
				<code>this.env.OPENAI_API_KEY</code>. Declare them in your{" "}
				<code>Env</code> type so TypeScript knows about them:
			</p>
			<CodeBlock
				lang="ts"
				code={`import type { GeneratedEnv } from "@ayjnt/env";

type Env = GeneratedEnv & {
  OPENAI_API_KEY: string;
};`}
			/>

			<h2>Rollback</h2>
			<p>
				Wrangler supports rollbacks to any previous deployed version:
			</p>
			<CodeBlock
				lang="sh"
				code={`bunx wrangler deployments list
bunx wrangler rollback <deployment-id>`}
			/>
			<p>
				<strong>Rollback does NOT undo DO migrations.</strong> If the
				previous version had fewer DO classes (or different ones), those
				bindings still exist at Cloudflare. Rollback is for worker code +
				config; the DO schema is monotonic.
			</p>
			<Callout kind="note" title="Keep old classes around if unsure">
				<p>
					If you&apos;re about to delete an agent and aren&apos;t sure
					you&apos;ll need to rollback, keep the class and just stop
					exposing it (remove its URL route via a middleware or an{" "}
					<code>onRequest</code> that returns 404). You can delete the
					class safely later, once the new version has baked.
				</p>
			</Callout>

			<h2>CI/CD</h2>
			<p>
				For continuous deploy from CI, you&apos;ll want to:
			</p>
			<ul>
				<li>
					Provide a <code>CLOUDFLARE_API_TOKEN</code> secret to your CI.
					Wrangler picks it up automatically.
				</li>
				<li>
					In CI, your checkout is always &ldquo;clean,&rdquo; but it&apos;s
					also not in sync with origin/main in the same way a developer
					checkout is. <code>ayjnt deploy</code> will handle this fine as
					long as CI checks out the same commit as <code>origin/main</code>;
					if your CI runs from a merge commit that doesn&apos;t match
					origin, use <code>--force</code> in CI specifically (the whole
					point of the check is to catch developer-side races, which
					don&apos;t apply in CI).
				</li>
			</ul>
			<CodeBlock
				filename=".github/workflows/deploy.yml"
				lang="jsonc"
				code={`# sketch — adjust to your CI
# - Set CLOUDFLARE_API_TOKEN as a repo secret
# - Run on push to main
steps:
  - uses: actions/checkout@v4
  - uses: oven-sh/setup-bun@v1
  - run: bun install
  - run: bun test
  - run: bun run build
  - run: bun run deploy --force
    env:
      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}`}
			/>
			<p>
				Running <code>bun test</code> and <code>bun run build</code> as
				separate steps before deploy makes the CI output easier to read
				when something breaks.
			</p>

			<h2>Observability</h2>
			<p>
				ayjnt generates <code>observability: {`{ enabled: true }`}</code>{" "}
				into wrangler config is not yet default — we may add it. For now,
				to turn on Cloudflare&apos;s Workers observability, add it
				manually via your own wrangler config overrides, or enable it from
				the dashboard after first deploy. The Cloudflare dashboard shows
				request counts, latency, DO storage usage, and logs for each
				agent.
			</p>
		</DocPageShell>
	);
}
