import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Role = "user" | "assistant" | "system";
type Message = { id: string; role: Role; text: string; at: number };

type State = {
  messages: Message[];
  /** True while a response is being streamed. UI uses this to disable input. */
  streaming: boolean;
  /** id of the message currently being filled in. */
  streamingId: string | null;
};

const SYSTEM_PROMPT =
  "You are a concise, friendly assistant. Keep replies under 6 sentences " +
  "unless the user explicitly asks for more detail.";

/** Gemini REST shape — kept inline so we don't need an extra dep. */
type GeminiPart = { text: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type GeminiStreamChunk = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
};

/**
 * A streaming chatbot backed by Google Gemini. The DO holds the full
 * conversation; the UI subscribes to state and renders incrementally as
 * `setState` ticks every chunk. No HTTP streaming primitives needed —
 * the realtime feel comes from state-sync, not SSE.
 *
 *   POST /chat/:id  { text }   → user message + start streaming reply
 *   DELETE /chat/:id           → wipe history
 *
 * Requires GOOGLE_API_KEY in .dev.vars / wrangler secrets. If missing
 * the agent falls back to a stub reply so you can see the UI work
 * without leaving the framework demo path.
 */
export default class ChatAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    messages: [],
    streaming: false,
    streamingId: null,
  };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      this.setState({ messages: [], streaming: false, streamingId: null });
      return Response.json({ ok: true, cleared: true });
    }

    if (request.method !== "POST") {
      return Response.json({ instance: this.name, ...this.state });
    }

    const { text } = (await request.json()) as { text: string };
    if (!text?.trim()) {
      return Response.json({ ok: false, error: "empty message" }, { status: 400 });
    }

    // Append the user message first so the UI shows it instantly.
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      at: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      text: "",
      at: Date.now(),
    };

    this.setState({
      messages: [...this.state.messages, userMsg, assistantMsg],
      streaming: true,
      streamingId: assistantId,
    });

    // Run streaming generation in the background — the request returns now,
    // and the client watches state for the assistant message to fill in.
    // ctx.waitUntil keeps the worker alive until completion.
    this.ctx.waitUntil(this.streamReply(assistantId));

    return Response.json({
      ok: true,
      userMsgId: userMsg.id,
      assistantMsgId: assistantId,
    });
  }

  /** Stream the assistant reply chunk by chunk into state. */
  private async streamReply(assistantId: string): Promise<void> {
    const apiKey = this.env.GOOGLE_API_KEY as string | undefined;

    try {
      if (!apiKey) {
        await this.fallbackStub(assistantId);
        return;
      }
      await this.streamFromGemini(assistantId, apiKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendToAssistant(assistantId, `\n\n[error: ${message}]`);
    } finally {
      this.setState({
        ...this.state,
        streaming: false,
        streamingId: null,
      });
    }
  }

  /** Hit Gemini's streamGenerateContent and append each chunk to state. */
  private async streamFromGemini(
    assistantId: string,
    apiKey: string,
  ): Promise<void> {
    const history: GeminiContent[] = this.state.messages
      .filter((m) => m.id !== assistantId && m.role !== "system")
      .map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.text }],
      }));

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      "gemini-2.0-flash:streamGenerateContent?alt=sse&key=" +
      encodeURIComponent(apiKey);

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: history,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text();
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
    }

    // SSE stream: lines starting with "data: " contain JSON chunks.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const chunk = JSON.parse(payload) as GeminiStreamChunk;
          const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) this.appendToAssistant(assistantId, text);
        } catch {
          // Skip malformed lines — partial JSON across chunk boundaries
          // is handled by the line-buffer.
        }
      }
    }
  }

  /** Slow stub when no API key — useful for UI development. */
  private async fallbackStub(assistantId: string): Promise<void> {
    const reply =
      "(no GOOGLE_API_KEY set, using fallback) — the agent received your " +
      "message and would normally stream a Gemini response back into state.";
    for (const word of reply.split(" ")) {
      this.appendToAssistant(assistantId, word + " ");
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  /** Append text to the in-flight assistant message immutably. */
  private appendToAssistant(assistantId: string, chunk: string): void {
    this.setState({
      ...this.state,
      messages: this.state.messages.map((m) =>
        m.id === assistantId ? { ...m, text: m.text + chunk } : m,
      ),
    });
  }
}
