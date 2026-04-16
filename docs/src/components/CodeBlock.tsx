import { highlight, type Lang } from "@/lib/highlight";

type Props = {
	code: string;
	lang: Lang;
	filename?: string;
	/** 1-indexed line numbers to visually emphasize (amber). */
	highlightLines?: number[];
	className?: string;
};

export async function CodeBlock({
	code,
	lang,
	filename,
	highlightLines,
	className = "",
}: Props) {
	const html = await highlight(code.trim(), lang, highlightLines ?? []);
	return (
		<div className={`card overflow-hidden ${className}`}>
			{filename && (
				<div className="flex items-center justify-between border-b border-[var(--ink)] bg-[var(--paper-edge)] px-3 py-1.5 font-mono text-xs">
					<span className="text-[var(--ink)]">{filename}</span>
					<span className="uppercase tracking-widest text-[var(--ink-muted)]">
						{lang}
					</span>
				</div>
			)}
			<div
				className="[&_pre]:!bg-transparent"
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		</div>
	);
}
