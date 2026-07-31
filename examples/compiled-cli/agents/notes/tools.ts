// Workerd-side tools. These run inside the Workers runtime, right next to the
// agent, and deploy to Cloudflare like any other worker code.
//
// The rule of thumb: if a tool only needs the agent's own state, the network, or
// plain computation, it belongs here. Reach for `tools.host.ts` only when a tool
// genuinely needs the local machine.
//
// The framework checks this file for Bun-only globals at build time. Writing
// `Bun.file(...)` here fails the build with a pointer to `tools.host.ts`, rather
// than compiling fine and then throwing `Bun is not defined` inside workerd on
// the first tool call.

import { tool } from "ai";
import { z } from "zod";

/**
 * Summarize the notes currently in state.
 *
 * Pure computation over data the agent already holds — no reason for this to
 * leave workerd.
 */
export const summarizeNotes = tool({
  description:
    "Summarize the notes stored on this agent: how many there are, and where they came from.",
  inputSchema: z.object({}),
  execute: async () => {
    // `tool()` executes with the agent as `this` is NOT guaranteed, so tools
    // that need agent state take it as input or live on the agent. Here we
    // deliberately keep the tool self-contained and let the agent pass state in
    // via `runTool`, which keeps this file trivially unit-testable.
    return { note: "Use listNotes() for the data; this tool exists to show a workerd-side tool." };
  },
});

/**
 * Count words in a string.
 *
 * The kind of small deterministic helper that is much cheaper as a tool call
 * than as a round trip to a model.
 */
export const countWords = tool({
  description: "Count the words in a piece of text.",
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => ({
    words: text.trim().split(/\s+/).filter(Boolean).length,
    characters: text.length,
  }),
});
