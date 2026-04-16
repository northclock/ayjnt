// ayjnt new — scaffold a new project with a starter agent.
//
//   ayjnt new my-app              → blank starter (one "alive" agent, no UI)
//   ayjnt new my-app --with-ui    → counter agent with co-located app.tsx
//
// The default ("blank") is deliberately the smallest thing that proves the
// pipeline works: one agent that responds "I'm alive" to any request. Every
// example in /examples assumes you start from this scaffold, then replace
// the alive/ folder with whatever the example demonstrates.
//
// Inlines all template files as string constants so we don't need to ship
// a templates/ directory on npm (and worry about file path resolution
// inside the published package).

import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";

const USAGE = `\
ayjnt new <directory> [options]

Scaffold a new ayjnt project.

Options:
  --with-ui         Include a React UI using the co-located app.tsx pattern.
                    Without this flag, scaffolds a blank starter project
                    with a single "I'm alive" agent.
  -h, --help        Show this help.

Next steps after scaffolding:
  cd <directory>
  bun install
  bun run dev
`;

type Template = "blank" | "with-ui";

export async function newCmd(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    return;
  }

  const withUi = argv.includes("--with-ui");
  const positional = argv.filter(
    (a) => !a.startsWith("--") && !a.startsWith("-"),
  );
  const targetDir = positional[0];

  if (!targetDir) {
    console.error("error: missing <directory>\n");
    console.error(USAGE);
    process.exit(1);
  }

  const target = path.resolve(targetDir);
  if (existsSync(target)) {
    throw new Error(
      `${targetDir} already exists — pick a new directory or remove the existing one.`,
    );
  }

  const template: Template = withUi ? "with-ui" : "blank";
  const projectName = sanitizePackageName(path.basename(target));

  await scaffold(target, projectName, template);

  console.log(`\n✓ scaffolded ${targetDir}/ (${template})\n`);
  console.log(`  cd ${targetDir}`);
  console.log(`  bun install`);
  console.log(`  bun run dev\n`);
  if (template === "with-ui") {
    console.log(`  then open http://localhost:8787/counter/demo in a browser`);
    console.log(`  (open two tabs to see state sync)\n`);
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

  if (template === "blank") {
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
  }
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
    agents: "^0.10",
  };
  const devDeps: Record<string, string> = {
    "@types/bun": "latest",
    "@cloudflare/workers-types": "latest",
    ayjnt: "^0.1",
    wrangler: "^4",
  };

  if (template === "with-ui") {
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
    lib:
      template === "with-ui"
        ? ["ESNext", "DOM", "DOM.Iterable"]
        : ["ESNext"],
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
  if (template === "with-ui") {
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
    template === "with-ui"
      ? `## Your first agent

\`agents/counter/agent.ts\` is a CounterAgent with persistent state. \`agents/counter/app.tsx\` is a React UI that connects to it live.

Open http://localhost:8787/counter/demo in two browser tabs — the \`+\` button in one tab updates the other.

Each path segment after \`/counter/\` is a separate Durable Object instance with its own state: \`/counter/room-1\` and \`/counter/room-2\` are independent.
`
      : `## Your blank starter

\`agents/alive/agent.ts\` is a minimal agent that responds with \`{ "status": "alive", "instance": "<id>" }\` to any request. It exists to prove the pipeline works before you replace it with something interesting.

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

Drop an \`app.tsx\` next to \`agent.ts\`:

\`\`\`tsx
// agents/alive/app.tsx
import { createRoot } from "react-dom/client";
import { useAgent } from "@ayjnt/alive";

function App() {
  const agent = useAgent();
  return <div>agent {agent.name}: {JSON.stringify(agent.state)}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
\`\`\`

Add \`react\`, \`react-dom\`, and their types to \`package.json\`, run \`bun install\`, then \`bun run dev\`. Visit http://localhost:8787/alive/hello in a browser.
`;
  return `# ${name}

An ayjnt project. [Docs](https://github.com/anthropic-experimental/ayjnt).

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
`;
}

/**
 * The blank starter: one agent that returns "I'm alive" on every request.
 * Intentionally empty state, no methods — just the minimum needed to prove
 * routing, DO binding, and state wiring all work. Every example in /examples
 * starts from this scaffold and replaces agents/alive with its own agents.
 */
function blankAgent(): string {
  return `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

/**
 * Blank starter agent. Responds with "I'm alive" to any request on any
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
  return `import { createRoot } from "react-dom/client";
import { useAgent } from "@ayjnt/counter";

function Counter() {
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

const root = document.getElementById("root");
if (root) createRoot(root).render(<Counter />);
`;
}
