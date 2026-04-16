// Shiki-based syntax highlighting. Called from Server Components, so
// shiki itself never ships to the client — only the rendered HTML does.
// We cache a single highlighter across renders to keep builds fast.

import { createHighlighter, type Highlighter } from "shiki";

type Lang = "ts" | "tsx" | "json" | "jsonc" | "sh" | "html" | "css";

let cached: Promise<Highlighter> | null = null;

function getHighlighter() {
	if (!cached) {
		cached = createHighlighter({
			themes: ["github-light", "github-dark"],
			langs: ["typescript", "tsx", "json", "jsonc", "shellscript", "html", "css"],
		});
	}
	return cached;
}

const LANG_TO_SHIKI: Record<Lang, string> = {
	ts: "typescript",
	tsx: "tsx",
	json: "json",
	jsonc: "jsonc",
	sh: "shellscript",
	html: "html",
	css: "css",
};

export async function highlight(
	code: string,
	lang: Lang,
	highlightLines: number[] = [],
): Promise<string> {
	const hl = await getHighlighter();
	return hl.codeToHtml(code, {
		lang: LANG_TO_SHIKI[lang],
		themes: {
			light: "github-light",
			dark: "github-dark",
		},
		defaultColor: false,
		transformers: [
			{
				line(node, line) {
					if (highlightLines.includes(line)) {
						if (!Array.isArray(node.properties.class)) {
							node.properties.class = [];
						}
						(node.properties.class as string[]).push("highlighted");
					}
				},
			},
		],
	});
}

export type { Lang };
