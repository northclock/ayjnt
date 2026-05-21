"use client";

import { motion } from "framer-motion";

type Row = {
	file: string;
	url: string;
	note?: string;
};

const ROWS: Row[] = [
	{ file: "agents/chat/agent.ts", url: "/chat/:id" },
	{ file: "agents/admin/users/agent.ts", url: "/admin/users/:id" },
	{ file: "agents/(public)/status/agent.ts", url: "/status/:id", note: "group stripped" },
];

/**
 * Each row: a file path lights up, then an arrow draws itself across,
 * then the URL appears. The staggered delay makes it feel like ayjnt's
 * scanner walking the tree top-down. Loops on mount so reopening the
 * card replays the animation.
 */
export function FileRoutingViz() {
	return (
		<div className="relative flex flex-col gap-4 py-2">
			{ROWS.map((row, i) => (
				<Row key={row.file} row={row} index={i} />
			))}
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: ROWS.length * 0.6 + 0.2 }}
				className="mt-2 border-t border-dashed border-[var(--rule-strong)] pt-3 font-mono text-[11px] text-[var(--ink-muted)]"
			>
				The scanner walks <code>agents/**/agent.ts</code>, one folder at
				a time. Every folder becomes one DO binding and one URL prefix.
			</motion.div>
		</div>
	);
}

function Row({ row, index }: { row: Row; index: number }) {
	const delay = index * 0.6;
	return (
		<div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)]">
			<motion.div
				initial={{ opacity: 0, x: -8 }}
				animate={{ opacity: 1, x: 0 }}
				transition={{ delay, duration: 0.28 }}
				className="inline-flex items-center gap-2 self-start border border-[var(--ink)] bg-[var(--paper-edge)] px-2.5 py-1.5 font-mono text-[12px]"
			>
				<span className="inline-flex h-4 w-4 shrink-0 items-center justify-center bg-[#3178c6] text-[9px] font-bold leading-none text-white">
					TS
				</span>
				<span className="truncate">{row.file}</span>
			</motion.div>

			<svg
				width="48"
				height="24"
				viewBox="0 0 48 24"
				className="hidden sm:block"
				aria-hidden
			>
				<motion.path
					d="M 2 12 H 36"
					stroke="var(--amber)"
					strokeWidth="1.5"
					fill="none"
					initial={{ pathLength: 0 }}
					animate={{ pathLength: 1 }}
					transition={{ delay: delay + 0.2, duration: 0.4 }}
				/>
				<motion.path
					d="M 32 6 L 38 12 L 32 18"
					stroke="var(--amber)"
					strokeWidth="1.5"
					fill="none"
					initial={{ pathLength: 0, opacity: 0 }}
					animate={{ pathLength: 1, opacity: 1 }}
					transition={{ delay: delay + 0.55, duration: 0.15 }}
				/>
			</svg>

			<motion.div
				initial={{ opacity: 0, x: 8 }}
				animate={{ opacity: 1, x: 0 }}
				transition={{ delay: delay + 0.45, duration: 0.28 }}
				className="inline-flex items-center justify-between gap-2 border border-[var(--amber)] bg-[var(--paper)] px-2.5 py-1.5 font-mono text-[12px]"
			>
				<span>{row.url}</span>
				{row.note && (
					<span className="text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
						{row.note}
					</span>
				)}
			</motion.div>
		</div>
	);
}
