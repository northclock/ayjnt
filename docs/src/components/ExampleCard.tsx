"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Clock } from "lucide-react";
import type { ExampleMeta } from "@/content/examples";

export function ExampleCard({ example }: { example: ExampleMeta }) {
	const isComingSoon = example.status === "comingSoon";
	const Wrapper = ({ children }: { children: React.ReactNode }) =>
		isComingSoon ? (
			<div aria-disabled className="block">{children}</div>
		) : (
			<Link href={`/examples/${example.slug}`} className="block">{children}</Link>
		);

	return (
		<motion.div
			initial={{ opacity: 0, y: 10 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-40px" }}
			transition={{ duration: 0.35 }}
		>
			<Wrapper>
				<article
					className={`card card-interactive group flex h-full flex-col overflow-hidden ${isComingSoon ? "opacity-60" : ""}`}
				>
					<Preview example={example} />
					<div className="flex flex-1 flex-col gap-3 border-t border-[var(--ink)] p-4">
						<div className="flex items-center justify-between">
							<h3 className="font-mono text-sm font-semibold uppercase tracking-widest">
								{example.title}
							</h3>
							{isComingSoon ? (
								<span className="tag">
									<Clock className="h-3 w-3" />
									soon
								</span>
							) : (
								<ArrowUpRight
									className="h-4 w-4 text-[var(--ink-muted)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--amber)]"
									aria-hidden
								/>
							)}
						</div>
						<p className="text-sm leading-relaxed text-[var(--ink-soft)]">
							{example.description}
						</p>
						<div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
							{example.tags.map((t) => (
								<span key={t} className="tag">{t}</span>
							))}
						</div>
					</div>
				</article>
			</Wrapper>
		</motion.div>
	);
}

function Preview({ example }: { example: ExampleMeta }) {
	switch (example.preview.kind) {
		case "terminal": return <TerminalPreview lines={example.preview.lines} />;
		case "ui": return <UiPreview caption={example.preview.caption} />;
		case "diagram": return <DiagramPreview nodes={example.preview.nodes} />;
		case "game": return <GamePreview caption={example.preview.caption} />;
	}
}

function TerminalPreview({ lines }: { lines: string[] }) {
	return (
		<div className="relative h-44 overflow-hidden bg-[var(--paper-edge)] p-4 font-mono text-[11px] leading-relaxed text-[var(--ink-soft)]">
			<div className="grid-paper-dots absolute inset-0 opacity-60" />
			<div className="relative">
				{lines.map((line, i) => (
					<div key={i} className="truncate">
						<span className="mr-1.5 text-[var(--amber)]">$</span>
						{line}
					</div>
				))}
			</div>
		</div>
	);
}

function UiPreview({ caption }: { caption: string }) {
	return (
		<div className="relative h-44 overflow-hidden bg-[var(--paper)] p-4">
			<div className="grid-paper absolute inset-0 opacity-50" />
			<div className="relative flex h-full flex-col items-center justify-center gap-3">
				<div className="flex items-end gap-2">
					<div className="h-6 w-6 border-2 border-[var(--ink)]" />
					<div className="h-10 w-10 border-2 border-[var(--amber)] bg-[var(--amber-glow)]" />
					<div className="h-8 w-8 border-2 border-[var(--ink)]" />
				</div>
				<div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
					{caption}
				</div>
			</div>
		</div>
	);
}

function DiagramPreview({ nodes }: { nodes: string[] }) {
	return (
		<div className="relative h-44 overflow-hidden bg-[var(--paper)] p-4">
			<div className="grid-paper absolute inset-0 opacity-50" />
			<div className="relative flex h-full flex-col items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-widest">
				{nodes.map((n, i) => (
					<div key={n} className="flex items-center gap-2">
						<span className="border border-[var(--ink)] bg-[var(--paper)] px-2 py-0.5">{n}</span>
						{i < nodes.length - 1 && <span>↓</span>}
					</div>
				))}
			</div>
		</div>
	);
}

function GamePreview({ caption }: { caption: string }) {
	return (
		<div className="relative h-44 overflow-hidden bg-[var(--ink)] p-4 text-[var(--paper)]">
			<div
				className="absolute inset-0 opacity-30"
				style={{
					backgroundImage:
						"linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
					backgroundSize: "24px 24px",
				}}
			/>
			<div className="relative flex h-full items-center justify-center">
				<div className="text-center">
					<div className="font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--amber)]">
						{caption}
					</div>
					<div className="mt-2 font-mono text-[9px] opacity-60">
						↖ ↑ ↗<br />← ● →<br />↙ ↓ ↘
					</div>
				</div>
			</div>
		</div>
	);
}
