# Coding harness

A small coding agent that makes both human surfaces first-class:

- `cli.ts` is a full-screen OpenTUI coding session.
- `agents/app.tsx` lists sessions and aggregate token usage in the browser.
- `/ayjnt-code/:session-id` shows the complete transcript for one session.
- `tools.host.ts` gives the isolated agent explicit, permission-gated access to
  the current repository.

```sh
cp .dev.vars.example .dev.vars
bun install
bun run start
```

Open `http://localhost:8787` in parallel to inspect sessions. Host paths are
confined to the directory where the harness was started. Writes and shell
execution require the explicit flags in the `start` script.
