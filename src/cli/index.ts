import { dev } from "./dev.ts";
import { build } from "./build.ts";
import { deploy } from "./deploy.ts";
import { migrate } from "./migrate.ts";
import { newCmd } from "./new.ts";

const USAGE = `\
ayjnt <command> [options]

Commands:
  new <dir>        Scaffold a new ayjnt project (UI included; --empty for none)
  dev              Start a local development server (wraps wrangler dev)
  build            Generate config + bundle, no deploy
  deploy           Build and deploy to Cloudflare (wraps wrangler deploy)
  migrate          Preview pending migrations from file tree vs lockfile

Global options:
  -h, --help       Show this help
  --cwd <path>     Project root (default: process.cwd())

Run 'ayjnt <command> --help' for command-specific options.`;

// Per-command help. Checked BEFORE dispatch — `ayjnt build --help` must
// print help, not run a full build (and `ayjnt deploy --help` must not run
// git preflight checks). `new` renders its own usage.
const COMMAND_HELP: Record<string, string> = {
  dev: `\
ayjnt dev [options]

Run codegen, then start \`wrangler dev\` on the generated config. Watches
agents/ (plus root middleware.ts/email.ts and workflows/) and re-runs
codegen on changes.

Options:
  --cwd <path>     Project root (default: process.cwd())
  -h, --help       Show this help

Unrecognized flags are forwarded to wrangler (e.g. --port 8788).`,
  build: `\
ayjnt build [options]

Pure codegen: writes .ayjnt/ (wrangler config, worker entry, typed hooks,
env types, bundled UIs) and stages any pending migration in
.ayjnt/migrations.json. Nothing is deployed.

Options:
  --cwd <path>     Project root (default: process.cwd())
  -h, --help       Show this help`,
  deploy: `\
ayjnt deploy [options]

Git-safety checks (clean tree, in sync with origin, migrations committed),
rebuild, then \`wrangler deploy\`.

Options:
  --cwd <path>     Project root (default: process.cwd())
  --force          Skip the git-safety checks (risks divergent migrations)
  -h, --help       Show this help

Unrecognized flags are forwarded to wrangler.`,
  migrate: `\
ayjnt migrate [options]

Preview the migration a build would stage, without writing anything.

Options:
  --cwd <path>     Project root (default: process.cwd())
  -h, --help       Show this help`,
};

export async function run(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  // Only look at args before the `--` separator — everything after it is
  // documented as verbatim wrangler passthrough, so `ayjnt dev -- --help`
  // must reach wrangler, not print our help.
  const sepIdx = rest.indexOf("--");
  const ownArgs = sepIdx >= 0 ? rest.slice(0, sepIdx) : rest;
  const help = command && COMMAND_HELP[command];
  if (help && (ownArgs.includes("-h") || ownArgs.includes("--help"))) {
    console.log(help);
    return;
  }

  switch (command) {
    case "new":
      return newCmd(rest);
    case "dev":
      return dev(rest);
    case "build":
      return build(rest);
    case "deploy":
      return deploy(rest);
    case "migrate":
      return migrate(rest);
    case "-h":
    case "--help":
    case undefined:
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}
