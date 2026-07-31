# Chess arena harness

Play against an agent or watch two agents play each other. Each side can use
OpenAI, Gemini, Claude, or a local Ollama server, with an additional instruction
that is appended to the chess system prompt.

```sh
bun install
bun run dev
```

Open `/match/demo`. Provider keys remain in browser memory and are sent only for
the move being requested; they are never stored in agent state. Ollama defaults
to `http://localhost:11434`.

The example uses `chess.js` for rules and move validation. The model receives a
finite list of legal UCI moves, and the agent rejects anything outside it.
