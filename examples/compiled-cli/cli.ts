// A root-level cli.ts turns this project into a runnable program.
//
// `ayjnt run` (and a binary from `ayjnt compile`) boots the worker under a local
// workerd, then calls this function in the foreground. When it returns,
// everything shuts down — workerd included.
//
// Two things worth noticing:
//
//   1. `agents.notes("default")` is a real Durable Object stub. Method calls go
//      straight into workerd as RPC — no HTTP, no port, no client handshake, no
//      URL to construct. That works because this file runs in the same process
//      that owns the runtime.
//
//   2. This file runs in BUN, while the agent runs in WORKERD. So `Bun.$`,
//      `Bun.file` and `bun:sqlite` all work here, and none of them work in
//      agent.ts. That asymmetry is the reason to compile an ayjnt app at all.

import type { AyjntCli } from "@ayjnt/cli";

export default async function ({ agents, argv, url }: AyjntCli) {
  const notes = agents.notes("default");
  const [command, ...rest] = argv;

  switch (command) {
    case "add": {
      const text = rest.join(" ");
      if (!text) return usage("add needs some text");
      const note = await notes.addNote(text, "cli");
      console.log(`added ${note.id}`);
      return;
    }

    case "import": {
      // Bun-native work feeding straight into agent state: read a local file
      // here in Bun, store it in a Durable Object over there in workerd.
      const file = rest[0];
      if (!file) return usage("import needs a file path");
      const text = await Bun.file(file).text();
      for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
        await notes.addNote(line, file);
      }
      console.log(`imported from ${file}`);
      return;
    }

    case "list": {
      const all = await notes.listNotes();
      if (all.length === 0) {
        console.log("no notes yet — try `add hello world`");
        return;
      }
      for (const n of all) {
        console.log(`• ${n.text}  (${n.source})`);
      }
      return;
    }

    case "clear":
      console.log(`cleared ${await notes.clearNotes()} note(s)`);
      return;

    case "tools": {
      // Differs by how you're running: compiled or under `ayjnt run` the host
      // tools are here too. Deployed to Cloudflare, only the workerd ones are.
      console.log((await notes.toolNames()).join("\n"));
      return;
    }

    case "tool": {
      const name = rest[0];
      if (!name) return usage("tool needs a tool name");
      const input = rest[1] ? JSON.parse(rest[1]) : {};
      const outcome = await notes.runTool(name, input);
      if (!outcome.ok) {
        console.error(`tool failed: ${outcome.error}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(outcome.result, null, 2));
      return;
    }

    case "watch": {
      // The one thing that isn't a plain RPC: state pushes arrive over the
      // agent's WebSocket protocol, so `watch` opens a connection to the bound
      // port. Ctrl-C to stop.
      console.log(`watching notes for changes — ${url}`);
      await notes.watch((state) => {
        console.log(`[state] ${state.notes.length} note(s)`);
      });
      // Returning here would tear the runtime down, so wait for a signal.
      await new Promise(() => {});
      return;
    }

    default:
      return usage();
  }
}

function usage(problem?: string): void {
  if (problem) console.error(`error: ${problem}\n`);
  console.log(`\
notes — an ayjnt app with agents, tools, and a CLI in one binary

  notes add <text...>        Store a note
  notes import <file>        Import one note per line from a local file
  notes list                 Print every note
  notes clear                Delete every note
  notes tools                List the tools the model can call
  notes tool <name> [json]   Run one tool directly
  notes watch                Stream live state changes

Host tools that write need permission:

  notes --allow-host-writes tool appendToLog '{"line":"hi"}'`);
}
