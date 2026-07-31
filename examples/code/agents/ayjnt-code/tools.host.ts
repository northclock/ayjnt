import { z } from "zod";
import { confinePath, hostTool } from "ayjnt/tools";

const ROOT = process.cwd();

export const listFiles = hostTool({
  description: "List tracked and untracked project files.",
  sideEffects: "read",
  inputSchema: z.object({ query: z.string().optional() }),
  execute: async ({ query }: { query?: string }) => {
    const files = await Bun.$`git ls-files --cached --others --exclude-standard`
      .cwd(ROOT)
      .quiet()
      .text();
    return files
      .trim()
      .split("\n")
      .filter((file) => !query || file.includes(query))
      .slice(0, 500);
  },
});

export const readFile = hostTool({
  description: "Read a UTF-8 project file. Paths cannot escape the project.",
  sideEffects: "read",
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ path }: { path: string }) =>
    Bun.file(confinePath(ROOT, path)).text(),
});

export const writeFile = hostTool({
  description: "Write a UTF-8 project file. Explain the change before calling.",
  sideEffects: "write",
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path, content }: { path: string; content: string }) => {
    const target = confinePath(ROOT, path);
    await Bun.write(target, content);
    return { path, bytes: Buffer.byteLength(content) };
  },
});

export const runCommand = hostTool({
  description:
    "Run a command in the project. Prefer read-only checks; never use destructive commands.",
  sideEffects: "exec",
  inputSchema: z.object({ command: z.array(z.string()).min(1) }),
  execute: async ({ command }: { command: string[] }) => {
    const result = Bun.spawnSync(command, { cwd: ROOT });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().slice(0, 20_000),
      stderr: result.stderr.toString().slice(0, 20_000),
    };
  },
});
