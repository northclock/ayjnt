import { dev } from "./dev.ts";
import { build } from "./build.ts";
import { compile } from "./compile.ts";
import { deploy } from "./deploy.ts";
import { migrate } from "./migrate.ts";
import { newCmd } from "./new.ts";
// Aliased: this module's own dispatcher is called `run`.
import { run as runCmd } from "./run.ts";

const USAGE = `\
ayjnt <command> [options]

Commands:
  new <dir>        Scaffold a new ayjnt project (UI included; --empty for none)
  dev              Start a local development server (wraps wrangler dev)
  run              Run the app locally on its own runtime, including cli.ts
  build            Generate config + bundle, no deploy
  compile          Build a self-contained single-file executable
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
  run: `\
ayjnt run [options] [-- <args for cli.ts>]

Run the app on ayjnt's own local runtime — the same code path a binary from
\`ayjnt compile\` uses. Codegen, bundle with wrangler, boot workerd, then invoke
your root-level cli.ts in the foreground. When cli.ts returns (or you Ctrl-C),
everything stops, workerd included. With no cli.ts, serves until interrupted.

Unlike \`ayjnt dev\`, this owns the runtime, which is what lets cli.ts talk to
agents and workflows in-process instead of over HTTP.

Options:
  --cwd <path>            Project root (default: process.cwd())
  --port <n>              Port to bind (default: 8787; 0 picks a free one)
  --data-dir <path>       Override where Durable Object state is persisted
  --allow-host-writes     Permit host tools declaring sideEffects: "write"
  --allow-host-exec       Permit host tools declaring sideEffects: "exec"
  -h, --help              Show this help

Arguments after \`--\` are passed to cli.ts as \`argv\`.`,
  compile: `\
ayjnt compile [options]

Build a self-contained executable: your agents, their UIs, cli.ts, the Bun
runtime, and workerd, in one file (~170MB). The result needs no Bun, no
node_modules, and no wrangler.

Host tools (agents/<route>/tools.host.ts) work here and only here — a deployed
Cloudflare worker has no host process to run them on.

Options:
  --cwd <path>            Project root (default: process.cwd())
  --outfile <path>        Output path (default: ./<worker-name>)
  --target <target>       Bun compile target, e.g. bun-linux-x64
  --no-embed-workerd      Don't embed workerd (~67MB binary; needs a local one)
  --bytecode              Precompile to bytecode for faster startup
  --minify                Minify the embedded JavaScript
  -h, --help              Show this help

The compiled binary accepts --port, --data-dir, --allow-host-writes and
--allow-host-exec. Everything else it receives goes to your cli.ts as argv.`,
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
    case "run":
      return runCmd(rest);
    case "build":
      return build(rest);
    case "compile":
      return compile(rest);
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
