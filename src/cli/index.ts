import { dev } from "./dev.ts";
import { build } from "./build.ts";
import { deploy } from "./deploy.ts";
import { migrate } from "./migrate.ts";
import { newCmd } from "./new.ts";

const USAGE = `\
ayjnt <command> [options]

Commands:
  new <dir>        Scaffold a new ayjnt project (--with-ui for a React starter)
  dev              Start a local development server (wraps wrangler dev)
  build            Generate config + bundle, no deploy
  deploy           Build and deploy to Cloudflare (wraps wrangler deploy)
  migrate          Preview pending migrations from file tree vs lockfile

Global options:
  -h, --help       Show this help
  --cwd <path>     Project root (default: process.cwd())

Run 'ayjnt <command> --help' for command-specific options.`;

export async function run(args: string[]): Promise<void> {
  const [command, ...rest] = args;

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
