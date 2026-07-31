// Host-side tools. These run in the Bun process, NOT in workerd.
//
// The `.host.ts` suffix is the whole declaration — there is no directive to
// write. The agent calls these exactly like any other tool; the framework
// proxies each call out of workerd to this process over a service binding, runs
// the function here, and hands the JSON result back.
//
// That's what buys access to `Bun.$`, `Bun.file`, `bun:sqlite` and node APIs —
// none of which exist inside the Workers runtime.
//
// TWO THINGS TO INTERNALIZE:
//
// 1. These CANNOT be deployed. `ayjnt deploy` refuses a project containing this
//    file, because a Cloudflare worker has no host process to proxy to. Ship
//    with `ayjnt compile` (or run with `ayjnt run`) instead.
//
// 2. The arguments come from MODEL OUTPUT. If the agent ever reads untrusted
//    content — an inbound email, a retrieved document, a fetched page — then
//    attacker-controlled text can reach these functions. That's why every tool
//    declares `sideEffects`, and why `readProjectFile` confines its path instead
//    of trusting what it was handed.

import { confinePath, hostTool } from "ayjnt/tools";
import { z } from "zod";

/** Files are only ever read from the directory the app was started in. */
const ROOT = process.cwd();

/**
 * Read a file from the project directory.
 *
 * `sideEffects: "read"` so it runs without a prompt.
 *
 * Note `confinePath`: a model asking for `../../.ssh/id_rsa` gets an error, not
 * a key. A `startsWith` check on the raw string would not be enough — `..`
 * segments have to be resolved before comparing, which is exactly what the
 * helper does.
 */
export const readProjectFile = hostTool({
  description:
    "Read a UTF-8 text file from the project directory. Paths are relative to where the app was started.",
  sideEffects: "read",
  inputSchema: z.object({
    path: z.string().describe("Path relative to the project directory."),
  }),
  execute: async ({ path }: { path: string }) => {
    const safe = confinePath(ROOT, path);
    const file = Bun.file(safe);
    if (!(await file.exists())) throw new Error(`no such file: ${path}`);
    return { path, text: await file.text() };
  },
});

/**
 * List the files in the project directory.
 *
 * Uses `Bun.$`, which is impossible in workerd — this is the reason the file
 * carries the `.host.ts` suffix.
 */
export const listProjectFiles = hostTool({
  description: "List the files in the project directory.",
  sideEffects: "read",
  inputSchema: z.object({}),
  execute: async () => {
    const out = await Bun.$`ls -1`.cwd(ROOT).text();
    return { files: out.trim().split("\n").filter(Boolean) };
  },
});

/**
 * Write a note to a local file.
 *
 * `sideEffects: "write"` means this is refused unless the app was started with
 * `--allow-host-writes` (or `AYJNT_ALLOW_HOST_EFFECTS=write`), or the user
 * approves it interactively. The gate exists because the filename is chosen by
 * the model.
 */
export const appendToLog = hostTool({
  description: "Append a line to notes.log in the project directory.",
  sideEffects: "write",
  inputSchema: z.object({ line: z.string() }),
  execute: async ({ line }: { line: string }) => {
    const target = confinePath(ROOT, "notes.log");
    const existing = (await Bun.file(target).exists())
      ? await Bun.file(target).text()
      : "";
    await Bun.write(target, `${existing}${line}\n`);
    return { appended: line, file: "notes.log" };
  },
});
