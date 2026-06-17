// ayjnt new — scaffold a new project with a starter agent.
//
//   ayjnt new my-app            → UI starter: a counter agent, its co-located
//                                 page, and a root home page at "/"
//   ayjnt new my-app --empty    → bare starter: one "alive" agent, no UI
//
// UI is included by default — most projects want a face. `--empty` is the
// smallest thing that proves the pipeline works: one agent that responds
// "I'm alive". Examples in /examples start from `--empty` and replace the
// alive/ folder with their own agents.
//
// Inlines all template files as string constants so we don't need to ship
// a templates/ directory on npm (and worry about file path resolution
// inside the published package).

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `\
ayjnt new <directory> [options]

Scaffold a new ayjnt project. Includes a UI by default: a counter agent, its
co-located page, and a root home page served at "/".

Options:
  --empty           Skip the UI — scaffold a single bare "I'm alive" agent
                    and no React. Good starting point for API-only agents.
  -h, --help        Show this help.

Next steps after scaffolding:
  cd <directory>
  bun install
  bun run dev
`;

type Template = "ui" | "empty";

export type NewArgs =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "scaffold"; targetDir: string; template: Template };

// `--with-ui` used to opt INTO the UI; the UI is now the default, so the
// flag is a no-op kept only so old scripts/docs don't hard-error. newCmd
// prints a one-line notice when it's used.
const KNOWN_FLAGS = new Set(["--empty", "--with-ui"]);

/**
 * Validate `ayjnt new` arguments. Pure — exported for tests; newCmd owns
 * the printing/exit. A typo'd flag (--emty) silently scaffolding the wrong
 * thing is worse than an error; same for a stray positional.
 */
export function validateNewArgs(argv: string[]): NewArgs {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    return { kind: "help" };
  }
  const unknownFlags = argv.filter(
    (a) => a.startsWith("-") && !KNOWN_FLAGS.has(a),
  );
  if (unknownFlags.length > 0) {
    return { kind: "error", message: `unknown option ${unknownFlags[0]}` };
  }
  const positional = argv.filter((a) => !a.startsWith("-"));
  if (positional.length > 1) {
    return {
      kind: "error",
      message: `expected one <directory>, got: ${positional.join(", ")}`,
    };
  }
  if (!positional[0]) {
    return { kind: "error", message: "missing <directory>" };
  }
  return {
    kind: "scaffold",
    targetDir: positional[0],
    // UI by default; --empty opts out. (--empty wins over a stray --with-ui.)
    template: argv.includes("--empty") ? "empty" : "ui",
  };
}

/**
 * Check the resolved target path is scaffoldable. An existing EMPTY
 * directory is fine — `mkdir my-app && cd my-app && ayjnt new .` is a
 * natural flow; we only refuse when there's content we could clobber.
 * Returns an error message, or null when the target is usable.
 */
export function validateTargetDir(target: string): string | null {
  if (!existsSync(target)) return null;
  if (!statSync(target).isDirectory()) {
    return `${target} exists and is not a directory.`;
  }
  if (readdirSync(target).some((f) => f !== ".DS_Store")) {
    return `${target} is not empty — pick a new directory or empty it first.`;
  }
  return null;
}

export async function newCmd(argv: string[]): Promise<void> {
  const parsed = validateNewArgs(argv);
  if (parsed.kind === "help") {
    console.log(USAGE);
    return;
  }
  if (parsed.kind === "error") {
    console.error(`error: ${parsed.message}\n`);
    console.error(USAGE);
    process.exit(1);
  }
  if (argv.includes("--with-ui")) {
    console.log(
      "note: ayjnt includes a UI by default now — --with-ui is no longer needed (use --empty to skip the UI).",
    );
  }
  const { targetDir, template } = parsed;

  const target = path.resolve(targetDir);
  const targetProblem = validateTargetDir(target);
  if (targetProblem) {
    throw new Error(targetProblem);
  }

  const projectName = sanitizePackageName(path.basename(target));

  await scaffold(target, projectName, template);

  console.log(`\n✓ scaffolded ${targetDir}/ (${template})\n`);
  console.log(`  cd ${targetDir}`);
  console.log(`  bun install`);
  console.log(`  bun run dev\n`);
  if (template === "ui") {
    console.log(`  then open http://localhost:8787/            (home page)`);
    console.log(`            http://localhost:8787/counter/demo (counter — open two tabs)\n`);
  } else {
    console.log(`  then curl http://localhost:8787/alive/hello`);
    console.log(`  → { "status": "alive", "instance": "hello" }\n`);
  }
}

async function scaffold(
  target: string,
  projectName: string,
  template: Template,
): Promise<void> {
  mkdirSync(target, { recursive: true });
  mkdirSync(path.join(target, "agents"), { recursive: true });

  await Bun.write(
    path.join(target, "package.json"),
    packageJson(projectName, template),
  );
  await Bun.write(path.join(target, "tsconfig.json"), tsconfig(template));
  await Bun.write(path.join(target, ".gitignore"), gitignore());
  await Bun.write(
    path.join(target, "README.md"),
    readme(projectName, template),
  );

  if (template === "empty") {
    mkdirSync(path.join(target, "agents", "alive"), { recursive: true });
    await Bun.write(
      path.join(target, "agents", "alive", "agent.ts"),
      blankAgent(),
    );
  } else {
    mkdirSync(path.join(target, "agents", "counter"), { recursive: true });
    await Bun.write(
      path.join(target, "agents", "counter", "agent.ts"),
      counterAgent(),
    );
    await Bun.write(
      path.join(target, "agents", "counter", "app.tsx"),
      counterApp(),
    );
    // Root home UI at "/" — agents/app.tsx. Talks to the counter agent
    // through its generated typed hook, the same way any page would.
    await Bun.write(path.join(target, "agents", "app.tsx"), homeApp());
  }

  // Drop the Claude Code skills next to the project so authors who use
  // Claude Code get the ayjnt-* skills (new-agent, mcp-app, middleware,
  // rpc, troubleshoot, etc.) auto-loaded. Best-effort: silently skipped
  // if the package wasn't installed with `.claude/skills` shipped (e.g.
  // an old framework version) or if the resolved path doesn't exist.
  copySkills(target);
}

/**
 * Find `.claude/skills/` relative to this module and copy it into the new
 * project. The compiled CLI lives at `<package-root>/dist/ayjnt.js` (one
 * level below the root, hence the first candidate), while in framework
 * dev this module runs from `<package-root>/src/cli/new.ts` (two levels
 * below, hence the second).
 */
function copySkills(target: string): void {
  // `import.meta.url` works in both Bun's direct .ts execution and the
  // bundled .js artifact.
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(cliDir, "..", ".claude", "skills"),
    path.resolve(cliDir, "..", "..", ".claude", "skills"),
  ];
  const source = candidates.find((p) => existsSync(p));
  if (!source) return; // shipping without skills — that's fine
  const dest = path.join(target, ".claude", "skills");
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(source, dest, { recursive: true });
}

function sanitizePackageName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "ayjnt-app";
}

// -- templates --------------------------------------------------------------

function packageJson(name: string, template: Template): string {
  const deps: Record<string, string> = {
    agents: "^0.13",
  };
  const devDeps: Record<string, string> = {
    "@types/bun": "latest",
    "@cloudflare/workers-types": "latest",
    ayjnt: "^0.5",
    wrangler: "^4",
  };

  if (template === "ui") {
    deps["react"] = "^19";
    deps["react-dom"] = "^19";
    devDeps["@types/react"] = "^19";
    devDeps["@types/react-dom"] = "^19";
  }

  const pkg = {
    name,
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: {
      dev: "ayjnt dev",
      build: "ayjnt build",
      deploy: "ayjnt deploy",
      migrate: "ayjnt migrate",
    },
    dependencies: deps,
    devDependencies: devDeps,
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function tsconfig(template: Template): string {
  const compilerOptions: Record<string, unknown> = {
    lib: template === "ui" ? ["ESNext", "DOM", "DOM.Iterable"] : ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleDetection: "force",
    jsx: "react-jsx",
    allowJs: true,
    types: ["bun", "@cloudflare/workers-types"],
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    paths: {
      "@ayjnt/env": ["./.ayjnt/env.d.ts"],
      "@ayjnt/*": ["./.ayjnt/client/*"],
    },
  };
  if (template === "ui") {
    compilerOptions["jsxImportSource"] = "react";
  }
  return JSON.stringify({ compilerOptions }, null, 2) + "\n";
}

function gitignore(): string {
  return `# dependencies
node_modules

# output
dist
*.tgz

# ayjnt generated artifacts. Only .ayjnt/migrations.json is committed —
# everything else regenerates on every \`ayjnt build\`.
.ayjnt/*
!.ayjnt/migrations.json

# wrangler local state
.wrangler

# env
.env
.env.local
.env.*.local
.dev.vars

# editor
.vscode
.idea
.DS_Store
`;
}

function readme(name: string, template: Template): string {
  const body =
    template === "ui"
      ? `## What's here

- \`agents/counter/agent.ts\` — a \`CounterAgent\` with persistent state.
- \`agents/counter/app.tsx\` — the counter's own page, served at \`/counter/<instance>\`.
- \`agents/app.tsx\` — the **home page** served at \`/\`. It's the root UI; it
  talks to the counter through its generated typed hook (\`@ayjnt/counter\`).

Open http://localhost:8787/ for the home page, and
http://localhost:8787/counter/demo for the counter — open it in two tabs and
the \`+\` button in one updates the other.

Each path segment after \`/counter/\` is a separate Durable Object instance
with its own state: \`/counter/room-1\` and \`/counter/room-2\` are independent.

## Adding more UI

Drop an \`app.tsx\` next to any \`agent.ts\` for a per-agent page, or edit
\`agents/app.tsx\` for the home page. Export your component as the default —
the framework generates the mount (createRoot, StrictMode, an error boundary).
`
      : `## Your bare starter

\`agents/alive/agent.ts\` is a minimal agent that responds with
\`{ "status": "alive", "instance": "<id>" }\` to any request. It exists to prove
the pipeline works before you replace it with something interesting.

Try:

\`\`\`sh
curl http://localhost:8787/alive/hello
curl http://localhost:8787/alive/world
\`\`\`

Each path segment after \`/alive/\` is a separate Durable Object instance.

## Adding your own agent

1. \`rm -rf agents/alive\` (or leave it — you can have as many agents as you want)
2. \`mkdir agents/<your-agent>\` and drop an \`agent.ts\` in it
3. Default-export a class that extends \`Agent\`

That's it. Run \`bun run dev\` and your new agent is reachable at \`/<your-agent>/:instance-id\`.

## Adding a UI

Drop an \`app.tsx\` next to \`agent.ts\` (or \`agents/app.tsx\` for a home page
at \`/\`):

\`\`\`tsx
// agents/alive/app.tsx
import { useAgent } from "@ayjnt/alive";

export default function App() {
  const agent = useAgent();
  return <div>agent {agent.name}: {JSON.stringify(agent.state)}</div>;
}
\`\`\`

Export the component as the default — the framework generates the mount
(createRoot, StrictMode, an error boundary) for you.

Add \`react\`, \`react-dom\`, and their types to \`package.json\`, run
\`bun install\`, then \`bun run dev\`. (Or scaffold with the UI included from the
start — just \`ayjnt new\` without \`--empty\`.)
`;
  return `# ${name}

An ayjnt project. [Docs](https://github.com/northclock/ayjnt).

## Run it

\`\`\`sh
bun install
bun run dev
\`\`\`

${body}
## Commands

| Command | What it does |
|---|---|
| \`bun run dev\` | Local worker via \`wrangler dev\`. |
| \`bun run build\` | Generate config + bundle, no deploy. |
| \`bun run deploy\` | Build + git-safety checks + \`wrangler deploy\`. |
| \`bun run migrate\` | Preview pending migrations. |

## Claude Code skills

The \`.claude/skills/\` directory ships with this scaffold. If you use
Claude Code, those skills auto-load when you open this project and
guide authoring tasks like *add an agent*, *add a UI*, *make an MCP
App*, *call another agent*, and *troubleshoot a failure*. They're
plain markdown — edit or delete any that don't fit your house style.
`;
}

/**
 * The bare starter: one agent that returns "I'm alive" on every request.
 * Intentionally empty state, no methods — just the minimum needed to prove
 * routing, DO binding, and state wiring all work. Examples in /examples start
 * from this (`ayjnt new --empty`) and replace agents/alive with their own.
 */
function blankAgent(): string {
  return `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

/**
 * Bare starter agent. Responds with "I'm alive" to any request on any
 * instance id (\`/alive/hello\`, \`/alive/anything\`, etc.).
 *
 * Each path segment after \`/alive/\` is a separate Durable Object instance
 * with isolated state. For now that state is empty — delete this agent and
 * drop your own under agents/ when you're ready.
 */
export default class AliveAgent extends Agent<GeneratedEnv> {
  override async onRequest(_request: Request): Promise<Response> {
    return Response.json({
      status: "alive",
      message: "I'm alive",
      instance: this.name,
    });
  }
}
`;
}

function counterAgent(): string {
  return `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { count: number };

export default class CounterAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { count: 0 };

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
`;
}

function counterApp(): string {
  // Export-default convention: the framework generates the mount wrapper
  // (createRoot + StrictMode + error boundary). Scaffolding the legacy
  // manual-mount pattern here would greet new users with a deprecation
  // warning on their very first `bun run dev`.
  return `import { useAgent } from "@ayjnt/counter";

export default function Counter() {
  const agent = useAgent();
  const count = agent.state?.count ?? 0;
  const set = (next: number) => agent.setState({ count: next });

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Counter</h1>
      <p style={styles.meta}>
        instance: <code>{agent.name}</code>
        <br />
        open this URL in another tab — state syncs live
      </p>
      <div style={styles.count}>{count}</div>
      <div style={styles.buttons}>
        <button style={styles.button} onClick={() => set(count - 1)}>−</button>
        <button style={styles.button} onClick={() => set(0)}>reset</button>
        <button style={styles.button} onClick={() => set(count + 1)}>+</button>
      </div>
      <p style={styles.meta}><a href="/">← home</a></p>
    </main>
  );
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center" as const },
  title: { fontSize: 24, marginBottom: 8 },
  meta: { color: "#666", fontSize: 14, lineHeight: 1.5, marginBottom: 32 },
  count: { fontSize: 96, fontWeight: 700, margin: "24px 0" },
  buttons: { display: "flex", gap: 12, justifyContent: "center" },
  button: { padding: "10px 20px", fontSize: 18, borderRadius: 6, border: "1px solid #ccc", background: "#f7f7f7", cursor: "pointer" },
};
`;
}

function homeApp(): string {
  // The root home page (agents/app.tsx), served at "/". Demonstrates the
  // root UI talking to an agent through its generated typed hook — exactly
  // how any page composes agents.
  return `import { useAgent } from "@ayjnt/counter";

export default function Home() {
  const counter = useAgent();
  const count = counter.state?.count ?? 0;

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Welcome to ayjnt 👋</h1>
      <p style={styles.lede}>
        This page is <code>agents/app.tsx</code> — your root UI, served at
        <code> /</code>. It can talk to any agent through its typed hook.
      </p>
      <p style={styles.meta}>
        the counter's <code>default</code> instance is at{" "}
        <strong style={styles.count}>{count}</strong>
      </p>
      <a style={styles.link} href="/counter">open the counter →</a>
    </main>
  );
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 540, margin: "80px auto", padding: 24, textAlign: "center" as const },
  title: { fontSize: 32, marginBottom: 16 },
  lede: { color: "#444", fontSize: 16, lineHeight: 1.6 },
  meta: { color: "#666", fontSize: 16, lineHeight: 1.6, margin: "32px 0" },
  count: { fontSize: 22 },
  link: { fontSize: 16, color: "#2563eb", textDecoration: "none" },
};
`;
}
