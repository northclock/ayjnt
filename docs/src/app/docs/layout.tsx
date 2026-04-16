import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/DocsSidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
	return (
		<div className="mx-auto grid max-w-[1320px] grid-cols-1 md:grid-cols-[260px_1fr]">
			<aside className="border-b border-[var(--ink)] md:border-b-0">
				<DocsSidebar />
			</aside>
			<div className="min-w-0 px-6 py-12 md:px-12 md:py-14 lg:px-16">
				{children}
			</div>
		</div>
	);
}
