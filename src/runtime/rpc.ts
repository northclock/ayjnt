// Typed inter-agent RPC — v0.2
//
// User-facing API:
//
//   import { getAgent } from "ayjnt/rpc";
//   const chat = getAgent(env, "chat", userId);
//   await chat.sendMessage("hello");   // fully typed, backed by DO stub
//
// Implementation uses the DO binding directly (env.CHAT_AGENT.get(id)) and
// forwards method calls via a JSON-RPC-ish contract over stub.fetch. Types
// come from a generated .d.ts that reflects the exported agent classes.
export {};
