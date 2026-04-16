"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_SECTIONS } from "@/content/docs-nav";

/**
 * Left-rail nav for /docs/*. Hardcoded sections — the sidebar
 * structure is as important as the content, so we want intentional
 * ordering, not inferred-from-filesystem order.
 *
 * Current-page detection uses usePathname and marks the active item
 * with an amber left border + stronger text, plus scrolls its section
 * visually open. Keeps state minimal: no expand/collapse in v1 (all
 * sections always visible). If the tree grows past ~20 items we can
 * add collapsibles later.
 */
export function DocsSidebar() {
	const pathname = usePathname();
	const activeSlug = pathname?.replace(/^\/docs\/?/, "") ?? "";

	return (
		<nav
			aria-label="Docs navigation"
			className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-y-auto border-r border-[var(--ink)] bg-[var(--paper-edge)] px-5 py-6"
		>
			<Link
				href="/docs"
				className={`mb-5 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors ${
					pathname === "/docs"
						? "text-[var(--ink)]"
						: "text-[var(--ink-muted)] hover:text-[var(--ink)]"
				}`}
			>
				<span className="inline-block h-1.5 w-1.5 bg-[var(--amber)]" />
				Documentation
			</Link>
			<ol className="flex flex-col gap-6">
				{DOCS_SECTIONS.map((section) => (
					<li key={section.title}>
						<h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-[var(--ink-muted)]">
							{section.title}
						</h3>
						<ul className="flex flex-col">
							{section.items.map((item) => {
								const isActive = activeSlug === item.slug;
								return (
									<li key={item.slug}>
										<Link
											href={`/docs/${item.slug}`}
											aria-current={isActive ? "page" : undefined}
											className={`block border-l-2 py-1 pl-3 text-[13.5px] transition-colors ${
												isActive
													? "border-[var(--amber)] font-medium text-[var(--ink)]"
													: "border-transparent text-[var(--ink-soft)] hover:border-[var(--rule-strong)] hover:text-[var(--ink)]"
											}`}
										>
											{item.title}
										</Link>
									</li>
								);
							})}
						</ul>
					</li>
				))}
			</ol>

			<div className="mt-auto border-t border-[var(--rule-strong)] pt-5">
				<div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
					External
				</div>
				<ul className="flex flex-col gap-1 text-[13px]">
					<li>
						<a
							href="https://github.com/northclock/ayjnt"
							target="_blank"
							rel="noreferrer"
							className="link-underline"
						>
							GitHub
						</a>
					</li>
					<li>
						<a
							href="https://www.npmjs.com/package/ayjnt"
							target="_blank"
							rel="noreferrer"
							className="link-underline"
						>
							npm
						</a>
					</li>
					<li>
						<a
							href="https://developers.cloudflare.com/agents/"
							target="_blank"
							rel="noreferrer"
							className="link-underline"
						>
							Cloudflare Agents
						</a>
					</li>
				</ul>
			</div>
		</nav>
	);
}
