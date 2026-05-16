// External client for the NotesAgent using the Cloudflare Agents SDK's
// `AgentClient` — the WebSocket-based class. Same `@callable()` methods
// the React UI in `app.tsx` invokes, called from a standalone Bun script.
//
// Two transports are exposed by `agents/client`:
//
//   - `agentFetch(opts, init)` — request/response over HTTP. Hits
//     `onRequest` on the agent. Use when you want one-shot reads/writes
//     and don't need state pushes or `@callable()` methods.
//
//   - `new AgentClient(opts)` — WebSocket connection. Carries:
//       • typed `@callable()` invocations via `client.stub.method()` /
//         `client.call("method", [args])`
//       • live state pushes via the `state` field + `onStateUpdate` cb
//       • identity from `getAgentByName` via `client.name`
//     Use this for anything that needs RPC or live sync.
//
// This file uses `AgentClient` because the whole point of the example is
// to call `@callable` methods.
//
// Run with the dev server up (`bun run dev` in another terminal):
//
//   bun run client.ts
//   HOST=https://my-app.workers.dev INSTANCE=team-a bun run client.ts
//
// Set HOST + INSTANCE via env to point at a deployed worker or a
// non-default instance.

import { AgentClient } from "agents/client";
import type NotesAgent from "./agents/notes/agent.ts";

const rawHost = process.env["HOST"] ?? "http://localhost:8787";
const instance = process.env["INSTANCE"] ?? "default";

// The SDK builds the WebSocket URL from `host` + `basePath`. It accepts a
// bare `localhost:8787` (no scheme) and converts http://→ws://, but
// pass an `http(s)://` prefix so the conversion is unambiguous against
// any deployed worker URL.
const host = rawHost.replace(/^https?:\/\//, "");

// AgentClient<NotesAgent> binds the stub against the agent class:
// `client.stub.addNote(...)` is typed end-to-end.
//
// `basePath: "notes/<instance>"` bypasses the SDK's default
// `/agents/<kebab-agent>/<name>` URL construction — ayjnt exposes
// agents at `/<route>/<instance>` instead. The leading slash is
// stripped by the SDK.
const client = new AgentClient<NotesAgent>({
  agent: "NotesAgent", // ignored when basePath is set, but the SDK requires it
  basePath: `notes/${instance}`,
  host,
  // Server pushes state on connect AND after every setState() on the DO.
  // First fires once the WebSocket handshake completes.
  onStateUpdate: (state, source) => {
    console.log(
      `[state push from ${source}] ${state.notes.length} note(s):`,
      state.notes.map((n) => n.text),
    );
  },
  // Resolves after the server emits the CF_AGENT_IDENTITY message —
  // proof the worker called getAgentByName(...).setName(...) so the DO
  // knows its own identity. Useful for debugging the basePath wiring.
  onIdentity: (name, agent) => {
    console.log(`[identity] connected to ${agent}#${name}`);
  },
});

// Wait for the identity handshake before making calls. RPC calls before
// `ready` work (they queue), but waiting up front keeps the log readable
// and surfaces basePath misconfiguration immediately.
await client.ready;

// --- typed calls via .stub --------------------------------------------------
// Each `stub.<method>` is autocompleted against NotesAgent, with
// argument and return-type checking. Renaming a `@callable` method on
// the agent breaks this line at compile time.
const first = await client.stub.addNote("from the external client");
console.log("addNote ->", first); //  { id, text, createdAt }

const second = await client.stub.addNote("second note");
console.log("addNote ->", second);

const total = await client.stub.countNotes();
console.log("countNotes ->", total); // number

// --- string-name calls via .call -------------------------------------------
// `.call("method", [args])` is the same channel under different ergonomics.
// When the AgentClient generic is set (we passed <NotesAgent> above),
// the method name is constrained to actual `@callable` methods on the
// agent — TS will reject typos at the call site, and the return type
// is inferred from the method's signature. Drop the generic and you
// get the untyped overload — useful when the agent class isn't
// available at the call site.
const ok = await client.call("deleteNote", [first.id]);
console.log("deleteNote ->", ok); // true (return type inferred)

// --- exceptions propagate ---------------------------------------------------
// `@callable` methods can throw — the rejection lands here verbatim.
try {
  await client.call("deleteNote", ["non-existent-id"]);
  // This one returns `false` rather than throwing, but the surrounding
  // pattern is the same for methods that DO throw on bad input.
} catch (err) {
  console.error("call rejected:", err);
}

// --- wipe and verify --------------------------------------------------------
await client.stub.clearNotes();
const remaining = await client.stub.countNotes();
console.log("after clear ->", remaining); // 0

// State pushes have been printed by `onStateUpdate` all along — every
// `setState({...})` on the agent broadcasts here as a side effect of the
// callables.

// Give the last state push a moment to arrive before closing. Otherwise
// the close event races the state broadcast and the final 0-note state
// is lost.
await new Promise((resolve) => setTimeout(resolve, 100));

client.close();
