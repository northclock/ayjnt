"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

type Props = {
	/** Render the icon as JSX rather than passing the component — React
	 *  Server Components refuse to serialize function/class refs into
	 *  Client Components. */
	icon: ReactNode;
	title: string;
	blurb: string;
	children?: ReactNode;
	highlight?: boolean;
};

export function FeatureCard({
	icon,
	title,
	blurb,
	children,
	highlight = false,
}: Props) {
	return (
		<motion.article
			initial={{ opacity: 0, y: 16 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-60px" }}
			transition={{ duration: 0.5, ease: "easeOut" }}
			className={`card relative flex flex-col gap-4 p-6 ${highlight ? "card-accent" : ""}`}
		>
			<div className="flex items-start gap-3">
				<span
					className="inline-flex h-10 w-10 items-center justify-center border border-[var(--ink)] bg-[var(--paper)]"
					aria-hidden
				>
					{icon}
				</span>
				<div className="flex-1">
					<h3 className="font-mono text-sm font-semibold uppercase tracking-widest">
						{title}
					</h3>
					<p className="mt-1 text-[15px] leading-relaxed text-[var(--ink-soft)]">
						{blurb}
					</p>
				</div>
			</div>
			{children}
		</motion.article>
	);
}
