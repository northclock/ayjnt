# examples

Reference projects that exercise the framework end-to-end. Each is a standalone Bun project installed via a `file:../..` link to the `ayjnt` package, so local changes to the framework are immediately reflected.

| Example | Status | What it demonstrates |
|---|---|---|
| [`basic`](./basic) | v0.1 | One `ChatAgent`, no UI, no middleware. Smallest possible ayjnt project. |
| [`with-client`](./with-client) | v0.1 | Connecting from the Agents client SDK using `basePath`. Explains the `path` vs `basePath` gotcha and the server-side `getAgentByName` requirement. |
| *(planned)* `middleware` | v0.2 | Nested `middleware.ts`, route groups, auth. |
| *(planned)* `inter-agent` | v0.2 | Multiple agents, `getAgent()` typed RPC. |
| *(planned)* `with-ui` | v0.3 | Co-located `app.tsx`, generated `useAgent()` hook. |
| *(planned)* `mcp` | v0.4 | MCP App — `McpAgent` + UI for the iframe. |

## Running an example

```sh
cd examples/basic
bun install
bun run build
bun run dev       # requires `wrangler login`
```

## Adding a new example

1. `mkdir examples/<name>` and `cd examples/<name>`
2. `bun init -y`
3. In `package.json`:
   - `"dependencies"`: `"agents": "*"` (plus anything domain-specific)
   - `"devDependencies"`: `"ayjnt": "file:../.."`, `"wrangler": "^4"`, `"@cloudflare/workers-types": "latest"`
   - `"scripts"`: `"dev"`, `"build"`, `"deploy"`, `"migrate"` each calling `ayjnt`
4. `bun install`
5. Write `agents/<name>/agent.ts`
6. Add a `README.md` explaining what the example proves and how to run it
7. Add a `.gitignore` covering `node_modules`, `.ayjnt/dist`, `.ayjnt/manifest.json`, `.wrangler`, `.env*`
8. Add an entry to the table above
