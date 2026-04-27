"use client";

import { motion } from "framer-motion";

type Stage = {
	label: string;
	sub: string;
	accent?: "amber" | "blue" | "ink";
};

const STAGES: Stage[] = [
	{ label: "LLM client", sub: "Claude Desktop", accent: "ink" },
	{ label: "/tools", sub: "McpAgent.serve()", accent: "amber" },
	{ label: "McpAgent DO", sub: "tool registry", accent: "blue" },
];

/**
 * Four-panel flow: a "call" bubble travels left→right through the stages,
 * a "result" bubble travels right→left. Each stage pulses as the bubble
 * passes through.
 */
export function McpViz() {
	return (
		<div className="flex flex-col gap-4">
			<FlowRow direction="right" label='callTool("add",{a:7,b:42})' />
			<StageStrip />
			<FlowRow direction="left" label="[ 49 ]" />
		</div>
	);
}

function StageStrip() {
	return (
		<div className="grid grid-cols-3 gap-2">
			{STAGES.map((stage, i) => (
				<motion.div
					key={stage.label}
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: i * 0.15, duration: 0.3 }}
					className={`border-2 bg-[var(--paper)] p-3 text-center ${accentBorder(stage.accent)}`}
				>
					<div className="font-mono text-[11px] font-semibold">{stage.label}</div>
					<div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-[var(--ink-muted)]">
						{stage.sub}
					</div>
				</motion.div>
			))}
		</div>
	);
}

function accentBorder(accent: Stage["accent"]) {
	switch (accent) {
		case "amber":
			return "border-[var(--amber)]";
		case "blue":
			return "border-[var(--blue)]";
		default:
			return "border-[var(--ink)]";
	}
}

function FlowRow({
	direction,
	label,
}: {
	direction: "right" | "left";
	label: string;
}) {
	const startX = direction === "right" ? "-5%" : "105%";
	const endX = direction === "right" ? "105%" : "-5%";
	const color = direction === "right" ? "var(--amber)" : "var(--blue)";
	return (
		<div className="relative h-6">
			<svg
				viewBox="0 0 600 8"
				className="absolute inset-0 h-full w-full"
				preserveAspectRatio="none"
				aria-hidden
			>
				<line
					x1="0"
					y1="4"
					x2="600"
					y2="4"
					stroke="var(--rule-strong)"
					strokeDasharray="4 4"
				/>
			</svg>
			<motion.div
				initial={{ x: startX, opacity: 0 }}
				animate={{ x: [startX, endX], opacity: [0, 1, 1, 0] }}
				transition={{
					duration: 2.4,
					times: [0, 0.1, 0.9, 1],
					repeat: Infinity,
					repeatDelay: 1.5,
					delay: direction === "left" ? 1.2 : 0,
					ease: "linear",
				}}
				className="absolute top-1/2 -translate-y-1/2"
				style={{ color, borderColor: color }}
			>
				<span className="whitespace-nowrap border bg-[var(--paper)] px-1.5 py-0.5 font-mono text-[10px]">
					{label}
				</span>
			</motion.div>
		</div>
	);
}
