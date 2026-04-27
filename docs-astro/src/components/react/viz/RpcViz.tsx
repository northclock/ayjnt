"use client";

import { motion } from "framer-motion";

/**
 * Two DO boxes. A call packet flies left→right carrying the method
 * signature; a return packet flies right→left with the result. We loop
 * indefinitely so the card shows movement for as long as it's open.
 */
export function RpcViz() {
	return (
		<div className="relative isolate">
			<div className="grid grid-cols-[1fr_120px_1fr] items-center gap-0">
				<Agent
					name="OrdersAgent"
					sub="customer-42"
					line="await inv.decrement('widget', 3)"
					tone="ink"
				/>
				<Tracks />
				<Agent
					name="InventoryAgent"
					sub="main"
					line="stock: widget 10 → 7"
					tone="amber"
				/>
			</div>

			<div className="mt-3 grid grid-cols-[1fr_120px_1fr] items-center gap-0 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
				<span>caller</span>
				<span>Workers RPC</span>
				<span>callee</span>
			</div>
		</div>
	);
}

function Agent({
	name,
	sub,
	line,
	tone,
}: {
	name: string;
	sub: string;
	line: string;
	tone: "ink" | "amber";
}) {
	const border = tone === "amber" ? "border-[var(--amber)]" : "border-[var(--ink)]";
	return (
		<div className={`relative border-2 ${border} bg-[var(--paper)] p-3 font-mono`}>
			<div className="flex items-center justify-between">
				<div className="text-[12px] font-semibold">{name}</div>
				<div className="text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
					{sub}
				</div>
			</div>
			<div className="mt-2 border border-dashed border-[var(--rule-strong)] bg-[var(--paper-edge)] px-2 py-1.5 text-[11px] leading-snug">
				{line}
			</div>
		</div>
	);
}

function Tracks() {
	return (
		<div className="relative mx-2 h-16">
			{/* Call arrow (left → right) */}
			<svg
				viewBox="0 0 120 16"
				className="absolute inset-x-0 top-0 h-4"
				preserveAspectRatio="none"
				aria-hidden
			>
				<line
					x1="0"
					y1="8"
					x2="114"
					y2="8"
					stroke="var(--amber)"
					strokeWidth="1"
					strokeDasharray="3 3"
					opacity="0.5"
				/>
				<motion.path
					d="M 110 4 L 115 8 L 110 12"
					stroke="var(--amber)"
					strokeWidth="1.5"
					fill="none"
				/>
			</svg>
			<motion.div
				initial={{ x: "-10%", opacity: 0 }}
				animate={{
					x: ["-10%", "110%"],
					opacity: [0, 1, 1, 0],
				}}
				transition={{
					duration: 1.6,
					repeat: Infinity,
					repeatDelay: 1.4,
					times: [0, 0.1, 0.9, 1],
					ease: "linear",
				}}
				className="absolute top-0 -translate-y-1/2"
			>
				<Packet label="decrement('widget', 3)" />
			</motion.div>

			{/* Return arrow (right → left) */}
			<svg
				viewBox="0 0 120 16"
				className="absolute inset-x-0 bottom-0 h-4"
				preserveAspectRatio="none"
				aria-hidden
			>
				<line
					x1="0"
					y1="8"
					x2="114"
					y2="8"
					stroke="var(--ink-muted)"
					strokeWidth="1"
					strokeDasharray="3 3"
					opacity="0.5"
				/>
				<motion.path
					d="M 10 4 L 5 8 L 10 12"
					stroke="var(--ink)"
					strokeWidth="1.5"
					fill="none"
				/>
			</svg>
			<motion.div
				initial={{ x: "110%", opacity: 0 }}
				animate={{
					x: ["110%", "-10%"],
					opacity: [0, 1, 1, 0],
				}}
				transition={{
					duration: 1.6,
					repeat: Infinity,
					repeatDelay: 1.4,
					delay: 1,
					times: [0, 0.1, 0.9, 1],
					ease: "linear",
				}}
				className="absolute bottom-0 translate-y-1/2"
			>
				<Packet label="7" tone="ink" />
			</motion.div>
		</div>
	);
}

function Packet({ label, tone = "amber" }: { label: string; tone?: "amber" | "ink" }) {
	const color = tone === "amber" ? "var(--amber)" : "var(--ink)";
	return (
		<div
			className="border px-2 py-0.5 font-mono text-[10px]"
			style={{ borderColor: color, color, background: "var(--paper)" }}
		>
			{label}
		</div>
	);
}
