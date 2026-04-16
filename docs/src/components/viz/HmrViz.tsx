"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

type Step = {
	label: string;
	detail: string;
};

const STEPS: Step[] = [
	{ label: "edit agent.ts", detail: "developer saves" },
	{ label: "fs.watch", detail: "150ms debounce" },
	{ label: "bunup rebuild", detail: "~26ms emit" },
	{ label: "wrangler HMR", detail: "worker reload" },
	{ label: "browser", detail: "useAgent survives" },
];

const STEP_MS = 700;

/**
 * Sequential chain of five stations. A pulse marker walks through them,
 * lighting each in turn, then loops. The last station mentions that
 * useAgent state survives the reload — the actual punchline of the
 * whole HMR story for Cloudflare Workers.
 */
export function HmrViz() {
	const [active, setActive] = useState(0);

	useEffect(() => {
		const id = setInterval(() => {
			setActive((a) => (a + 1) % STEPS.length);
		}, STEP_MS);
		return () => clearInterval(id);
	}, []);

	return (
		<div className="flex flex-col gap-3">
			<ol className="grid gap-2 md:grid-cols-5">
				{STEPS.map((step, i) => {
					const isActive = i === active;
					const isPast = i < active;
					return (
						<motion.li
							key={step.label}
							animate={{
								scale: isActive ? 1.02 : 1,
								borderColor: isActive
									? "var(--amber)"
									: isPast
										? "var(--ink)"
										: "var(--rule-strong)",
							}}
							transition={{ duration: 0.2 }}
							className="border-2 bg-[var(--paper)] p-3"
						>
							<div className="flex items-center gap-2">
								<motion.span
									animate={{
										background: isActive
											? "var(--amber)"
											: isPast
												? "var(--ink)"
												: "var(--rule-strong)",
										color: isActive || isPast ? "var(--paper)" : "var(--ink-muted)",
									}}
									className="inline-flex h-5 w-5 items-center justify-center border border-[var(--ink)] text-[10px] font-bold"
								>
									{i + 1}
								</motion.span>
								<span className="font-mono text-[11px] font-semibold">
									{step.label}
								</span>
							</div>
							<div className="mt-1 font-mono text-[10px] text-[var(--ink-muted)]">
								{step.detail}
							</div>
						</motion.li>
					);
				})}
			</ol>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: 0.4 }}
				className="border-t border-dashed border-[var(--rule-strong)] pt-3 font-mono text-[11px] text-[var(--ink-muted)]"
			>
				Wrangler owns the worker side; ayjnt owns re-scanning the file
				tree and regenerating codegen when the <em>structure</em> changes
				(new agent, renamed folder, added app.tsx).
			</motion.div>
		</div>
	);
}
