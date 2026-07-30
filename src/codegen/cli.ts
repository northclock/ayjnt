// Generator for `@ayjnt/cli` — the project-specific context type handed to a
// root-level `cli.ts`.
//
// This file emits TYPES ONLY. The runtime objects (`agents`, `workflows`) are
// built dynamically by the host from the same manifest, so there is no
// generated code to keep in sync with the host's behavior — only a typed view
// of it. That keeps the generated artifact small and means a bug can live in
// exactly one place.
//
// Accessors are route-nested and camelized, mirroring the file tree:
//
//   agents/counter/agent.ts      → agents.counter("demo")
//   agents/admin/users/agent.ts  → agents.admin.users("u1")
//   agents/my-agent/agent.ts     → agents.myAgent("x")
//
// A route that is both a leaf and a parent (`/admin` plus `/admin/users`)
// becomes a callable object — a function with properties hanging off it —
// which TypeScript expresses as an intersection.

import * as path from "node:path";
import type { AgentEntry, Manifest, WorkflowEntry } from "../core/types.ts";

/**
 * Route names that would collide with a generated module under
 * `.ayjnt/client/`. `@ayjnt/cli` resolves to `client/cli.ts`, which TypeScript
 * prefers over `client/cli/index.tsx` — so an agent at `agents/cli/` would
 * silently shadow the generated CLI types with its own hook.
 */
export const RESERVED_CLIENT_ROUTES = new Set(["cli"]);

/**
 * Reject agent routes whose first segment collides with a generated client
 * module. Same class of guard as the reserved `__home` asset segment: the
 * failure it prevents is silent and confusing.
 */
export function assertNoReservedClientRoutes(manifest: Manifest): void {
  for (const agent of manifest.agents) {
    const first = agent.routePath.slice(1).split("/")[0];
    if (first && RESERVED_CLIENT_ROUTES.has(first)) {
      throw new Error(
        `Agent route ${agent.routePath} uses the reserved name "${first}" — ` +
          `the framework generates @ayjnt/${first} for its own use, and your ` +
          `agent's typed hook would shadow it. Rename the folder.`,
      );
    }
  }
}

/** camelCase a single route segment: "my-agent" → "myAgent". */
export function camelizeSegment(segment: string): string {
  const parts = segment.split(/[-_.]+/).filter(Boolean);
  if (parts.length === 0) return segment;
  return (
    parts[0]!.toLowerCase() +
    parts
      .slice(1)
      .map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase())
      .join("")
  );
}

/** Route path → the camelized key path used in the accessor tree. */
export function accessorKeyPath(routePath: string): string[] {
  return routePath
    .slice(1)
    .split("/")
    .filter(Boolean)
    .map(camelizeSegment);
}

/** Relative import specifier from `fromDir` to `toFile`, POSIX-separated and
 *  always explicitly relative. */
function toImportSpec(fromDir: string, toFile: string): string {
  const rel = path.relative(fromDir, path.resolve(toFile)).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : "./" + rel;
}

type Node = {
  /** Agent whose route ends exactly here, if any. */
  leaf?: { agent: AgentEntry; local: string };
  children: Map<string, Node>;
};

function buildTree(
  agents: AgentEntry[],
  localFor: Map<AgentEntry, string>,
): Node {
  const root: Node = { children: new Map() };
  for (const agent of agents) {
    const keys = accessorKeyPath(agent.routePath);
    let node = root;
    for (const key of keys) {
      let next = node.children.get(key);
      if (!next) {
        next = { children: new Map() };
        node.children.set(key, next);
      }
      node = next;
    }
    node.leaf = { agent, local: localFor.get(agent)! };
  }
  return root;
}

/** Render the `agents` accessor type from the route tree. */
function renderNode(node: Node, indent: string): string {
  const inner = indent + "  ";
  const parts: string[] = [];

  for (const [key, child] of [...node.children.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const fn = child.leaf
      ? `(instance?: string) => AgentHandle<${child.leaf.local}>`
      : null;
    const obj = child.children.size > 0 ? renderNode(child, inner) : null;

    // A route that is both a leaf and a parent is a callable object.
    let type: string;
    if (fn && obj) type = `${fn} & ${obj}`;
    else if (fn) type = fn;
    else type = obj!;

    parts.push(`${inner}${key}: ${type};`);
  }

  return parts.length === 0 ? "{}" : `{\n${parts.join("\n")}\n${indent}}`;
}

export type CliTypesOptions = {
  /** Absolute path of the file being written (.ayjnt/client/cli.ts). Used to
   *  compute relative type imports of agent / workflow sources. */
  outPath: string;
};

/**
 * Generate `.ayjnt/client/cli.ts`, imported by user code as `@ayjnt/cli`.
 *
 * Everything is `import type` — nothing in this module survives to runtime, so
 * importing it from `cli.ts` never pulls agent code (which targets workerd)
 * into the Bun process.
 */
export function generateCliTypes(
  manifest: Manifest,
  options: CliTypesOptions,
): string {
  const outDir = path.dirname(path.resolve(options.outPath));
  const { agents, workflows } = manifest;

  // Stable local alias per agent/workflow — class names can repeat across
  // routes, and two agents named `Agent` would otherwise collide.
  const agentLocal = new Map<AgentEntry, string>(
    agents.map((a, i) => [a, `__Agent${i}`]),
  );
  const workflowLocal = new Map<WorkflowEntry, string>(
    workflows.map((w, i) => [w, `__Workflow${i}`]),
  );

  const imports = [
    `import type {\n  AgentHandle,\n  AyjntCliBase,\n  WorkflowHandle,\n} from "ayjnt/cli";`,
  ];
  if (workflows.length > 0) {
    imports.push(`import type { WorkflowParams } from "ayjnt/workflow";`);
  }
  for (const agent of agents) {
    imports.push(
      `import type ${agentLocal.get(agent)!} from "${toImportSpec(outDir, agent.sourceFile)}";`,
    );
  }
  for (const workflow of workflows) {
    imports.push(
      `import type ${workflowLocal.get(workflow)!} from "${toImportSpec(outDir, workflow.sourceFile)}";`,
    );
  }

  const agentsType =
    agents.length === 0
      ? "Record<string, never>"
      : renderNode(buildTree(agents, agentLocal), "");

  const workflowsType =
    workflows.length === 0
      ? "Record<string, never>"
      : `{\n${workflows
          .map(
            (w) =>
              `  ${camelizeSegment(w.name)}: WorkflowHandle<WorkflowParams<typeof ${workflowLocal.get(w)!}>>;`,
          )
          .join("\n")}\n}`;

  return `\
// GENERATED by ayjnt — do not edit. Regenerated on every \`ayjnt build\`.
//
// The context your root-level \`cli.ts\` receives:
//
//   import type { AyjntCli } from "@ayjnt/cli";
//
//   export default async function ({ agents, workflows }: AyjntCli) {
//     // ...
//   }
//
// \`agents\` mirrors your agents/ tree; \`workflows\` is keyed by workflow name.
// Every method call is a real Durable Object RPC into the local runtime — no
// HTTP, no port, no handshake.

${imports.join("\n")}

/** Agent accessors, mirroring the agents/ file tree. Call with an instance
 *  name to get a handle; omit it for the "default" instance. */
export type AyjntAgents = ${agentsType};

/** Workflow bindings, keyed by camelized workflow name. */
export type AyjntWorkflows = ${workflowsType};

/** The full \`cli.ts\` context for this project. */
export type AyjntCli = AyjntCliBase & {
  agents: AyjntAgents;
  workflows: AyjntWorkflows;
};

export type { AgentHandle, WorkflowHandle } from "ayjnt/cli";
`;
}
