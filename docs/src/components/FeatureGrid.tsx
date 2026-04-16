"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

export type FeatureItem = {
	id: string;
	icon: ReactNode;
	title: string;
	blurb: string;
	/** Longer prose shown only when the card is expanded. */
	detail: ReactNode;
	/** The animated visualization. Receives no props — each viz is
	 *  self-contained. */
	viz: ReactNode;
	/** Optional extras: links, docs references, tiny code snippets. */
	cta?: ReactNode;
};

type Props = {
	items: FeatureItem[];
};

/**
 * Grid of feature cards with click-to-expand. One card open at a time —
 * the selected card expands to full width and slots into the grid flow
 * via layout animation; other cards reflow around it. Clicking the
 * active card closes it. Animation deliberately uses `layout` so the
 * card transitions smoothly between its two sizes.
 */
export function FeatureGrid({ items }: Props) {
	const [activeId, setActiveId] = useState<string | null>(null);

	const handleToggle = (id: string) => {
		setActiveId((current) => (current === id ? null : id));
	};

	return (
		<LayoutGroup>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				{items.map((item) => {
					const isOpen = activeId === item.id;
					return (
						<motion.div
							layout
							key={item.id}
							transition={{ duration: 0.38, ease: [0.2, 0.8, 0.2, 1] }}
							className={
								isOpen
									? "md:col-span-2 lg:col-span-3"
									: "md:col-span-1 lg:col-span-1"
							}
						>
							<motion.article
								layout
								onClick={() => handleToggle(item.id)}
								role="button"
								aria-expanded={isOpen}
								tabIndex={0}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										handleToggle(item.id);
									}
								}}
								className={`card group relative flex cursor-pointer flex-col gap-4 p-6 transition-shadow ${
									isOpen ? "shadow-[4px_4px_0_var(--amber)]" : "card-interactive"
								}`}
							>
								<motion.div layout="position" className="flex items-start gap-3">
									<span
										className={`inline-flex h-10 w-10 items-center justify-center border bg-[var(--paper)] transition-colors ${
											isOpen
												? "border-[var(--amber)] text-[var(--amber)]"
												: "border-[var(--ink)]"
										}`}
										aria-hidden
									>
										{item.icon}
									</span>
									<div className="flex-1">
										<h3 className="font-mono text-sm font-semibold uppercase tracking-widest">
											{item.title}
										</h3>
										<p className="mt-1 text-[15px] leading-relaxed text-[var(--ink-soft)]">
											{item.blurb}
										</p>
									</div>

									{isOpen ? (
										<button
											type="button"
											aria-label="Close"
											onClick={(e) => {
												e.stopPropagation();
												setActiveId(null);
											}}
											className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--ink)] bg-[var(--paper)] hover:bg-[var(--amber-glow)]"
										>
											<X className="h-4 w-4" />
										</button>
									) : (
										<span
											aria-hidden
											className="ml-auto font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)] opacity-0 transition-opacity group-hover:opacity-100"
										>
											click →
										</span>
									)}
								</motion.div>

								<AnimatePresence initial={false}>
									{isOpen && (
										<motion.div
											key="detail"
											initial={{ opacity: 0, height: 0 }}
											animate={{ opacity: 1, height: "auto" }}
											exit={{ opacity: 0, height: 0 }}
											transition={{ duration: 0.3, ease: "easeOut" }}
											className="overflow-hidden"
										>
											<div className="mt-2 grid gap-6 border-t border-dashed border-[var(--rule-strong)] pt-6 lg:grid-cols-[1fr_1.1fr]">
												<div className="text-[15px] leading-relaxed text-[var(--ink-soft)]">
													{item.detail}
													{item.cta && <div className="mt-4">{item.cta}</div>}
												</div>
												<div
													onClick={(e) => e.stopPropagation()}
													className="rounded-none border border-[var(--ink)] bg-[var(--paper)] p-5"
												>
													{item.viz}
												</div>
											</div>
										</motion.div>
									)}
								</AnimatePresence>
							</motion.article>
						</motion.div>
					);
				})}
			</div>
		</LayoutGroup>
	);
}
