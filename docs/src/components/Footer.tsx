import Link from "next/link";
import { Logo } from "./Logo";

export function Footer() {
	return (
		<footer className="mt-24 border-t border-[var(--ink)] bg-[var(--paper-edge)]">
			<div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-4">
				<div className="md:col-span-2">
					<Logo />
					<p className="mt-3 max-w-sm font-mono text-xs leading-relaxed text-[var(--ink-muted)]">
						Agent-first framework for Cloudflare. No worker boilerplate, no
						wrangler wrestling.
					</p>
				</div>
				<div>
					<h4 className="mb-3 font-mono text-xs uppercase tracking-widest text-[var(--ink-muted)]">
						Project
					</h4>
					<ul className="space-y-2 text-sm">
						<li><Link href="/" className="link-underline">Home</Link></li>
						<li><Link href="/examples" className="link-underline">Examples</Link></li>
						<li><Link href="/docs" className="link-underline">Docs</Link></li>
					</ul>
				</div>
				<div>
					<h4 className="mb-3 font-mono text-xs uppercase tracking-widest text-[var(--ink-muted)]">
						External
					</h4>
					<ul className="space-y-2 text-sm">
						<li>
							<a href="https://github.com/northclock/ayjnt" className="link-underline" target="_blank" rel="noreferrer">
								GitHub
							</a>
						</li>
						<li>
							<a href="https://www.npmjs.com/package/ayjnt" className="link-underline" target="_blank" rel="noreferrer">
								npm
							</a>
						</li>
						<li>
							<a href="https://developers.cloudflare.com/agents/" className="link-underline" target="_blank" rel="noreferrer">
								Cloudflare Agents
							</a>
						</li>
					</ul>
				</div>
			</div>
			<div className="border-t border-[var(--rule-strong)] bg-[var(--paper)]">
				<div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 font-mono text-xs text-[var(--ink-muted)]">
					<span>ayjnt is not affiliated with Cloudflare.</span>
					<span>MIT</span>
				</div>
			</div>
		</footer>
	);
}
