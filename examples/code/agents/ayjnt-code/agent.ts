import { Agent, callable } from "ayjnt";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { agentTools } from "ayjnt/tools";
import SessionsAgent from "../sessions/agent.ts";

declare global {
  namespace Ayjnt {
    interface GeneratedEnv {
      OPENAI_API_KEY: string;
    }
  }
}

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
};

type State = {
  title: string;
  turns: Turn[];
  inputTokens: number;
  outputTokens: number;
  running: boolean;
};

export default class CodeAgent extends Agent<State> {
  override initialState: State = {
    title: "New coding session",
    turns: [],
    inputTokens: 0,
    outputTokens: 0,
    running: false,
  };

  @callable({ description: "Give the coding agent its next task." })
  async run(prompt: string): Promise<string> {
    const clean = prompt.trim();
    if (!clean || this.state.running) return "";

    const user: Turn = {
      id: crypto.randomUUID(),
      role: "user",
      text: clean,
      at: Date.now(),
    };
    this.setState({
      ...this.state,
      title:
        this.state.turns.length === 0 ? clean.slice(0, 54) : this.state.title,
      turns: [...this.state.turns, user],
      running: true,
    });

    try {
      const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });
      const messages: ModelMessage[] = this.state.turns.map((turn) => ({
        role: turn.role,
        content: turn.text,
      }));
      const result = await generateText({
        model: openai("gpt-5-mini"),
        system:
          "You are a careful coding agent. Inspect before editing, keep changes scoped, run relevant checks, and explain the outcome plainly.",
        messages,
        tools: agentTools(this),
        stopWhen: stepCountIs(12),
      });
      const assistant: Turn = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.text || "The task completed without a text response.",
        at: Date.now(),
      };
      this.setState({
        ...this.state,
        turns: [...this.state.turns, assistant],
        inputTokens:
          this.state.inputTokens + (result.usage.inputTokens ?? 0),
        outputTokens:
          this.state.outputTokens + (result.usage.outputTokens ?? 0),
        running: false,
      });
      await this.publishSummary();
      return assistant.text;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.setState({
        ...this.state,
        turns: [
          ...this.state.turns,
          { id: crypto.randomUUID(), role: "assistant", text, at: Date.now() },
        ],
        running: false,
      });
      await this.publishSummary();
      return text;
    }
  }

  private async publishSummary(): Promise<void> {
    const registry = await this.agent(SessionsAgent, "default");
    await registry.upsert({
      id: this.name,
      title: this.state.title,
      updatedAt: Date.now(),
      inputTokens: this.state.inputTokens,
      outputTokens: this.state.outputTokens,
      turns: this.state.turns.length,
    });
  }
}
