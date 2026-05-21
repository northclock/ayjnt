"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * Two browser tabs + the DO they share. A click on tab A increments the
 * counter, the update propagates through the DO, both tabs re-render in
 * sync. Auto-loops every ~3s to keep the panel alive.
 */
export function CoLocatedViz() {
	const [count, setCount] = useState(0);
	const [source, setSource] = useState<"a" | "b" | null>(null);

	useEffect(() => {
		const id = setInterval(() => {
			setSource((s) => (s === "a" ? "b" : "a"));
			setCount((c) => c + 1);
		}, 2800);
		return () => clearInterval(id);
	}, []);

	return (
		<div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
			<Tab count={count} label="tab 1" active={source === "a"} />

			<Arrow direction="right" active={source === "a"} />

			<DoStub count={count} />

			<Arrow direction="right" active={source === "b"} flipped />

			<Tab count={count} label="tab 2" active={source === "b"} />
		</div>
	);
}

function Tab({ count, label, active }: { count: number; label: string; active: boolean }) {
	return (
		<div
			className={`relative border-2 bg-[var(--paper)] p-3 transition-colors ${
				active ? "border-[var(--amber)]" : "border-[var(--ink)]"
			}`}
		>
			<div className="flex items-center gap-1.5 border-b border-[var(--rule-strong)] pb-2">
				<span className="h-2 w-2 rounded-full border border-[var(--ink)]" />
				<span className="h-2 w-2 rounded-full border border-[var(--ink)]" />
				<span className="h-2 w-2 rounded-full border border-[var(--ink)]" />
				<span className="ml-2 font-mono text-[10px] text-[var(--ink-muted)]">
					{label} — /counter/room-1
				</span>
			</div>
			<div className="mt-3 text-center">
				<motion.div
					key={count}
					initial={{ scale: 1.15, color: "var(--amber)" }}
					animate={{ scale: 1, color: "var(--ink)" }}
					transition={{ duration: 0.4 }}
					className="font-sans text-3xl font-bold tabular-nums"
				>
					{count}
				</motion.div>
				<motion.div
					animate={{
						scale: active ? [1, 0.92, 1] : 1,
						borderColor: active ? "var(--amber)" : "var(--ink)",
					}}
					transition={{ duration: 0.3 }}
					className="mx-auto mt-2 inline-flex h-6 items-center justify-center border px-3 font-mono text-[11px]"
				>
					+
				</motion.div>
			</div>
		</div>
	);
}

function DoStub({ count }: { count: number }) {
	return (
		<div className="border-2 border-[var(--blue)] bg-[var(--paper)] p-3 font-mono">
			<div className="text-[10px] uppercase tracking-widest text-[var(--blue)]">
				DO — counter/room-1
			</div>
			<div className="mt-2 border border-dashed border-[var(--rule-strong)] bg-[var(--paper-edge)] px-2 py-1.5 text-[11px]">
				<span className="text-[var(--ink-muted)]">state.count =</span>{" "}
				<motion.span
					key={count}
					initial={{ opacity: 0.3 }}
					animate={{ opacity: 1 }}
					className="font-semibold text-[var(--ink)]"
				>
					{count}
				</motion.span>
			</div>
			<div className="mt-1 text-[9px] uppercase tracking-widest text-[var(--ink-muted)]">
				broadcasts to connected tabs
			</div>
		</div>
	);
}

function Arrow({
	direction,
	active,
	flipped = false,
}: {
	direction: "right" | "left";
	active: boolean;
	flipped?: boolean;
}) {
	// When a tab is active, the arrow POINTS into the DO (inbound setState).
	// When that tab is not active, the arrow runs outbound (broadcast).
	const showPacket = active;
	return (
		<div className="relative hidden h-full min-w-[64px] items-center md:flex">
			<svg
				viewBox="0 0 64 16"
				className="h-4 w-full"
				preserveAspectRatio="none"
				aria-hidden
			>
				<line
					x1="0"
					y1="8"
					x2="58"
					y2="8"
					stroke={active ? "var(--amber)" : "var(--rule-strong)"}
					strokeWidth="1.5"
					strokeDasharray="3 3"
				/>
				<path
					d={flipped ? "M 8 4 L 3 8 L 8 12" : "M 54 4 L 59 8 L 54 12"}
					stroke={active ? "var(--amber)" : "var(--rule-strong)"}
					strokeWidth="1.5"
					fill="none"
				/>
			</svg>
			{showPacket && (
				<motion.span
					initial={{ x: flipped ? "100%" : 0, opacity: 0 }}
					animate={{
						x: flipped ? "-10%" : "100%",
						opacity: [0, 1, 1, 0],
					}}
					transition={{ duration: 0.8, times: [0, 0.2, 0.8, 1] }}
					className="absolute left-0 top-1/2 -translate-y-1/2 border border-[var(--amber)] bg-[var(--paper)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--amber)]"
				>
					setState
				</motion.span>
			)}
		</div>
	);
}
