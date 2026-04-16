/**
 * ASCII / textual "what the app should look like" mockup. Used at the end
 * of each example walkthrough on /examples/<slug>. Not an image — we want
 * the mockup to render the same regardless of viewport, and SSG-friendly.
 *
 * The label (optional) sits in a filename-style strip on top so the frame
 * matches the CodeBlock / Terminal visual language.
 */
export function Screenshot({
	content,
	label,
	className = "",
}: {
	content: string;
	label?: string;
	className?: string;
}) {
	return (
		<div className={`card overflow-hidden ${className}`}>
			{label && (
				<div className="flex items-center justify-between border-b border-[var(--ink)] bg-[var(--paper-edge)] px-3 py-1.5 font-mono text-xs">
					<span className="text-[var(--ink)]">{label}</span>
					<span className="uppercase tracking-widest text-[var(--ink-muted)]">
						result
					</span>
				</div>
			)}
			<pre
				className="overflow-x-auto bg-[var(--ink)] p-4 font-mono text-[11px] leading-[1.55] text-[var(--paper)]"
				style={{ tabSize: 2 }}
			>
				<code>{content}</code>
			</pre>
		</div>
	);
}
