# NotesAgent

A small notes-list agent that demonstrates **`@callable` methods**
callable directly from the browser over WebSocket.

## The two `@callable` patterns

This example deliberately uses BOTH conventions on the same methods so
you can see they're complementary, not competing.

### 1. Cloudflare's `@callable()` decorator — `"agents"`

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
const agent = useAgent<NotesAgent>();
const note = await agent.stub.addNote("hello"); // typed end-to-end
// or, untyped:
await agent.call("addNote", ["hello"]);
```

The SDK sends a WebSocket frame to the agent, dispatches to the
decorated method, JSON-serialises the return value, and resolves the
Promise. `setState({...})` inside the method broadcasts the new state
to every connected client.

### 2. ayjnt's `/** @callable */` JSDoc tag

```ts
/**
 * Add a new note to the list.
 * @callable
 */
@callable({ description: "Add a new note." })
async addNote(text: string): Promise<Note> { /* … */ }
```

A build-time tag, parsed by ayjnt's `scan.ts`. Tagged methods are
surfaced in the `/__ayjnt/catalog` JSON endpoint:

```sh
curl http://localhost:8787/__ayjnt/catalog | jq '.agents[] | select(.routePath == "/notes")'
```

```json
{
  "agentId": "notes",
  "className": "NotesAgent",
  "routePath": "/notes",
  "callables": [
    { "name": "addNote",    "params": "text: string",       "returnType": "Promise<Note>",     "description": "Add a note to the list. Returns the newly created note." },
    { "name": "deleteNote", "params": "id: string",         "returnType": "Promise<boolean>",  "description": "Delete a note by id. Returns true if the note existed." },
    { "name": "clearNotes", "params": "",                   "returnType": "Promise<void>",     "description": "Clear every note in this instance." },
    { "name": "countNotes", "params": "",                   "returnType": "Promise<number>",   "description": "Count the notes." }
  ]
}
```

The JSDoc tag has **no runtime effect** on its own — it's pure
metadata for discovery. Catalog filtering still goes through the
agent's middleware chain (see `examples/catalog`).

## Mix-and-match matrix

| `@callable()` decorator | `/** @callable */` JSDoc | Behaviour |
|---|---|---|
| ✗ | ✗ | Private. Other agents can still call via `getAgent<T>` (native DO RPC). |
| ✓ | ✗ | Browser-callable via `agent.stub.method()`. Hidden from `/__ayjnt/catalog`. |
| ✗ | ✓ | Listed in `/__ayjnt/catalog`. Not callable from the browser. |
| ✓ | ✓ | **Recommended.** Browser-callable AND discoverable. |

## Calling from another agent (no decorator needed)

`getAgent<T>(env.NOTES_AGENT, "main")` returns a typed DO stub that
calls methods directly over native Workers RPC — no WebSocket, no
JSON serialisation, no client-side library. Method visibility is just
TypeScript's `public`. See `examples/inter-agent`.

That means `_findById` in `agent.ts` (no decorator, no JSDoc) is
unreachable from the browser AND invisible in the catalog, but
**still callable** from another agent if you import the type and have
the binding:

```ts
const notes = await getAgent<NotesAgent>(env.NOTES_AGENT, "main");
const note = await notes._findById("uuid-here"); // works
```

`@callable()` controls browser visibility, not method privacy.

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
