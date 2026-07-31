"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export type TerminalLine =
	| { kind: "command"; prompt?: string; text: string }
	| { kind: "output"; text: string }
	| { kind: "success"; text: string }
	// A failure the reader is meant to notice. Several walkthroughs demonstrate
	// a command being *refused* on purpose — a blocked deploy, a host tool
	// denied by policy — and those read as ordinary output without this.
	| { kind: "error"; text: string }
	| { kind: "blank" };

type Props = {
	lines: TerminalLine[];
	typeMs?: number;
	pauseMs?: number;
	title?: string;
	className?: string;
	animate?: boolean;
};

/**
 * Animated terminal that types commands character-by-character and reveals
 * each output in one beat. Intentionally small scope — we use it for the
 * hero, quick-start, and each example's walkthrough.
 */
export function Terminal({
	lines,
	typeMs = 28,
	pauseMs = 420,
	title = "~/my-agent-app",
	className = "",
	animate = true,
}: Props) {
	const [rendered, setRendered] = useState<
		Array<{ line: TerminalLine; typed: string } | undefined>
	>(() =>
		animate
			? []
			: lines.map((line) => ({ line, typed: fullText(line) })),
	);

	useEffect(() => {
		if (!animate) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		async function run() {
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]!;
				if (line.kind === "command") {
					for (let c = 0; c <= line.text.length; c++) {
						if (cancelled) return;
						setRendered((prev) => {
							const next = [...prev];
							next[i] = { line, typed: line.text.slice(0, c) };
							return next;
						});
						await wait(typeMs);
					}
				} else {
					setRendered((prev) => {
						const next = [...prev];
						next[i] = { line, typed: fullText(line) };
						return next;
					});
				}
				await wait(pauseMs);
			}
		}
		run();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
		function wait(ms: number) {
			return new Promise<void>((resolve) => {
				timer = setTimeout(resolve, ms);
			});
		}
	}, [animate, lines, typeMs, pauseMs]);

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-80px" }}
			transition={{ duration: 0.4 }}
			// min-w-0 lets the terminal shrink to its grid/flex track
			// instead of expanding to fit its longest command line. The
			// Line components below already use `whitespace-pre-wrap
			// break-words` so they wrap once the parent is constrained.
			className={`card min-w-0 font-mono text-[13px] leading-relaxed ${className}`}
		>
			<div className="flex items-center gap-2 border-b border-[var(--ink)] bg-[var(--paper-edge)] px-3 py-2">
				<span className="flex gap-1.5">
					<span className="h-2.5 w-2.5 rounded-full border border-[var(--ink)]" />
					<span className="h-2.5 w-2.5 rounded-full border border-[var(--ink)]" />
					<span className="h-2.5 w-2.5 rounded-full border border-[var(--ink)]" />
				</span>
				<span className="ml-2 text-xs text-[var(--ink-muted)]">{title}</span>
			</div>
			<div className="min-h-40 p-4">
				{rendered.map((entry, i) => {
					if (!entry) return null;
					return <Line key={i} line={entry.line} typed={entry.typed} />;
				})}
			</div>
		</motion.div>
	);
}

function Line({ line, typed }: { line: TerminalLine; typed: string }) {
	switch (line.kind) {
		case "command":
			return (
				<div className="whitespace-pre-wrap break-words">
					<span className="mr-2 text-[var(--amber)]">
						{line.prompt ?? "$"}
					</span>
					<span>{typed}</span>
					{typed.length < line.text.length && <span className="caret" />}
				</div>
			);
		case "output":
			return (
				<div className="whitespace-pre-wrap break-words text-[var(--ink-soft)]">
					{typed}
				</div>
			);
		case "success":
			return (
				<div className="whitespace-pre-wrap break-words text-[color:var(--amber)]">
					{typed}
				</div>
			);
		case "error":
			// Same red as Callout's `danger` border, so a refused command in a
			// terminal and a warning in prose read as the same severity.
			return (
				<div className="whitespace-pre-wrap break-words text-[#c0392b]">
					{typed}
				</div>
			);
		case "blank":
			return <div>&nbsp;</div>;
	}
}

function fullText(line: TerminalLine): string {
	return line.kind === "blank" ? "" : line.text;
}
