import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
	primary:
		"bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)] hover:-translate-y-0.5 hover:-translate-x-0.5 hover:shadow-[4px_4px_0_var(--amber)]",
	secondary:
		"bg-[var(--paper)] text-[var(--ink)] border-[var(--ink)] hover:-translate-y-0.5 hover:-translate-x-0.5 hover:shadow-[4px_4px_0_var(--ink)]",
	ghost:
		"bg-transparent text-[var(--ink)] border-transparent hover:bg-[var(--paper-edge)]",
};

type CommonProps = {
	variant?: Variant;
	children: ReactNode;
	className?: string;
};

type ButtonProps = CommonProps &
	Omit<ComponentProps<"button">, "className" | "children">;
type LinkProps = CommonProps & {
	href: string;
	external?: boolean;
};

export function Button({
	variant = "primary",
	className = "",
	children,
	...props
}: ButtonProps) {
	return (
		<button
			className={`inline-flex items-center gap-2 border-2 px-4 py-2 font-mono text-sm transition-all duration-150 ${variants[variant]} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}

export function ButtonLink({
	variant = "primary",
	href,
	external = false,
	className = "",
	children,
}: LinkProps) {
	const common = `inline-flex items-center gap-2 border-2 px-4 py-2 font-mono text-sm transition-all duration-150 ${variants[variant]} ${className}`;
	if (external || href.startsWith("http")) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={common}>
				{children}
			</a>
		);
	}
	return (
		<Link href={href} className={common}>
			{children}
		</Link>
	);
}
