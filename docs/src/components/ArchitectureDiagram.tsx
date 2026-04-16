"use client";

import { motion } from "framer-motion";

export function ArchitectureDiagram({ className = "" }: { className?: string }) {
	const nodes = [
		{ label: "agents/**/agent.ts", kind: "source" as const },
		{ label: "scan()", kind: "op" as const },
		{ label: ".ayjnt/migrations.json", kind: "persistent" as const },
		{ label: "diff + emit", kind: "op" as const },
		{ label: ".ayjnt/dist/entry.ts", kind: "artifact" as const },
		{ label: "wrangler deploy", kind: "delivery" as const },
	];
	return (
		<div className={`card relative overflow-hidden bg-[var(--paper)] p-6 ${className}`}>
			<div className="grid-paper absolute inset-0 opacity-40" />
			<div className="relative">
				<h4 className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--ink-muted)]">
					Build pipeline
				</h4>
				<ol className="flex flex-col gap-3 md:flex-row md:items-center md:gap-2">
					{nodes.map((node, i) => (
						<DiagramNode key={node.label} node={node} index={i} total={nodes.length} />
					))}
				</ol>
				<p className="mt-5 max-w-prose font-mono text-xs leading-relaxed text-[var(--ink-muted)]">
					Every step is a pure function of its inputs. I/O lives at the edges
					(scan, readLockfile, writeLockfile). Everything in between is tested
					as pure data transforms — see <code>src/codegen/</code>.
				</p>
			</div>
		</div>
	);
}

function DiagramNode({
	node,
	index,
	total,
}: {
	node: { label: string; kind: "source" | "op" | "persistent" | "artifact" | "delivery" };
	index: number;
	total: number;
}) {
	const delay = index * 0.08;
	const styles = styleFor(node.kind);
	const isLast = index === total - 1;
	return (
		<li className="flex min-w-0 flex-1 items-center gap-2">
			<motion.div
				initial={{ opacity: 0, scale: 0.9 }}
				whileInView={{ opacity: 1, scale: 1 }}
				viewport={{ once: true }}
				transition={{ duration: 0.35, delay, ease: "easeOut" }}
				className={`min-w-0 flex-1 border-2 bg-[var(--paper)] px-3 py-2 font-mono text-[11px] leading-tight ${styles}`}
			>
				<div className="truncate">{node.label}</div>
				<div className="mt-0.5 text-[9px] uppercase tracking-widest opacity-60">
					{node.kind}
				</div>
			</motion.div>
			{!isLast && (
				<motion.span
					initial={{ opacity: 0 }}
					whileInView={{ opacity: 1 }}
					viewport={{ once: true }}
					transition={{ duration: 0.4, delay: delay + 0.15 }}
					className="hidden shrink-0 items-center text-[var(--ink-muted)] md:inline-flex"
					aria-hidden
				>
					<Arrow />
				</motion.span>
			)}
		</li>
	);
}

function Arrow() {
	return (
		<svg width="22" height="12" viewBox="0 0 22 12" fill="none" className="shrink-0">
			<path d="M1 6 H20" stroke="currentColor" strokeWidth="1.5" />
			<path d="M15 2 L20 6 L15 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
		</svg>
	);
}

function styleFor(kind: "source" | "op" | "persistent" | "artifact" | "delivery"): string {
	switch (kind) {
		case "source": return "border-[var(--ink)] text-[var(--ink)]";
		case "op": return "border-[var(--blue)] text-[var(--blue)]";
		case "persistent": return "border-[var(--amber)] text-[var(--amber)]";
		case "artifact": return "border-[var(--ink)] text-[var(--ink)]";
		case "delivery": return "border-[var(--ink)] bg-[var(--ink)] !text-[var(--paper)]";
	}
}
