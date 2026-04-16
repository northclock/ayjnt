// The ayjnt wordmark. The two-letter mark reads "aj" — phonetically
// "ayjnt" stripped of its vowels, matching the package name's
// consonant-only naming.

export function Logo({
	className = "",
	showWordmark = true,
}: {
	className?: string;
	showWordmark?: boolean;
}) {
	return (
		<span
			className={`inline-flex items-center gap-2 font-mono font-semibold ${className}`}
		>
			<span
				className="inline-flex h-7 w-7 items-center justify-center border-2 border-current text-sm"
				aria-hidden
			>
				aj
			</span>
			{showWordmark && <span className="text-base tracking-tight">ayjnt</span>}
		</span>
	);
}
