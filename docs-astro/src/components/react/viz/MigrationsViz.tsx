"use client";

import { motion } from "framer-motion";
import { Check, X } from "lucide-react";

type Entry = {
	tag: string;
	op: string;
	className: string;
	kind: "add" | "rename" | "delete";
};

const ENTRIES: Entry[] = [
	{ tag: "v1", op: "add", className: "ChatAgent", kind: "add" },
	{ tag: "v2", op: "rename", className: "Chat → Talk", kind: "rename" },
	{ tag: "v3", op: "delete", className: "OldAgent", kind: "delete" },
];

/**
 * Two-act sequence. Act 1: the lockfile fills up with v1 → v2 → v3
 * entries as the file tree changes. Act 2: two terminal lines — one
 * dirty-tree attempt that fails, one clean-tree attempt that succeeds.
 * The whole point is that migrations are only ever appended through the
 * git discipline in the second panel.
 */
export function MigrationsViz() {
	return (
		<div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
			<LockfilePanel />
			<DeployPanel />
		</div>
	);
}

function LockfilePanel() {
	return (
		<div className="border border-[var(--ink)] bg-[var(--paper-edge)]">
			<div className="flex items-center gap-2 border-b border-[var(--ink)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[11px]">
				<span className="inline-flex h-4 w-4 shrink-0 items-center justify-center bg-[#cb8b16] text-[9px] font-bold leading-none text-white">
					{"{}"}
				</span>
				<span>.ayjnt/migrations.json</span>
				<span className="ml-auto text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
					committed
				</span>
			</div>
			<ol className="flex flex-col gap-2 p-3 font-mono text-[12px]">
				{ENTRIES.map((e, i) => (
					<motion.li
						key={e.tag}
						initial={{ opacity: 0, y: 8, scaleY: 0.6 }}
						animate={{ opacity: 1, y: 0, scaleY: 1 }}
						transition={{ delay: i * 0.5, duration: 0.3 }}
						className="flex items-center gap-2 border border-dashed border-[var(--rule-strong)] bg-[var(--paper)] px-2 py-1.5"
					>
						<span className="inline-flex h-5 min-w-[1.5rem] items-center justify-center bg-[var(--ink)] px-1 text-[10px] font-bold text-[var(--paper)]">
							{e.tag}
						</span>
						<span className={opStyles(e.kind)}>{e.op}</span>
						<span className="truncate text-[var(--ink)]">{e.className}</span>
					</motion.li>
				))}
			</ol>
		</div>
	);
}

function opStyles(kind: Entry["kind"]) {
	const base = "text-[10px] uppercase tracking-widest font-semibold";
	switch (kind) {
		case "add":
			return `${base} text-[var(--amber)]`;
		case "rename":
			return `${base} text-[var(--blue)]`;
		case "delete":
			return `${base} text-[#c0392b]`;
	}
}

function DeployPanel() {
	const firstDelay = ENTRIES.length * 0.5 + 0.2;
	return (
		<div className="flex flex-col gap-3 border border-[var(--ink)] bg-[var(--paper-edge)] p-3 font-mono text-[12px]">
			<div className="font-sans text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
				two deploy attempts
			</div>

			{/* Dirty tree attempt — blocked */}
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: firstDelay }}
				className="flex flex-col gap-1 border border-[#c0392b] bg-[color-mix(in_srgb,#c0392b_10%,var(--paper))] p-2"
			>
				<div>$ ayjnt deploy</div>
				<div className="flex items-center gap-1 text-[#c0392b]">
					<X className="h-3 w-3" strokeWidth={3} />
					<span>uncommitted migrations.json</span>
				</div>
				<div className="text-[10px] text-[var(--ink-muted)]">
					refuses to ship from an out-of-sync tree
				</div>
			</motion.div>

			{/* Clean tree attempt — ok */}
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: firstDelay + 0.8 }}
				className="flex flex-col gap-1 border border-[var(--amber)] bg-[color-mix(in_srgb,var(--amber)_10%,var(--paper))] p-2"
			>
				<div>$ git commit + push && ayjnt deploy</div>
				<div className="flex items-center gap-1 text-[var(--amber)]">
					<Check className="h-3 w-3" strokeWidth={3} />
					<span>clean + in sync with origin/main</span>
				</div>
				<div className="text-[10px] text-[var(--ink-muted)]">
					wrangler uploads, migrations apply in order
				</div>
			</motion.div>
		</div>
	);
}
