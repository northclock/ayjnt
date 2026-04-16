import { ExampleCard } from "@/components/ExampleCard";
import { EXAMPLES } from "@/content/examples";

export const metadata = {
	title: "Examples — ayjnt",
	description:
		"Real ayjnt projects, from smallest-possible agent up to multi-agent missions. Each card links to a scaffold + code + deploy walkthrough.",
};

export default function ExamplesPage() {
	const stable = EXAMPLES.filter((e) => e.status === "stable");
	const planned = EXAMPLES.filter((e) => e.status === "comingSoon");
	return (
		<div>
			<section className="relative isolate border-b border-[var(--ink)]">
				<div className="grid-paper absolute inset-0 opacity-50" />
				<div className="relative mx-auto max-w-6xl px-6 pt-16 pb-12">
					<span className="tag mb-4">gallery</span>
					<h1 className="font-sans text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
						Examples you can copy.
					</h1>
					<p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--ink-soft)]">
						Every stable example here lives in <code className="font-mono">/examples</code>{" "}
						on GitHub. Each page on this site shows the scaffolding command,
						the code you&apos;d add to which file, an animated terminal
						walkthrough, and the deploy step.
					</p>
				</div>
			</section>

			<section className="border-b border-[var(--ink)] bg-[var(--paper)]">
				<div className="mx-auto max-w-6xl px-6 py-14">
					<SectionHeader
						label="Stable"
						title="Built and shipped"
						sub={`${stable.length} examples ready to fork, run, and deploy.`}
					/>
					<div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
						{stable.map((e) => (
							<ExampleCard key={e.slug} example={e} />
						))}
					</div>
				</div>
			</section>

			<section className="border-b border-[var(--ink)] bg-[var(--paper-edge)]">
				<div className="mx-auto max-w-6xl px-6 py-14">
					<SectionHeader
						label="Coming soon"
						title="Planned examples"
						sub="Design + spec in place; implementations land as they're ready."
					/>
					<div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
						{planned.map((e) => (
							<ExampleCard key={e.slug} example={e} />
						))}
					</div>
				</div>
			</section>
		</div>
	);
}

function SectionHeader({
	label,
	title,
	sub,
}: {
	label: string;
	title: string;
	sub?: string;
}) {
	return (
		<header className="max-w-2xl">
			<div className="font-mono text-xs uppercase tracking-widest text-[var(--amber)]">
				{label}
			</div>
			<h2 className="mt-2 font-sans text-2xl font-semibold tracking-tight md:text-3xl">
				{title}
			</h2>
			{sub && (
				<p className="mt-2 text-[var(--ink-soft)]">{sub}</p>
			)}
		</header>
	);
}
