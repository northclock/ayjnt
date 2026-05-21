# NotesAgent

A small notes-list agent that demonstrates **`@callable()` methods**
callable directly from the browser over WebSocket — and shows that
ayjnt's `/__ayjnt/catalog` endpoint picks up the same decorator
metadata automatically.

## The decorator

```ts
import { Agent, callable } from "agents";

class NotesAgent extends Agent<Env, State> {
  @callable({ description: "Add a new note." })
  async addNote(text: string): Promise<Note> { /* … */ }
}
```

A real TypeScript 5 decorator. At runtime, the Agents SDK registers
`addNote` in its callable registry. From the browser:

```tsx
const agent = useAgent();
const note = await agent.stub.addNote("hello"); // typed end-to-end
// or, untyped fallback:
await agent.call("addNote", ["hello"]);
```

The SDK sends a WebSocket frame to the agent, dispatches to the
decorated method, JSON-serialises the return value, and resolves the
Promise. `setState({...})` inside the method broadcasts the new state
to every connected client.

## Same decorator drives the catalog

Every `@callable()`-decorated method also shows up in
`/__ayjnt/catalog` automatically — ayjnt's build-time scanner sees
the decorator, no separate marker needed:

```sh
curl http://localhost:8787/__ayjnt/catalog | jq '.agents[] | select(.routePath == "/notes")'
```

```json
{
  "agentId": "notes",
  "className": "NotesAgent",
  "routePath": "/notes",
  "callables": [
    { "name": "addNote",    "params": "text: string",   "returnType": "Promise<Note>",    "description": "Add a new note to the list." },
    { "name": "deleteNote", "params": "id: string",     "returnType": "Promise<boolean>", "description": "Delete a note by id." },
    { "name": "clearNotes", "params": "",               "returnType": "Promise<void>",    "description": "Wipe every note." },
    { "name": "countNotes", "params": "",               "returnType": "Promise<number>",  "description": "Return the number of notes." }
  ]
}
```

The catalog description comes from `@callable({ description: "..." })`.
If the decorator has no `description` option, ayjnt falls back to the
first prose line of the JSDoc immediately above the method. Long-form
JSDoc stays available for developer-facing hover docs — only the
short, machine-readable line ends up in the catalog.

## The legacy JSDoc tag

For the rare case where you want catalog visibility *without* WebSocket
exposure — e.g., an internal-but-stable RPC method other agents call
via `getAgent<T>` that you still want advertised — the framework
recognises `/** @callable */` as a JSDoc tag:

```ts
/**
 * Re-seed the notes from a snapshot. Internal — not browser-callable,
 * but listed in the catalog as a discoverable agent-to-agent RPC.
 * @callable
 */
async reseed(snapshot: Note[]): Promise<void> { /* … */ }
```

No decorator, no browser exposure — but `/__ayjnt/catalog` still
lists it. This is a fallback for the unusual case. **Most methods
should just use the decorator.**

## Mix-and-match matrix

| `@callable()` decorator | `/** @callable */` JSDoc | Behaviour |
|---|---|---|
| ✗ | ✗ | Private. Other agents can still call via `getAgent<T>` (native DO RPC). Not in the catalog. |
| ✓ | ✗ | **Recommended.** Browser-callable AND listed in the catalog. |
| ✗ | ✓ | Catalog-only — listed but not browser-callable. Use for agent-to-agent RPC you want discoverable. |
| ✓ | ✓ | Redundant. Identical to decorator alone; decorator's description wins. |

## Calling from another agent (no decorator needed)

`getAgent<T>(env.NOTES_AGENT, "main")` returns a typed DO stub that
calls methods directly over native Workers RPC — no WebSocket, no
JSON serialisation, no client-side library. Method visibility is just
TypeScript's `public`. See `examples/inter-agent`.

That means `_findById` in `agent.ts` (no decorator) is unreachable
from the browser AND invisible in the catalog, but **still callable**
from another agent if you import the type and have the binding:

```ts
const notes = await getAgent<NotesAgent>(env.NOTES_AGENT, "main");
const note = await notes._findById("uuid-here"); // works
```

`@callable()` controls browser visibility and catalog inclusion, not
method privacy. Agent-to-agent RPC works on any public method.

## Endpoints

| Path | Behaviour |
|---|---|
| `GET /notes` (default instance) | Same as `/notes/default`. |
| `GET /notes/<instance>` (browser) | HTML shell — the React UI. |
| `WebSocket /notes/<instance>` | Live state sync + `@callable()` RPC channel. |
| `GET /notes/<instance>` (curl) | JSON state. |
| `GET /notes/docs` | This file. |

## State shape

```ts
type Note = { id: string; text: string; createdAt: number };
type State = { notes: Note[] };
```
