import type { ReactNode } from "react";
import { AlertTriangle, Info, Lightbulb, OctagonAlert } from "lucide-react";

type Kind = "note" | "tip" | "warn" | "danger";

const STYLES: Record<Kind, { border: string; label: string }> = {
	note: {
		border: "border-[var(--blue)]",
		label: "Note",
	},
	tip: {
		border: "border-[var(--amber)]",
		label: "Tip",
	},
	warn: {
		border: "border-[#c07a00]",
		label: "Heads up",
	},
	danger: {
		border: "border-[#c0392b]",
		label: "Careful",
	},
};

const ICON: Record<Kind, typeof Info> = {
	note: Info,
	tip: Lightbulb,
	warn: AlertTriangle,
	danger: OctagonAlert,
};

export function Callout({
	kind = "note",
	title,
	children,
}: {
	kind?: Kind;
	title?: string;
	children: ReactNode;
}) {
	const style = STYLES[kind];
	const Icon = ICON[kind];
	return (
		<div
			className={`my-6 border-l-4 bg-[var(--paper-edge)] px-4 py-3 ${style.border}`}
		>
			<div className="mb-1 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest">
				<Icon className="h-3.5 w-3.5" />
				{title ?? style.label}
			</div>
			<div className="prose-body text-[14.5px] leading-relaxed text-[var(--ink-soft)]">
				{children}
			</div>
		</div>
	);
}
