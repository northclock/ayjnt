"use client";

import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";

export type FileNode = {
	name: string;
	kind?: "ts" | "tsx" | "json" | "jsonc" | "md" | "sh" | "txt" | "env";
	highlight?: boolean;
	note?: string;
};

export type TreeNode = FolderNode | FileLeaf;

type FolderNode = {
	type: "folder";
	name: string;
	children: TreeNode[];
	defaultOpen?: boolean;
	highlight?: boolean;
	note?: string;
};

type FileLeaf = {
	type: "file";
	name: string;
	kind?: FileNode["kind"];
	highlight?: boolean;
	note?: string;
};

export function FileTree({
	root,
	title,
	className = "",
}: {
	root: TreeNode[];
	title?: string;
	className?: string;
}) {
	return (
		<div className={`card overflow-hidden ${className}`}>
			{title && (
				<div className="flex items-center gap-2 border-b border-[var(--ink)] bg-[var(--paper-edge)] px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-[var(--ink-muted)]">
					<span>{title}</span>
				</div>
			)}
			<div className="p-2 font-mono text-[13px]">
				{root.map((n, i) => (
					<Node key={i} node={n} depth={0} />
				))}
			</div>
		</div>
	);
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
	if (node.type === "folder") return <FolderRow node={node} depth={depth} />;
	return <FileRow node={node} depth={depth} />;
}

function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
	const [open, setOpen] = useState(node.defaultOpen ?? true);
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className={`group flex w-full cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-left transition-colors hover:bg-[var(--paper-edge)] ${
					node.highlight ? "bg-[var(--amber-glow)]" : ""
				}`}
				style={{ paddingLeft: `${depth * 14 + 6}px` }}
			>
				<ChevronRight
					className={`h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)] transition-transform ${
						open ? "rotate-90" : ""
					}`}
				/>
				{open ? (
					<FolderOpen className="h-4 w-4 shrink-0 text-[var(--amber)]" />
				) : (
					<Folder className="h-4 w-4 shrink-0 text-[var(--amber)]" />
				)}
				<span className="truncate">{node.name}</span>
				{node.note && (
					<span className="ml-auto pl-2 text-xs text-[var(--ink-muted)]">
						{node.note}
					</span>
				)}
			</button>
			{open &&
				node.children.map((child, i) => (
					<Node key={i} node={child} depth={depth + 1} />
				))}
		</div>
	);
}

function FileRow({ node, depth }: { node: FileLeaf; depth: number }) {
	const kind = node.kind ?? inferKind(node.name);
	return (
		<div
			className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${
				node.highlight ? "bg-[var(--amber-glow)]" : ""
			}`}
			style={{ paddingLeft: `${depth * 14 + 22}px` }}
		>
			<FileIcon kind={kind} />
			<span className="truncate">
				{node.name}
				{node.highlight && <span className="ml-2 text-[var(--amber)]">←</span>}
			</span>
			{node.note && (
				<span className="ml-auto pl-2 text-xs text-[var(--ink-muted)]">
					{node.note}
				</span>
			)}
		</div>
	);
}

function inferKind(name: string): FileNode["kind"] | undefined {
	if (name.endsWith(".tsx")) return "tsx";
	if (name.endsWith(".ts")) return "ts";
	if (name.endsWith(".jsonc")) return "jsonc";
	if (name.endsWith(".json")) return "json";
	if (name.endsWith(".md")) return "md";
	if (name.endsWith(".sh")) return "sh";
	if (name.startsWith(".env") || name === ".env") return "env";
	return undefined;
}

function FileIcon({ kind }: { kind: FileNode["kind"] | undefined }) {
	const color = (() => {
		switch (kind) {
			case "ts": return "#3178c6";
			case "tsx": return "#61dafb";
			case "json":
			case "jsonc": return "#cb8b16";
			case "md": return "#6b6a63";
			case "sh": return "#4a7a00";
			case "env": return "#8e44ad";
			default: return "currentColor";
		}
	})();
	const label = (() => {
		switch (kind) {
			case "ts": return "TS";
			case "tsx": return "TSX";
			case "json":
			case "jsonc": return "{}";
			case "md": return "MD";
			case "sh": return "$_";
			case "env": return ".e";
			default: return "•";
		}
	})();
	return (
		<span
			className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[9px] font-bold leading-none text-white"
			style={{ background: color }}
			aria-hidden
		>
			{label}
		</span>
	);
}
