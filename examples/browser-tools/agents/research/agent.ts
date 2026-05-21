import { Agent, callable } from "agents";
import { browserTools } from "ayjnt/browser";
import type { GeneratedEnv } from "@ayjnt/env";

type State = {
  investigations: { id: string; question: string; tools: string[]; at: number }[];
};

/**
 * ResearchAgent — exercises Cloudflare's Browser Rendering tools via the
 * `ayjnt/browser` zero-config wrapper.
 *
 * The single `import { browserTools } from "ayjnt/browser"` above is the
 * only thing the framework needs to wire up four pieces of wrangler
 * config:
 *
 *   - `browser: { binding: "BROWSER" }`        — Browser Rendering binding
 *   - `worker_loaders: [{ binding: "LOADER" }]` — sandboxed CDP execution
 *   - `ai: { binding: "AI" }`                   — model for the tool calls
 *   - `compatibility_flags: ["nodejs_compat"]`  — Loader runtime requirement
 *
 * Forget any of those and the runtime crashes in awkward ways. ayjnt's
 * `bun run dev` regenerates `wrangler.jsonc` with all four present the
 * moment this import lands.
 *
 * At runtime, `browserTools(this)` reads `this.env.BROWSER` and
 * `this.env.LOADER` off the agent instance and returns the AI-SDK
 * `ToolSet` shape Cloudflare's `createBrowserTools` produces. Spread it
 * straight into `generateText({ tools: ... })` / `streamText`.
 *
 * Usage shape (from the agents SDK docs):
 *
 *   import { generateText } from "ai";
 *   import { createWorkersAI } from "workers-ai-provider";
 *
 *   const workersAI = createWorkersAI({ binding: this.env.AI });
 *   const tools = browserTools(this);
 *   const result = await generateText({
 *     model: workersAI("@cf/zai-org/glm-4.7-flash"),
 *     tools,
 *     prompt: question,
 *   });
 *
 * For this example we keep the surface tiny and just return the tools
 * count so the smoke test doesn't pull in a full LLM provider.
 */
export default class ResearchAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { investigations: [] };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ instance: this.name, ...this.state });
    }

    const { question } = (await request.json()) as { question: string };
    const result = await this.investigate(question);
    return Response.json(result);
  }

  /**
   * Kick off a browser-tools investigation.
   *
   * Browser-callable via `agent.call("investigate", [question])` from
   * the co-located UI. Returns the registered tool names so the smoke
   * test stays model-agnostic; wire `generateText({ tools, ... })`
   * here for a real LLM loop.
   */
  @callable({ description: "Run a research query against the browser tools." })
  async investigate(question: string): Promise<{
    question: string;
    registered_tools: string[];
    hint: string;
  }> {
    // browserTools(this) returns the AI-SDK ToolSet. In a real agent
    // you'd pass it to `generateText({ tools, ... })`. We just record
    // the registered tool names here so the example stays
    // model-agnostic.
    const tools = browserTools(this);
    const toolNames = Object.keys(tools);

    this.setState({
      investigations: [
        ...this.state.investigations,
        { id: crypto.randomUUID(), question, tools: toolNames, at: Date.now() },
      ],
    });

    return {
      question,
      registered_tools: toolNames,
      hint: "Wire this up to generateText() with a Workers AI model — see this file's JSDoc.",
    };
  }
}
