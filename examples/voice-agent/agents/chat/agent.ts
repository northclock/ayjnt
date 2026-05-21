import { Agent } from "agents";
import {
  withVoice,
  WorkersAIFluxSTT,
  WorkersAITTS,
} from "@cloudflare/voice";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { turns: number };

/**
 * ChatVoice — a voice-conversational agent built with the `withVoice`
 * mixin from `@cloudflare/voice`.
 *
 * Detection: ayjnt's scan picks up the `withVoice(` source-level token
 * and marks this agent as a voice agent. That triggers two pieces of
 * codegen:
 *
 *   1. `wrangler.jsonc` gets the `ai: { binding: "AI" }` binding so
 *      `WorkersAIFluxSTT` (STT) and `WorkersAITTS` (TTS) resolve at
 *      runtime via `this.env.AI`.
 *
 *   2. The generated typed hook at `.ayjnt/client/<route>/index.tsx`
 *      switches to `useVoiceAgent` (from `ayjnt/voice/client`) instead
 *      of `useAgent` — with the class name and route prefix pre-bound,
 *      and a custom transport that connects via the ayjnt URL shape
 *      (`/<route>/<instance>`) rather than the SDK's default
 *      `/agents/<kebab>/<name>` path.
 *
 * The base class change is the only opt-in. Co-located app.tsx
 * continues to work the same way as for non-voice agents.
 */
export default class ChatVoice extends withVoice(Agent)<GeneratedEnv, State> {
  override initialState: State = { turns: 0 };

  // Workers AI built-in STT (continuous, with EOT detection) and TTS.
  // Both pull off this.env.AI which ayjnt has bound automatically.
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);

  /**
   * Called every time the user finishes a turn. Return a string and
   * the framework sends it through TTS back to the user.
   */
  async onTurn(transcript: string): Promise<string> {
    this.setState({ turns: this.state.turns + 1 });
    return `You said: "${transcript}". This is turn ${this.state.turns + 1}.`;
  }

  // HTTP fallback — useful for debugging conversation history without
  // running the voice pipeline.
  override async onRequest(): Promise<Response> {
    return Response.json({
      instance: this.name,
      turns: this.state.turns,
    });
  }
}
