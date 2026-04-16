import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitBranch } from "lucide-react";
import { Terminal } from "@/components/Terminal";
import { FileTree } from "@/components/FileTree";
import { CodeBlock } from "@/components/CodeBlock";
import { Screenshot } from "@/components/Screenshot";
import { ButtonLink } from "@/components/Button";
import { EXAMPLES, getExample, type Step } from "@/content/examples";

export function generateStaticParams() {
	return EXAMPLES.filter((e) => e.status === "stable").map((e) => ({
		slug: e.slug,
	}));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const example = getExample(slug);
	if (!example) return {};
	return {
		title: `${example.title} — ayjnt example`,
		description: example.description,
	};
}

export default async function ExamplePage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const example = getExample(slug);
	if (!example || example.status !== "stable") return notFound();

	return (
		<div>
			<section className="relative isolate border-b border-[var(--ink)]">
				<div className="grid-paper absolute inset-0 opacity-50" />
				<div className="relative mx-auto max-w-5xl px-6 pt-14 pb-14">
					<Link
						href="/examples"
						className="mb-6 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[var(--ink-muted)] hover:text-[var(--ink)]"
					>
						<ArrowLeft className="h-3 w-3" />
						All examples
					</Link>
					<div className="flex flex-wrap items-center gap-2">
						{example.tags.map((t) => (
							<span key={t} className="tag">
								{t}
							</span>
						))}
					</div>
					<h1 className="mt-3 font-sans text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
						{example.title}
					</h1>
					<p className="mt-4 max-w-3xl text-lg leading-relaxed text-[var(--ink-soft)]">
						{example.description}
					</p>
					{example.exampleDir && (
						<div className="mt-6 flex flex-wrap gap-3">
							<ButtonLink
								href={`https://github.com/northclock/ayjnt/tree/main/${example.exampleDir}`}
								variant="secondary"
								external
							>
								<GitBranch className="h-4 w-4" />
								source on GitHub
							</ButtonLink>
						</div>
					)}

					{example.whatYoullLearn && example.whatYoullLearn.length > 0 && (
						<div className="mt-10 border-l-2 border-[var(--amber)] pl-4">
							<div className="font-mono text-xs uppercase tracking-widest text-[var(--amber)]">
								What you&apos;ll learn
							</div>
							<ul className="mt-3 space-y-1.5 text-sm text-[var(--ink-soft)]">
								{example.whatYoullLearn.map((item) => (
									<li key={item} className="flex items-start gap-2">
										<span
											className="mt-2 inline-block h-1 w-1 shrink-0 bg-[var(--amber)]"
											aria-hidden
										/>
										<span>{item}</span>
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			</section>

			{example.steps && example.steps.length > 0 && (
				<section className="bg-[var(--paper)]">
					<div className="mx-auto max-w-5xl px-6 py-16">
						<div className="flex flex-col gap-20">
							{example.steps.map((step, i) => (
								<StepBlock key={i} step={step} index={i} />
							))}
						</div>
					</div>
				</section>
			)}
		</div>
	);
}

async function StepBlock({ step, index }: { step: Step; index: number }) {
	return (
		<article className="grid gap-8 md:grid-cols-[1fr_1.4fr]">
			<header className="md:sticky md:top-24 md:self-start">
				<div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[var(--amber)]">
					<span className="inline-flex h-6 w-6 items-center justify-center border border-[var(--amber)] text-[10px] text-[var(--amber)]">
						{String(index + 1).padStart(2, "0")}
					</span>
					step
				</div>
				<h2 className="mt-3 font-sans text-2xl font-semibold tracking-tight md:text-3xl">
					{step.title}
				</h2>
				<p className="mt-3 text-[var(--ink-soft)] leading-relaxed">
					{step.blurb}
				</p>
			</header>
			<div className="flex flex-col gap-5">
				{step.terminal && <Terminal lines={step.terminal} />}
				{step.tree && <FileTree root={step.tree} title={step.treeTitle} />}
				{step.files?.map((f) => (
					<CodeBlock
						key={f.path}
						code={f.code}
						lang={f.lang}
						filename={f.path}
						highlightLines={f.highlightLines}
					/>
				))}
				{step.screenshot && (
					<Screenshot
						content={step.screenshot.content}
						label={step.screenshot.label}
					/>
				)}
			</div>
		</article>
	);
}
