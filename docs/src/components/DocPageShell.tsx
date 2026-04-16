import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Prose } from "./Prose";
import { getAdjacent, getSectionFor, getDocItem } from "@/content/docs-nav";

type Props = {
	/** Slug of the current page, e.g. "guides/middleware". */
	slug: string;
	/** Short subtitle under the title. One sentence positioning the page. */
	lede?: string;
	children: ReactNode;
};

/**
 * Every docs page wraps its content in this shell so the title,
 * breadcrumbs, and prev/next navigation are identical across the
 * entire documentation tree. The slug drives breadcrumbs and
 * pagination — page authors never hand-write them.
 */
export function DocPageShell({ slug, lede, children }: Props) {
	const item = getDocItem(slug);
	const section = getSectionFor(slug);
	const { prev, next } = getAdjacent(slug);
	if (!item) {
		return (
			<article>
				<p>Unknown docs slug: {slug}</p>
			</article>
		);
	}

	return (
		<article className="mx-auto w-full max-w-[720px]">
			<nav
				aria-label="Breadcrumb"
				className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[var(--ink-muted)]"
			>
				<Link href="/docs" className="hover:text-[var(--ink)]">
					Docs
				</Link>
				{section && (
					<>
						<span aria-hidden>/</span>
						<span>{section.title}</span>
					</>
				)}
			</nav>
			<header className="mb-10 border-b border-[var(--rule-strong)] pb-6">
				<h1 className="font-sans text-[36px] font-semibold leading-tight tracking-tight text-[var(--ink)]">
					{item.title}
				</h1>
				{lede && (
					<p className="mt-3 text-[18px] leading-relaxed text-[var(--ink-soft)]">
						{lede}
					</p>
				)}
			</header>
			<Prose>{children}</Prose>

			<nav
				aria-label="Pagination"
				className="mt-16 grid gap-3 border-t border-[var(--rule-strong)] pt-6 sm:grid-cols-2"
			>
				{prev ? (
					<Link
						href={`/docs/${prev.slug}`}
						className="card card-interactive group flex flex-col gap-1 p-4"
					>
						<span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
							<ArrowLeft className="h-3 w-3" />
							Previous
						</span>
						<span className="font-mono text-sm text-[var(--ink)] transition-colors group-hover:text-[var(--amber)]">
							{prev.title}
						</span>
					</Link>
				) : (
					<span />
				)}
				{next ? (
					<Link
						href={`/docs/${next.slug}`}
						className="card card-interactive group flex flex-col gap-1 p-4 text-right sm:col-start-2"
					>
						<span className="flex items-center justify-end gap-1 font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
							Next
							<ArrowRight className="h-3 w-3" />
						</span>
						<span className="font-mono text-sm text-[var(--ink)] transition-colors group-hover:text-[var(--amber)]">
							{next.title}
						</span>
					</Link>
				) : (
					<span />
				)}
			</nav>
		</article>
	);
}
