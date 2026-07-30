// Data model for every example shown on the site.
//
// Every walkthrough starts from the `bunx ayjnt new <dir> --empty` bare
// scaffold (a single `alive` agent that replies "I'm alive"). Each example's steps
// then (a) explain which files to add/replace, (b) walk through the code
// highlighting the ayjnt + Agents SDK features in use, and (c) end with a
// "what the app should look like" screenshot.

import type { TreeNode } from "@/components/FileTree";
import type { TerminalLine } from "@/components/Terminal";
import type { Lang } from "@/lib/highlight";

export type Preview =
	| { kind: "terminal"; lines: string[] }
	| { kind: "ui"; caption: string }
	| { kind: "diagram"; nodes: string[] }
	| { kind: "game"; caption: string };

export type CodeFile = {
	path: string;
	lang: Lang;
	code: string;
	highlightLines?: number[];
};

export type Step = {
	title: string;
	blurb: string;
	terminal?: TerminalLine[];
	files?: CodeFile[];
	tree?: TreeNode[];
	treeTitle?: string;
	/** Optional ASCII mockup shown at the bottom of the step. Used at the
	 *  end of each example to show what the finished app looks like. */
	screenshot?: { content: string; label?: string };
};

export type ExampleMeta = {
	slug: string;
	title: string;
	description: string;
	tags: string[];
	preview: Preview;
	status: "stable" | "comingSoon";
	exampleDir?: string;
	whatYoullLearn?: string[];
	steps?: Step[];
};

// ---------------------------------------------------------------------------
// Shared scaffolding steps. Every example opens with one of these two. They
// match the output `ayjnt new` actually produces, so readers can copy-paste
// the commands and land on the same state.
// ---------------------------------------------------------------------------

const SCAFFOLD_BLANK: Step = {
	title: "Start from the bare scaffold",
	blurb:
		"Every ayjnt example starts here. `bunx ayjnt new --empty` drops a one-agent project with a single `alive` agent that responds \"I'm alive\" to any request — enough to prove the pipeline works before you replace it with the real thing. (Without `--empty`, `ayjnt new` also scaffolds a home page and counter UI.)",
	terminal: [
		{ kind: "command", text: "bunx ayjnt new my-app --empty" },
		{ kind: "output", text: "✓ scaffolded my-app/ (empty)" },
		{ kind: "blank" },
		{ kind: "command", text: "cd my-app && bun install" },
		{ kind: "output", text: "✓ 42 packages installed" },
		{ kind: "blank" },
		{ kind: "command", text: "bun run dev" },
		{ kind: "output", text: "✓ ayjnt: 1 agent(s) → .ayjnt/dist/wrangler.jsonc" },
		{ kind: "output", text: "⎔ Listening on http://localhost:8787" },
		{ kind: "blank" },
		{
			kind: "command",
			text: "curl http://localhost:8787/alive/hello",
		},
		{
			kind: "success",
			text: '{ "status":"alive", "message":"I\'m alive", "instance":"hello" }',
		},
	],
	tree: [
		{
			type: "folder",
			name: "agents",
			defaultOpen: true,
			children: [
				{
					type: "folder",
					name: "alive",
					defaultOpen: true,
					children: [
						{ type: "file", name: "agent.ts", kind: "ts" },
					],
				},
			],
		},
		{ type: "file", name: "package.json", kind: "json" },
		{ type: "file", name: "tsconfig.json", kind: "json" },
		{ type: "file", name: ".gitignore", kind: "txt" },
		{ type: "file", name: "README.md", kind: "md" },
	],
	treeTitle: "my-app/  (--empty scaffold)",
};

const SCAFFOLD_WITH_UI: Step = {
	title: "Start from the default scaffold (with UI)",
	blurb:
		"Same starter as the bare template but with React, react-dom and matching @types preinstalled so your agent.ts can have an app.tsx next to it. The default project is a Counter agent plus a root `agents/app.tsx` home page served at `/` — we'll replace the counter with the example's agent in the next steps.",
	terminal: [
		{ kind: "command", text: "bunx ayjnt new my-app" },
		{ kind: "output", text: "✓ scaffolded my-app/ (ui)" },
		{ kind: "blank" },
		{ kind: "command", text: "cd my-app && bun install" },
		{ kind: "output", text: "✓ 168 packages installed" },
		{ kind: "blank" },
		{ kind: "command", text: "bun run dev" },
		{
			kind: "output",
			text: "✓ ayjnt: 1 agent(s), 1 with UI → .ayjnt/dist/wrangler.jsonc",
		},
		{ kind: "output", text: "⎔ Listening on http://localhost:8787" },
	],
	tree: [
		{
			type: "folder",
			name: "agents",
			defaultOpen: true,
			children: [
				{
					type: "folder",
					name: "counter",
					defaultOpen: true,
					children: [
						{ type: "file", name: "agent.ts", kind: "ts" },
						{ type: "file", name: "app.tsx", kind: "tsx" },
					],
				},
			],
		},
		{ type: "file", name: "package.json", kind: "json" },
		{ type: "file", name: "tsconfig.json", kind: "json" },
	],
	treeTitle: "my-app/  (default UI scaffold)",
};

// Shared deploy step. Contents are mostly the same across examples so keep
// them here; any example that needs custom deploy text inlines its own.
function deployStep(url: string): Step {
	return {
		title: "Deploy",
		blurb:
			"`ayjnt deploy` checks your git tree is clean + synced with origin, regenerates the wrangler config from scratch, then shells out to `wrangler deploy`. The committed migrations.json file is the source of truth for what's in production.",
		terminal: [
			{ kind: "command", text: "bun run deploy" },
			{ kind: "output", text: "✓ git: clean + in sync with origin/main" },
			{ kind: "output", text: "✓ ayjnt: agents generated, 0 staged migrations" },
			{ kind: "output", text: "⎔ wrangler: uploading worker…" },
			{ kind: "success", text: `✓ deployed ${url}` },
		],
	};
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

export const EXAMPLES: ExampleMeta[] = [
	// --- basic --------------------------------------------------------------
	{
		slug: "basic",
		title: "Basic agent",
		description:
			"One ChatAgent with state, no UI, no middleware. The smallest possible ayjnt project beyond the blank scaffold — adds persistent messages so you can see how state works on a Durable Object.",
		tags: ["state", "http"],
		status: "stable",
		exampleDir: "examples/basic",
		preview: {
			kind: "terminal",
			lines: [
				"POST /chat/room-1 '{\"text\":\"hi\"}'",
				'{ "ok":true, "count":1 }',
				"GET /chat/room-1",
				'{ "messages":[…] }',
			],
		},
		whatYoullLearn: [
			"How the bare scaffold maps folders to agent URLs",
			"How `this.state` / `this.setState` persist on a Durable Object instance",
			"How to run ayjnt dev and hit the agent with curl",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Replace the `alive` agent with a chat agent",
				blurb:
					"Delete the starter agent and add a chat one. Each folder under `agents/` is exactly one Durable Object class — the folder name becomes the URL prefix.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/alive" },
					{ kind: "command", text: "mkdir agents/chat" },
					{ kind: "command", text: "# paste agents/chat/agent.ts from below" },
				],
				treeTitle: "my-app/  (after editing)",
				tree: [
					{
						type: "folder",
						name: "agents",
						defaultOpen: true,
						children: [
							{
								type: "folder",
								name: "chat",
								defaultOpen: true,
								highlight: true,
								children: [
									{ type: "file", name: "agent.ts", kind: "ts", highlight: true },
								],
							},
						],
					},
				],
			},
			{
				title: "agents/chat/agent.ts",
				blurb:
					"Extend `Agent`, declare your state type, write `onRequest`. `this.state` is the per-instance DO state; `this.setState` persists it and broadcasts the update to any connected UI. `GeneratedEnv` picks up every DO binding ayjnt generated automatically.",
				files: [
					{
						path: "agents/chat/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = {
  messages: { role: "user" | "assistant"; text: string }[];
};

export default class ChatAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { messages: [] };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const { text } = (await request.json()) as { text: string };
      this.setState({
        messages: [...this.state.messages, { role: "user", text }],
      });
      return Response.json({ ok: true, count: this.state.messages.length });
    }
    return Response.json({ instance: this.name, ...this.state });
  }
}`,
						highlightLines: [1, 2, 9, 13, 14],
					},
				],
			},
			{
				title: "Run it and hit it with curl",
				blurb:
					"ayjnt dev wraps wrangler dev. Each path segment after `/chat/` is a separate DO — `/chat/room-1` and `/chat/room-2` have independent state, even though they share the same agent class.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "output", text: "✓ ayjnt: 1 agent(s) → .ayjnt/dist/wrangler.jsonc" },
					{ kind: "output", text: "⎔ Listening on http://localhost:8787" },
					{ kind: "blank" },
					{
						kind: "command",
						text: 'curl -X POST localhost:8787/chat/room-1 -d \'{"text":"hi"}\'',
					},
					{ kind: "success", text: '{ "ok":true, "count":1 }' },
					{ kind: "blank" },
					{
						kind: "command",
						text: 'curl -X POST localhost:8787/chat/room-1 -d \'{"text":"again"}\'',
					},
					{ kind: "success", text: '{ "ok":true, "count":2 }' },
					{ kind: "blank" },
					{ kind: "command", text: "curl localhost:8787/chat/room-1" },
					{
						kind: "success",
						text: '{ "instance":"room-1", "messages":[{"role":"user","text":"hi"},{"role":"user","text":"again"}] }',
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"This example is terminal-only — there's no UI. You're verifying state persists across requests to the same instance, and that different instances are isolated.",
				screenshot: {
					label: "two instances, independent state",
					content: `$ curl localhost:8787/chat/room-1
{
  "instance": "room-1",
  "messages": [
    { "role": "user", "text": "hi" },
    { "role": "user", "text": "again" }
  ]
}

$ curl localhost:8787/chat/room-2
{
  "instance": "room-2",
  "messages": []
}

  room-1                    room-2
  ┌──────────────────┐      ┌──────────────────┐
  │ #messages: 2     │      │ #messages: 0     │
  │  • hi            │      │                  │
  │  • again         │      │  (fresh DO)      │
  └──────────────────┘      └──────────────────┘
        ↑ own DO                  ↑ own DO
        └── state survives worker restarts ──┘`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- with-client --------------------------------------------------------
	{
		slug: "with-client",
		title: "Client SDK + basePath",
		description:
			"Connect from the Cloudflare Agents client SDK. Explains the path vs basePath gotcha and why server-side getAgentByName matters for identity messages.",
		tags: ["client-sdk", "websocket", "gotcha"],
		status: "stable",
		exampleDir: "examples/with-client",
		preview: {
			kind: "terminal",
			lines: [
				"agentFetch({ agent: 'ChatAgent',",
				"  basePath: 'chat/' + roomId,",
				"  host })",
			],
		},
		whatYoullLearn: [
			"Why `path` doesn't replace the SDK's default URL prefix",
			"How `basePath` lets you own the URL shape ayjnt generates",
			"How the server-side `getAgentByName` call wires up CF_AGENT_IDENTITY messages",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Add the chat agent",
				blurb:
					"Same shape as the basic example — one folder, one class. The client work happens in a separate file (client.ts) you call with `bun run client.ts`.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/alive" },
					{ kind: "command", text: "mkdir agents/chat" },
				],
				files: [
					{
						path: "agents/chat/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { messages: { role: "user" | "assistant"; text: string }[] };

export default class ChatAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { messages: [] };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const { text } = (await request.json()) as { text: string };
      this.setState({ messages: [...this.state.messages, { role: "user", text }] });
      return Response.json({ ok: true, name: this.name });
    }
    return Response.json({ ...this.state, name: this.name });
  }
}`,
					},
				],
			},
			{
				title: "Client: basePath, not path",
				blurb:
					"The Cloudflare Agents SDK hardcodes `/agents/<kebab-class-name>/<id>` as its prefix. `path` appends to that URL; `basePath` replaces it entirely. ayjnt serves at `/<route>/:id`, so you want the latter.",
				files: [
					{
						path: "client.ts",
						lang: "ts",
						code: `import { agentFetch } from "agents/client";

const host = process.env.HOST ?? "http://localhost:8787";
const roomId = "demo-room";

// POST a message.
const post = await agentFetch(
  {
    agent: "ChatAgent",
    basePath: \`chat/\${roomId}\`,  // ← full URL override
    host,
  },
  {
    method: "POST",
    body: JSON.stringify({ text: "hello from the client" }),
  },
);
console.log(await post.json());`,
						highlightLines: [10],
					},
				],
			},
			{
				title: "The URL-shape trade-off",
				blurb:
					"Three client patterns, three different URLs. `path` is an append, `basePath` is a replace. The SDK's own JSDoc says: \"when `basePath` is set, the server must handle routing manually\" — that's exactly what ayjnt's generated worker does.",
				files: [
					{
						path: "url-shapes.ts",
						lang: "ts",
						code: `// { agent: "ChatAgent", name: "42" }
//   → wss://host/agents/chat-agent/42           ← SDK default (doesn't work with ayjnt)

// { agent: "ChatAgent", name: "42", path: "/x" }
//   → wss://host/agents/chat-agent/42/x         ← still has /agents prefix

// { agent: "ChatAgent", basePath: "chat/42" }
//   → wss://host/chat/42                        ← matches ayjnt's routing
`,
					},
				],
			},
			{
				title: "Run client + server together",
				blurb:
					"Start ayjnt dev in one terminal, run the client in another. The response includes `name` so you can see it reached the right DO instance.",
				terminal: [
					{ kind: "command", text: "bun run dev     # terminal 1" },
					{ kind: "blank" },
					{
						kind: "command",
						text: "bun run client.ts   # terminal 2",
					},
					{
						kind: "success",
						text: '{ "ok":true, "name":"demo-room" }',
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"The interesting output is that `name: \"demo-room\"` round-trips correctly. A hand-rolled dispatch that skips `setName` would echo back `name: \"\"` here.",
				screenshot: {
					label: "client ↔ server round-trip",
					content: `client.ts                           worker (generated entry.ts)
─────────                           ────────────────────────────
agentFetch({                        router match: /chat/:id
  agent: "ChatAgent",       ───▶    stub = getAgentByName(env.CHAT_AGENT, id)
  basePath: "chat/demo-room",       stub.setName("demo-room")   ← critical!
  host                              stub.fetch(request)
})                                  │
                                    ▼
                                    ChatAgent (DO "demo-room")
                                      this.name === "demo-room" ✓
                                      setState(...)
                                      return { ok:true, name: this.name }
{ ok: true,
  name: "demo-room" }       ◀───    response
`,
				},
			},
		],
	},

	// --- middleware ---------------------------------------------------------
	{
		slug: "middleware",
		title: "Multilayer middleware",
		description:
			"Root → leaf file-based middleware chain. One `middleware.ts` adds logging + timing headers to every response; a nested one gates a subtree with bearer-token auth. Route groups let you share middleware without nesting URLs.",
		tags: ["middleware", "auth", "groups"],
		status: "stable",
		exampleDir: "examples/middleware",
		preview: {
			kind: "diagram",
			nodes: ["root middleware", "admin gate", "agent"],
		},
		whatYoullLearn: [
			"How nested `middleware.ts` files compose root → leaf",
			"Short-circuiting with 403 vs wrapping the response",
			"Route groups — folders in parens, stripped from URL, still contribute to the chain",
			"`c.set` / `c.get` for per-request stash that flows between middleware",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Build the folder shape",
				blurb:
					"The file tree is the middleware chain. Every `middleware.ts` from the project root down to the agent folder gets collected and run in order. Route groups (parens) contribute to the chain but don't appear in the URL.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/alive" },
					{
						kind: "command",
						text: "mkdir -p agents/admin/users agents/public/status",
					},
				],
				treeTitle: "my-app/",
				tree: [
					{
						type: "folder",
						name: "agents",
						defaultOpen: true,
						children: [
							{
								type: "file",
								name: "middleware.ts",
								kind: "ts",
								highlight: true,
								note: "root: log + timing",
							},
							{
								type: "folder",
								name: "public",
								defaultOpen: true,
								children: [
									{
										type: "folder",
										name: "status",
										defaultOpen: true,
										children: [
											{ type: "file", name: "agent.ts", kind: "ts" },
										],
									},
								],
							},
							{
								type: "folder",
								name: "admin",
								defaultOpen: true,
								children: [
									{
										type: "file",
										name: "middleware.ts",
										kind: "ts",
										highlight: true,
										note: "auth gate",
									},
									{
										type: "folder",
										name: "users",
										defaultOpen: true,
										children: [
											{ type: "file", name: "agent.ts", kind: "ts" },
										],
									},
								],
							},
						],
					},
				],
			},
			{
				title: "Root middleware — wrap every response",
				blurb:
					"Runs for every request. After `await next()`, you can mutate the response — here we tack on `x-response-time-ms`. The trick: pass `res.body` through as a stream; reading it (with `await res.text()`) would consume it and leave the client with an empty body.",
				files: [
					{
						path: "agents/middleware.ts",
						lang: "ts",
						code: `import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  const start = Date.now();
  console.log(\`\${c.request.method} \${c.url.pathname}\`);
  const res = await next();
  const elapsed = Date.now() - start;

  const headers = new Headers(res.headers);
  headers.set("x-response-time-ms", String(elapsed));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};

export default middleware;`,
						highlightLines: [6, 9, 10, 11],
					},
				],
			},
			{
				title: "Nested middleware — guard a subtree",
				blurb:
					"Same contract, but it applies only under `/admin/*`. Short-circuits with 403 if the bearer is wrong. Note that the root middleware still wraps the 403 response — `x-response-time-ms` is present on failures too.",
				files: [
					{
						path: "agents/admin/middleware.ts",
						lang: "ts",
						code: `import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  const auth = c.request.headers.get("authorization");
  if (auth !== "Bearer letmein") {
    return c.text("forbidden", 403);
  }
  c.set("authenticated", true);   // stash for downstream middleware
  return next();
};

export default middleware;`,
						highlightLines: [5, 6, 7, 8],
					},
				],
			},
			{
				title: "The chain, per route",
				blurb:
					"For each incoming request, ayjnt walks from the project root down to the agent folder, collecting every `middleware.ts` it encounters. Route groups like `(public)` strip from the URL but still contribute to the chain.",
				files: [
					{
						path: "chain.ts",
						lang: "ts",
						code: `// GET /public/status/42
//   agents/middleware.ts  → agent
//
// GET /admin/users/alice
//   agents/middleware.ts
//     → agents/admin/middleware.ts
//       → agent
//
// POST /admin/users/alice  (no auth)
//   agents/middleware.ts
//     → agents/admin/middleware.ts    → short-circuits with 403
//       (agent not reached, but the root still wraps the 403
//        with x-response-time-ms)
`,
					},
				],
			},
			{
				title: "Run it + hit each route",
				blurb:
					"Public route: no auth, 200. Admin without auth: 403, still includes the timing header (root wraps the short-circuit). Admin with bearer: 200.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "blank" },
					{
						kind: "command",
						text: "curl -i localhost:8787/public/status/demo",
					},
					{ kind: "output", text: "HTTP/1.1 200 OK" },
					{ kind: "output", text: "x-response-time-ms: 3" },
					{ kind: "success", text: '{ "pings":1, "message":"no auth required…" }' },
					{ kind: "blank" },
					{
						kind: "command",
						text: "curl -i localhost:8787/admin/users/alice",
					},
					{ kind: "output", text: "HTTP/1.1 403 Forbidden" },
					{ kind: "output", text: "x-response-time-ms: 1" },
					{ kind: "output", text: "forbidden" },
					{ kind: "blank" },
					{
						kind: "command",
						text: "curl -iH 'authorization: Bearer letmein' localhost:8787/admin/users/alice",
					},
					{ kind: "output", text: "HTTP/1.1 200 OK" },
					{ kind: "success", text: '{ "visits":1, "message":"you passed the admin gate" }' },
				],
			},
			{
				title: "What it looks like",
				blurb:
					"You're looking at the timing header on the 403 — that's the root middleware wrapping the short-circuit. Proves the chain runs as intended.",
				screenshot: {
					label: "chain + wrapped responses",
					content: `     request
     │
     ▼
┌ agents/middleware.ts (root) ────────────────────────────┐
│  log, start timer                                       │
│  ┌─ agents/admin/middleware.ts ──────────────────────┐  │
│  │  check auth header                                │  │
│  │  ┌─ agents/admin/users/agent.ts ──────────────┐   │  │
│  │  │  return Response.json({ visits, … })        │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  │  ↑ returned to admin middleware                    │  │
│  └────────────────────────────────────────────────────┘  │
│  new Response(res.body, …                                │
│    headers.set("x-response-time-ms", elapsed))           │
└──────────────────────────────────────────────────────────┘
     │
     ▼
     response`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- inter-agent --------------------------------------------------------
	{
		slug: "inter-agent",
		title: "Inter-agent RPC",
		description:
			"Two agents talking over Workers RPC via typed `getAgent<T>()`. An Orders agent calls Inventory to decrement stock — full method autocomplete, exception propagation, oversell protection.",
		tags: ["rpc", "multi-agent"],
		status: "stable",
		exampleDir: "examples/inter-agent",
		preview: {
			kind: "diagram",
			nodes: ["OrdersAgent", "getAgent<InventoryAgent>", "InventoryAgent"],
		},
		whatYoullLearn: [
			"How `getAgent<T>` gives you typed DO stubs with method autocomplete",
			"How exceptions propagate across the RPC boundary",
			"Why agent RPC args must be structured-cloneable (plain data only)",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Two agents, one worker",
				blurb:
					"Each folder becomes its own DO-backed agent with isolated state. Orders is instanced per customer (`/orders/customer-1`, `/orders/customer-2`); Inventory is a single shared instance (`/inventory/main`).",
				terminal: [
					{ kind: "command", text: "rm -rf agents/alive" },
					{ kind: "command", text: "mkdir -p agents/orders agents/inventory" },
				],
				treeTitle: "my-app/agents/",
				tree: [
					{
						type: "folder",
						name: "orders",
						defaultOpen: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", highlight: true },
						],
					},
					{
						type: "folder",
						name: "inventory",
						defaultOpen: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", highlight: true },
						],
					},
				],
			},
			{
				title: "Callee — typed method that throws on failure",
				blurb:
					"`InventoryAgent.decrement` is an ordinary async method. Throwing is fine — the exception crosses the RPC boundary unchanged. Methods declared on the class are callable as DO stubs via `getAgent<T>`.",
				files: [
					{
						path: "agents/inventory/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { stock: Record<string, number> };

export default class InventoryAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { stock: { widget: 10, gadget: 5 } };

  async decrement(sku: string, qty: number): Promise<number> {
    const current = this.state.stock[sku] ?? 0;
    if (current < qty) {
      throw new Error(\`insufficient stock for \${sku}: have \${current}, need \${qty}\`);
    }
    const remaining = current - qty;
    this.setState({ stock: { ...this.state.stock, [sku]: remaining } });
    return remaining;
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}`,
						highlightLines: [9, 11, 12],
					},
				],
			},
			{
				title: "Caller — typed stub via getAgent<T>",
				blurb:
					"The generic makes `inv.decrement` autocomplete. `INVENTORY_AGENT` is a DO binding ayjnt generates automatically from the `agents/inventory/` folder — you never write wrangler.jsonc. Rename `decrement` in the callee and this file fails to compile.",
				files: [
					{
						path: "agents/orders/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type InventoryAgent from "../inventory/agent.ts";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { orders: { sku: string; qty: number; remaining: number }[] };

export default class OrdersAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { orders: [] };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json(this.state);

    const { sku, qty } = (await request.json()) as { sku: string; qty: number };
    try {
      const inv = await getAgent<InventoryAgent>(this.env.INVENTORY_AGENT, "main");
      const remaining = await inv.decrement(sku, qty);  // throws on oversell
      this.setState({ orders: [...this.state.orders, { sku, qty, remaining }] });
      return Response.json({ ok: true, remaining });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: message }, { status: 409 });
    }
  }
}`,
						highlightLines: [2, 3, 16, 17, 20, 21],
					},
				],
			},
			{
				title: "Run it + oversell",
				blurb:
					"Two customers each buy from the same inventory instance. The third customer tries to oversell and gets a 409 — exception thrown in Inventory, caught in Orders, translated to a structured HTTP response.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "blank" },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/orders/customer-1 -d '{\"sku\":\"widget\",\"qty\":3}'",
					},
					{ kind: "success", text: '{ "ok":true, "remaining":7 }' },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/orders/customer-2 -d '{\"sku\":\"widget\",\"qty\":4}'",
					},
					{ kind: "success", text: '{ "ok":true, "remaining":3 }' },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/orders/customer-3 -d '{\"sku\":\"widget\",\"qty\":99}'",
					},
					{
						kind: "output",
						text: 'HTTP/1.1 409 Conflict',
					},
					{
						kind: "success",
						text: '{ "ok":false, "error":"insufficient stock for widget: have 3, need 99" }',
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Two DO instances, one typed RPC edge. The error message from Inventory bubbles up through the Orders agent to the HTTP client, unmodified.",
				screenshot: {
					label: "inter-agent RPC + exception propagation",
					content: `client                orders/customer-3            inventory/main
──────                ─────────────────            ──────────────
POST /orders/customer-3
  {"sku":"widget",
   "qty":99}
       ─────────▶    onRequest
                     getAgent<InventoryAgent>(
                        env.INVENTORY_AGENT,
                        "main")
                        ─────────────────────▶    decrement("widget", 99)
                                                  current = 3
                                                  throw new Error(
                                                    "insufficient stock…")
                        ◀─────────────────────
                     catch(err)
                     Response.json(
                       { ok:false, error }, 409)
       ◀─────────
{ ok:false,
  error: "insufficient stock
          for widget:
          have 3, need 99" }`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- callable-client ----------------------------------------------------
	{
		slug: "callable-client",
		title: "Client-callable methods",
		description:
			"Cloudflare's `@callable()` decorator + `agent.stub.method()` from the React UI. Three patterns share the word \"callable\" in this framework — this example uses all three on one agent so the differences are unmissable: CF's decorator for browser→agent WebSocket RPC, ayjnt's `getAgent<T>` for agent→agent DO RPC, and ayjnt's `/** @callable */` JSDoc for catalog metadata.",
		tags: ["rpc", "callable", "ui", "websocket"],
		status: "stable",
		exampleDir: "examples/callable-client",
		preview: {
			kind: "terminal",
			lines: [
				"const agent = useAgent();",
				'const n = await agent.stub',
				'  .addNote("hello");',
				"// → { id, text, createdAt }",
				"//   typed end-to-end",
			],
		},
		whatYoullLearn: [
			"How `@callable()` from \"agents\" exposes methods to the browser over WebSocket",
			"How `agent.stub.method(args)` and `agent.call(\"method\", [args])` differ",
			"Why `@callable()` complements `setState({...})` rather than replacing it",
			"How the three \"callable\" patterns layer on the same method without conflict",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Decorate methods with @callable from \"agents\"",
				blurb:
					"`@callable()` is a real TypeScript 5 decorator imported from the Cloudflare Agents SDK. At runtime the SDK registers each decorated method in its callable registry; bundlers transpile the decorator using the ES decorator helper. Bun + Bun.build handle this natively — no plugin, no `experimentalDecorators` flag.",
				files: [
					{
						path: "agents/notes/agent.ts",
						lang: "ts",
						code: `import { Agent, callable } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Note = { id: string; text: string; createdAt: number };
type State = { notes: Note[] };

export default class NotesAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { notes: [] };

  /**
   * Add a note. The agent generates the id; only the server can.
   * @callable
   */
  @callable({ description: "Add a new note." })
  async addNote(text: string): Promise<Note> {
    const note = { id: crypto.randomUUID(), text, createdAt: Date.now() };
    this.setState({ notes: [...this.state.notes, note] });
    return note;
  }

  /**
   * Delete a note by id. Returns true if it existed.
   * @callable
   */
  @callable({ description: "Delete a note by id." })
  async deleteNote(id: string): Promise<boolean> {
    const before = this.state.notes.length;
    this.setState({ notes: this.state.notes.filter((n) => n.id !== id) });
    return this.state.notes.length < before;
  }
}`,
						highlightLines: [1, 13, 14, 15, 16, 17, 18, 19, 25, 26, 27],
					},
				],
			},
			{
				title: "Call from the UI via agent.stub.<method>",
				blurb:
					"The generated `useAgent()` hook is pre-bound to `NotesAgent` at codegen time, so `agent.stub` is a typed proxy over every `@callable()` method. Calling `agent.stub.addNote(\"hello\")` sends a WebSocket frame, the agent dispatches to the decorated method, the return value is JSON-serialised back, and the Promise resolves — typed end-to-end. `setState` inside the method broadcasts the new state to every connected client, so a second tab sees the note immediately.",
				files: [
					{
						path: "agents/notes/app.tsx",
						lang: "tsx",
						code: `import { useState } from "react";
import { useAgent } from "@ayjnt/notes";

export default function NotesApp() {
  const agent = useAgent();                    // no generic needed — typed
  const notes = agent.state?.notes ?? [];
  const [text, setText] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const note = await agent.stub.addNote(text.trim());   // typed!
    console.log("created:", note.id, note.text);
    setText("");
  };

  return (
    <main>
      <form onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit">add</button>
      </form>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>
            {n.text}{" "}
            <button onClick={() => agent.stub.deleteNote(n.id)}>×</button>
          </li>
        ))}
      </ul>
    </main>
  );
}`,
						highlightLines: [5, 12, 26],
					},
				],
			},
			{
				title: "Three \"callable\" patterns on one agent",
				blurb:
					"`@callable()` (CF's decorator) makes methods reachable from the browser. `/** @callable */` (ayjnt's JSDoc tag) advertises them in `/__ayjnt/catalog`. `getAgent<T>` calls them from another agent. The three are orthogonal — pick the audience(s) you want. The example uses all three on every method so each pattern is observable independently.",
				terminal: [
					{ kind: "command", text: "# Browser → agent (CF @callable decorator)" },
					{ kind: "command", text: "# (in browser): await agent.stub.addNote('first')" },
					{ kind: "success", text: '{ "id": "uuid-...", "text": "first", "createdAt": ... }' },
					{ kind: "blank" },
					{ kind: "command", text: "# Catalog → discoverable (ayjnt /** @callable */ JSDoc)" },
					{
						kind: "command",
						text: "curl localhost:8787/__ayjnt/catalog | jq '.agents[] | select(.routePath == \"/notes\") | .callables[].name'",
					},
					{ kind: "success", text: '"addNote"' },
					{ kind: "success", text: '"deleteNote"' },
					{ kind: "success", text: '"clearNotes"' },
					{ kind: "success", text: '"countNotes"' },
					{ kind: "blank" },
					{ kind: "command", text: "# Agent → agent (ayjnt getAgent<T>, no decorator needed)" },
					{ kind: "command", text: "# in another agent: await getAgent<NotesAgent>(env.NOTES_AGENT, 'main').addNote('via RPC')" },
					{ kind: "success", text: "// works — public methods are always callable via DO RPC" },
				],
			},
			{
				title: "Run it",
				blurb:
					"`bun run dev` exposes the React UI at /notes and the catalog at /__ayjnt/catalog. Open the UI in two tabs — every `agent.stub.addNote` from one tab triggers a `setState` broadcast that the other tab sees live.",
				terminal: [
					{ kind: "command", text: "bun install" },
					{ kind: "command", text: "bun run dev" },
					{ kind: "output", text: "✓ ayjnt: 1 agent(s), 1 with UI, 1 with docs → .ayjnt/dist/wrangler.jsonc" },
					{ kind: "output", text: "⎔ Listening on http://localhost:8787" },
					{ kind: "blank" },
					{ kind: "command", text: "open http://localhost:8787/notes" },
					{ kind: "command", text: "# open the same URL in a second tab to see live state sync" },
				],
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- with-ui ------------------------------------------------------------
	{
		slug: "with-ui",
		title: "Basic agent UI",
		description:
			"Drop an `app.tsx` next to `agent.ts`. The generated `useAgent()` hook is typed to that agent's class and state. Live multi-tab state sync built in — open two tabs, they share state.",
		tags: ["react", "ui", "live-sync"],
		status: "stable",
		exampleDir: "examples/with-ui",
		preview: { kind: "ui", caption: "counter — live syncs across tabs" },
		whatYoullLearn: [
			"How `@ayjnt/<route>` resolves to a per-agent typed hook",
			"How the worker serves HTML vs agent on the same URL",
			"Why state-sync covers 80% of \"realtime UI\" without any extra wiring",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Folder shape — agent + UI side by side",
				blurb:
					"The default scaffold drops a Counter agent for you. Look at what it laid down — one folder with both the server (agent.ts) and the client (app.tsx). The generated typed hook wires them.",
				treeTitle: "my-app/agents/counter/",
				tree: [
					{
						type: "file",
						name: "agent.ts",
						kind: "ts",
						highlight: true,
						note: "server — the Durable Object",
					},
					{
						type: "file",
						name: "app.tsx",
						kind: "tsx",
						highlight: true,
						note: "client — React UI bound to it",
					},
				],
			},
			{
				title: "agents/counter/agent.ts",
				blurb:
					"For a counter, state mutation from the client is enough. You don't even need methods on the class — `useAgent().setState` round-trips through the DO. The server just echoes state on onRequest.",
				files: [
					{
						path: "agents/counter/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { count: number };

export default class CounterAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { count: 0 };

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}`,
					},
				],
			},
			{
				title: "agents/counter/app.tsx — one typed hook call",
				blurb:
					"`useAgent()` is generated per agent. The state shape is typed to `CounterAgent['state']`. `agent.setState(...)` round-trips through the server DO and fans out to every connected tab over WebSocket. No Redux, no Zustand, no provider.",
				files: [
					{
						path: "agents/counter/app.tsx",
						lang: "tsx",
						code: `import { useAgent } from "@ayjnt/counter";

export default function Counter() {
  const agent = useAgent();
  const count = agent.state?.count ?? 0;
  const set = (next: number) => agent.setState({ count: next });

  return (
    <main>
      <h1>Count: {count}</h1>
      <button onClick={() => set(count - 1)}>−</button>
      <button onClick={() => set(count + 1)}>+</button>
    </main>
  );
}`,
						highlightLines: [1, 3],
					},
				],
			},
			{
				title: "How the worker picks HTML vs agent on the same URL",
				blurb:
					"The same URL `/counter/:id` serves the HTML shell to browsers and forwards everything else to the agent. Disambiguation is a handful of lines in the generated `entry.ts` — middleware runs for both paths.",
				files: [
					{
						path: "dispatch.ts",
						lang: "ts",
						code: `// GET + Accept: text/html + no Upgrade   → HTML shell (the UI)
// GET + Upgrade: websocket               → WS handshake → agent
// anything else (POST, curl without Accept) → agent.onRequest
`,
					},
				],
			},
			{
				title: "Run + open two tabs",
				blurb:
					"Open `/counter/demo` in two browser tabs. The `+` button in tab 1 updates tab 2 immediately. Each path segment after `/counter/` is its own DO — `/counter/room-1` and `/counter/room-2` are independent.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{
						kind: "output",
						text: "✓ ayjnt: 1 agent(s), 1 with UI → .ayjnt/dist/wrangler.jsonc",
					},
					{ kind: "blank" },
					{ kind: "command", text: "open http://localhost:8787/counter/demo" },
					{
						kind: "command",
						text: "open http://localhost:8787/counter/demo  # second tab",
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Two tabs, one DO. Click + in either tab and the count updates in both.",
				screenshot: {
					label: "counter — two tabs sharing state",
					content: `  tab 1: /counter/demo            tab 2: /counter/demo
  ┌─────────────────────────┐    ┌─────────────────────────┐
  │        Counter           │    │        Counter           │
  │  instance: demo          │    │  instance: demo          │
  │  open this URL in        │    │  open this URL in        │
  │  another tab — state     │    │  another tab — state     │
  │  syncs across tabs       │    │  syncs across tabs       │
  │                          │    │                          │
  │          42              │    │          42              │
  │                          │    │                          │
  │   [−]  [reset]  [+]      │    │   [−]  [reset]  [+]      │
  └─────────────────────────┘    └─────────────────────────┘
           │                              ▲
           │ click +                      │ re-renders with 43
           ▼                              │
           ─────setState({count:43})──────┘
             via CounterAgent DO`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- mcp ----------------------------------------------------------------
	{
		slug: "mcp",
		title: "MCP tools agent",
		description:
			"Build an MCP server for LLM tool-calling. ayjnt detects `McpAgent` as a base class and dispatches through `McpAgent.serve()` automatically — streamable HTTP and SSE transports handled for you.",
		tags: ["mcp", "llm-tools"],
		status: "stable",
		exampleDir: "examples/mcp",
		preview: {
			kind: "diagram",
			nodes: ["Claude Desktop", "/tools (MCP)", "McpAgent DO"],
		},
		whatYoullLearn: [
			"How `extends McpAgent` changes the dispatch path",
			"How to register tools with `server.tool(name, schema, handler)`",
			"URL shape trade-offs for MCP agents (no `:instanceId` — sessions live in headers)",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Add the MCP dependency",
				blurb:
					"The Agents SDK's `McpAgent` uses the reference MCP SDK for schema validation + transport. Add it along with zod for schema definitions.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/alive" },
					{ kind: "command", text: "mkdir agents/tools" },
					{
						kind: "command",
						text: "bun add @modelcontextprotocol/sdk zod",
					},
				],
			},
			{
				title: "Extend McpAgent, register tools",
				blurb:
					"ayjnt detects the `extends McpAgent` clause source-level (a regex — don't alias the import) and routes `/tools` through `Tools.serve(\"/tools\", { binding: \"TOOLS\" }).fetch(...)` instead of the normal Agent dispatch. The MCP transport layer (streamable-http, SSE, session management) is handled for you.",
				files: [
					{
						path: "agents/tools/agent.ts",
						lang: "ts",
						code: `import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GeneratedEnv } from "@ayjnt/env";

type State = { invocations: number };

export default class Tools extends McpAgent<GeneratedEnv, State> {
  override initialState: State = { invocations: 0 };

  server = new McpServer({ name: "my-tools", version: "0.1.0" });

  async init() {
    this.server.tool("echo", "Echo the input.", { text: z.string() },
      async ({ text }) => {
        this.setState({ invocations: this.state.invocations + 1 });
        return { content: [{ type: "text", text }] };
      });

    this.server.tool("add", "Add two numbers.",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => {
        this.setState({ invocations: this.state.invocations + 1 });
        return { content: [{ type: "text", text: String(a + b) }] };
      });
  }
}`,
						highlightLines: [1, 8, 13, 20],
					},
				],
			},
			{
				title: "Plug into Claude Desktop",
				blurb:
					"Once deployed, point any MCP client at your worker's URL. Streamable-http and SSE transports are served from the same path. Session id lives in the `Mcp-Session-Id` header — one DO instance per session, created automatically.",
				files: [
					{
						path: "~/Library/Application Support/Claude/claude_desktop_config.json",
						lang: "jsonc",
						code: `{
  "mcpServers": {
    "my-tools": {
      "url": "https://my-app.<account>.workers.dev/tools"
    }
  }
}`,
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Open Claude Desktop — the tools show up in the attachment menu. Ask it to add two numbers and it calls `add(a, b)`; ask it to repeat text and it calls `echo`.",
				screenshot: {
					label: "Claude Desktop — your MCP server",
					content: `  ┌──────────────── Claude Desktop ────────────────┐
  │ ≡  my-tools  ✓ connected                        │
  │ ─────────────────────────────────────────────── │
  │                                                 │
  │  User: can you add 17 and 25?                   │
  │                                                 │
  │  Claude: I'll use the add tool.                 │
  │    ▸ tool call: add({ a: 17, b: 25 })   ◀──── HTTPS POST /tools
  │    ▸ result: 42                          ◀──── McpAgent DO
  │                                                 │
  │  The answer is 42.                              │
  │                                                 │
  │  [📎 my-tools ▾]   ask anything…   [send]      │
  └─────────────────────────────────────────────────┘`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- catalog ------------------------------------------------------------
	{
		slug: "catalog",
		title: "Agent catalog & docs.md",
		description:
			"Per-agent docs.md served at /<route>/docs and a built-in /__ayjnt/catalog endpoint that lists every agent the caller can reach (filtered by middleware) with its @callable RPC surface. Includes a React UI that renders the catalog as a live tree.",
		tags: ["catalog", "docs", "middleware", "ui"],
		status: "stable",
		exampleDir: "examples/catalog",
		preview: {
			kind: "terminal",
			lines: [
				"GET /__ayjnt/catalog",
				'{ "agents": [{',
				'  "routePath":"/users",',
				'  "callables":[…],',
				'  "docsUrl":"/users/docs"',
				"}] }",
			],
		},
		whatYoullLearn: [
			"How to drop a docs.md next to agent.ts and serve it at /<route>/docs",
			"How the @callable JSDoc tag advertises RPC methods in /__ayjnt/catalog",
			"How the catalog filters agents by middleware (admin gates hide gated agents)",
			"How to read the catalog from a React UI to render a live agent tree",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Three agents — one public, one orders, one admin-gated",
				blurb:
					"Each folder is one agent. `users/` and `orders/` are open; `admin/` carries a `middleware.ts` bearer-token gate, so anything underneath (here `admin/reports/`) requires `Authorization: Bearer letmein`. The catalog endpoint will filter visibility based on that gate.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/alive" },
					{ kind: "command", text: "mkdir -p agents/users agents/orders agents/admin/reports agents/catalog" },
				],
				treeTitle: "my-app/agents/",
				tree: [
					{
						type: "folder",
						name: "users",
						defaultOpen: true,
						highlight: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", note: "3× @callable" },
							{ type: "file", name: "docs.md", kind: "md", note: "served at /users/docs" },
						],
					},
					{
						type: "folder",
						name: "orders",
						defaultOpen: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", note: "2× @callable, no docs" },
						],
					},
					{
						type: "folder",
						name: "admin",
						defaultOpen: true,
						highlight: true,
						children: [
							{ type: "file", name: "middleware.ts", kind: "ts", note: "bearer-token gate" },
							{
								type: "folder",
								name: "reports",
								defaultOpen: true,
								children: [
									{ type: "file", name: "agent.ts", kind: "ts" },
									{ type: "file", name: "docs.md", kind: "md", note: "also gated" },
								],
							},
						],
					},
					{
						type: "folder",
						name: "catalog",
						defaultOpen: true,
						highlight: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", note: "host" },
							{ type: "file", name: "app.tsx", kind: "tsx", note: "renders the tree" },
						],
					},
				],
			},
			{
				title: "Tag RPC methods with @callable",
				blurb:
					"Tagging is opt-in. Methods without the JSDoc `@callable` tag stay private to the class — they're still callable internally but won't appear in the catalog. The first non-tag line of the JSDoc becomes the description.",
				files: [
					{
						path: "agents/users/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";

type Env = Record<string, never>;
type User = { id: string; name: string };
type State = { users: User[] };

export default class UsersAgent extends Agent<Env, State> {
  override initialState: State = {
    users: [{ id: "u_1", name: "Ada" }, { id: "u_2", name: "Grace" }],
  };

  /**
   * Look up a single user by id.
   * @callable
   */
  async getUser(id: string): Promise<User | null> {
    return this.state.users.find((u) => u.id === id) ?? null;
  }

  /**
   * Return every user in the directory.
   * @callable
   */
  async listUsers(): Promise<User[]> {
    return this.state.users;
  }

  /**
   * Append a new user. Returns the freshly created record.
   * @callable
   */
  async createUser(name: string): Promise<User> {
    const user: User = { id: \`u_\${this.state.users.length + 1}\`, name };
    this.setState({ users: [...this.state.users, user] });
    return user;
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}`,
						highlightLines: [12, 13, 14, 15, 21, 22, 23, 24, 30, 31, 32, 33],
					},
				],
			},
			{
				title: "docs.md beside agent.ts — served at /<route>/docs",
				blurb:
					"`ayjnt build` reads each docs.md and embeds it as a string literal in the generated worker. Hitting `<routePath>/docs` returns the markdown with `content-type: text/markdown`. The same middleware chain that gates the agent gates the docs — `/admin/reports/docs` is 403 without the bearer token.",
				files: [
					{
						path: "agents/users/docs.md",
						lang: "md",
						code: `# UsersAgent

A tiny directory of users, stored in agent state.

## Callable methods

| Method | Signature | Description |
|---|---|---|
| \`getUser\`    | \`(id: string) => Promise<User | null>\` | Look up a single user by id. |
| \`listUsers\`  | \`() => Promise<User[]>\`                 | Return every user. |
| \`createUser\` | \`(name: string) => Promise<User>\`       | Append a new user. |

## HTTP

\`GET /users/<instance>\` returns \`{ instance, users }\`.
`,
					},
					{
						path: "agents/admin/middleware.ts",
						lang: "ts",
						code: `// Anything under agents/admin/ requires a bearer token. The catalog
// endpoint hides agents whose middleware short-circuits with non-2xx,
// so /admin/reports disappears from /__ayjnt/catalog without auth.

import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  if (c.request.headers.get("authorization") !== "Bearer letmein") {
    return c.text("forbidden", 403);
  }
  return next();
};

export default middleware;`,
					},
				],
			},
			{
				title: "/__ayjnt/catalog — built-in, access-filtered",
				blurb:
					"The framework reserves `GET /__ayjnt/catalog`. For each route it runs the middleware chain against the incoming request — if the chain short-circuits with non-2xx, the agent is hidden. Pass the bearer token and the admin agents reappear.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "output", text: "✓ ayjnt: 4 agent(s), 1 with UI, 3 with docs → .ayjnt/dist/wrangler.jsonc" },
					{ kind: "blank" },
					{ kind: "command", text: "# anonymous — admin/reports hidden" },
					{ kind: "command", text: "curl localhost:8787/__ayjnt/catalog | jq '.agents[].routePath'" },
					{ kind: "success", text: '"/catalog"' },
					{ kind: "success", text: '"/orders"' },
					{ kind: "success", text: '"/users"' },
					{ kind: "blank" },
					{ kind: "command", text: "# with bearer — admin/reports included" },
					{
						kind: "command",
						text: "curl -H 'authorization: Bearer letmein' \\",
					},
					{
						kind: "command",
						text: "  localhost:8787/__ayjnt/catalog | jq '.agents[].routePath'",
					},
					{ kind: "success", text: '"/admin/reports"' },
					{ kind: "success", text: '"/catalog"' },
					{ kind: "success", text: '"/orders"' },
					{ kind: "success", text: '"/users"' },
					{ kind: "blank" },
					{ kind: "command", text: "# fetch markdown docs" },
					{ kind: "command", text: "curl localhost:8787/users/docs" },
					{ kind: "success", text: "# UsersAgent" },
					{ kind: "success", text: "..." },
				],
			},
			{
				title: "agents/catalog/app.tsx — render the tree live",
				blurb:
					"The catalog UI is just an `app.tsx` co-located with a no-op `agent.ts`. It fetches `/__ayjnt/catalog`, optionally with an `Authorization` header from a text input, and renders the result as a tree. Watch admin agents appear and disappear as you type the token.",
				files: [
					{
						path: "agents/catalog/app.tsx",
						lang: "tsx",
						code: `import { useEffect, useState } from "react";

type Callable = {
  name: string;
  params: string;
  returnType: string | null;
  description: string | null;
};

type CatalogEntry = {
  agentId: string;
  className: string;
  routePath: string;
  hasApp: boolean;
  hasDocs: boolean;
  isMcp: boolean;
  callables: Callable[];
  docsUrl: string | null;
};

export default function CatalogApp() {
  const [token, setToken] = useState("");
  const [catalog, setCatalog] = useState<{ agents: CatalogEntry[] } | null>(null);

  useEffect(() => {
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = \`Bearer \${token}\`;
    fetch("/__ayjnt/catalog", { headers })
      .then((r) => r.json())
      .then(setCatalog);
  }, [token]);

  return (
    <main>
      <h1>Agent Catalog</h1>
      <label>
        Authorization: Bearer
        <input value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <ul>
        {catalog?.agents.map((a) => (
          <li key={a.agentId}>
            <code>{a.routePath}</code> — {a.className}
            {a.docsUrl && <a href={a.docsUrl}> [docs]</a>}
            <ul>
              {a.callables.map((c) => (
                <li key={c.name}>
                  <code>
                    {c.name}({c.params}){c.returnType ? \`: \${c.returnType}\` : ""}
                  </code>
                  {c.description && <p>{c.description}</p>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}`,
						highlightLines: [27, 28, 29, 30, 31, 36, 37, 38, 39, 40],
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Open `/catalog/me` in a browser. Three agents (users, orders, catalog) and their callables render as a tree. Type `letmein` into the bearer-token field and `/admin/reports` appears with its callable methods listed underneath.",
				screenshot: {
					label: "catalog UI — admin section toggling on auth",
					content: `Agent Catalog
═════════════
Authorization: Bearer [          ]   ← anonymous

  /catalog                CatalogAgent  [docs]
    (no @callable methods)

  /orders                 OrdersAgent
    createOrder(sku: string, qty: number): Promise<Order>
      Append a new order to this customer's history.
    listOrders(): Promise<Order[]>
      Return every order for this customer.

  /users                  UsersAgent  [docs]
    getUser(id: string): Promise<User | null>
      Look up a single user by id.
    listUsers(): Promise<User[]>
      Return every user in the directory.
    createUser(name: string): Promise<User>
      Append a new user. Returns the freshly created record.

╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
Authorization: Bearer [letmein     ]   ← unlocked

  /admin/reports          ReportsAgent  [docs]   ★ NEW
    listReports(): Promise<Report[]>
      Return every available report. Sensitive — gated.

  /catalog                CatalogAgent  [docs]
  /orders                 OrdersAgent
  /users                  UsersAgent  [docs]`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- scheduled-tasks ----------------------------------------------------
	{
		slug: "scheduled-tasks",
		title: "Agent task scheduling",
		description:
			"An agent that schedules one-shot work with `this.schedule()`. Relative delays (seconds from now), absolute times (ISO dates), and persistent state for both pending and fired reminders.",
		tags: ["scheduling", "alarms"],
		status: "stable",
		exampleDir: "examples/scheduled-tasks",
		preview: {
			kind: "terminal",
			lines: [
				"this.schedule(60, 'fire', payload)",
				"scheduled: in 60s",
			],
		},
		whatYoullLearn: [
			"How `this.schedule()` uses Cloudflare DO alarms to survive restarts",
			"Difference between relative (seconds), absolute (Date), and unix-time (number) whens",
			"How to cancel pending schedules with `this.cancelSchedule(id)`",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Add a reminder agent",
				blurb:
					"Replace the starter `alive` agent with one that schedules reminders. Every `ReminderAgent` instance holds its own pending + fired queue.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/alive" },
					{ kind: "command", text: "mkdir agents/reminder" },
				],
			},
			{
				title: "agents/reminder/agent.ts",
				blurb:
					"The `fire` method is the scheduled callback. `this.schedule(when, \"fire\", payload)` tells the SDK to invoke `this.fire(payload)` at `when`. Cloudflare persists the alarm on the DO so it survives worker restarts.",
				files: [
					{
						path: "agents/reminder/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Reminder = { id: string; text: string; due: number; firedAt?: number };

type State = { pending: Reminder[]; fired: Reminder[] };

export default class ReminderAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { pending: [], fired: [] };

  /** Scheduled callback. The name must match the second arg to schedule(). */
  async fire(reminder: Reminder): Promise<void> {
    this.setState({
      pending: this.state.pending.filter((r) => r.id !== reminder.id),
      fired: [...this.state.fired, { ...reminder, firedAt: Date.now() }],
    });
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ instance: this.name, ...this.state });
    }
    const body = (await request.json()) as { text: string; in?: number; at?: string };
    const due = body.at ? new Date(body.at) : new Date(Date.now() + (body.in ?? 0) * 1000);

    const reminder: Reminder = { id: crypto.randomUUID(), text: body.text, due: due.getTime() };
    await this.schedule(due, "fire", reminder);   // ← persists an alarm on the DO

    this.setState({ ...this.state, pending: [...this.state.pending, reminder] });
    return Response.json({ ok: true, scheduled: reminder });
  }
}`,
						highlightLines: [11, 12, 25, 26],
					},
				],
			},
			{
				title: "Schedule three reminders, watch them fire",
				blurb:
					"POSTing three reminders with different timings shows each arrive on schedule. The alarm persists even across worker restarts — tear down dev, bring it back, and the 6-second reminder still fires when it's due.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "blank" },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/reminder/inbox -d '{\"text\":\"say hi\",\"in\":2}'",
					},
					{ kind: "success", text: '{ "ok":true, "scheduled":{"…","text":"say hi","due":…} }' },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/reminder/inbox -d '{\"text\":\"drink water\",\"in\":4}'",
					},
					{ kind: "success", text: '{ "ok":true, "scheduled":{"…","text":"drink water",…} }' },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/reminder/inbox -d '{\"text\":\"stretch\",\"in\":6}'",
					},
					{ kind: "success", text: '{ "ok":true, "scheduled":{"…","text":"stretch",…} }' },
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Poll every second to watch reminders migrate from `pending` to `fired`. Running the provided `bun run client` script automates this.",
				screenshot: {
					label: "state over time",
					content: `t=1s  pending: 3  fired: —
t=2s  pending: 2  fired: say hi
t=3s  pending: 2  fired: say hi
t=4s  pending: 1  fired: say hi, drink water
t=5s  pending: 1  fired: say hi, drink water
t=6s  pending: 0  fired: say hi, drink water, stretch

           each reminder
           └── one persisted Cloudflare alarm
               ↓ fires even if the worker was evicted
               ↓ callback mutates state via setState
               ↓ state visible on next GET`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- recurring-tasks ---------------------------------------------------
	{
		slug: "recurring-tasks",
		title: "Recurring tasks agent",
		description:
			"Agent that wakes itself on a fixed cadence via `scheduleEvery()` and mutates its own state. Classic background-worker pattern on a single Durable Object. Ships with a live bar-chart UI.",
		tags: ["scheduling", "cron", "ui"],
		status: "stable",
		exampleDir: "examples/recurring-tasks",
		preview: {
			kind: "terminal",
			lines: ["scheduleEvery(5, 'tick')", "tick #1 · load 73%"],
		},
		whatYoullLearn: [
			"How `scheduleEvery(seconds, callback)` differs from one-shot `schedule()`",
			"Why you must cancel the old schedule before calling scheduleEvery again",
			"How recurring state updates fan out to any connected UI automatically",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Replace counter/ with heartbeat/",
				blurb:
					"The default UI scaffold gave us react + react-dom + typed tsconfig already. All that's left is swap the agent.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/counter" },
					{ kind: "command", text: "mkdir agents/heartbeat" },
				],
			},
			{
				title: "agents/heartbeat/agent.ts — the tick loop",
				blurb:
					"`this.scheduleEvery(seconds, \"tick\")` fires `this.tick()` on a fixed cadence. Returns a `Schedule` whose id you persist if you want to cancel it later. Calling scheduleEvery twice without cancelling the first leaves both running — always `stopTicking()` first.",
				files: [
					{
						path: "agents/heartbeat/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Tick = { at: number; n: number; load: number };
type State = {
  intervalSeconds: number;
  ticks: Tick[];
  scheduleId: string | null;
};

export default class HeartbeatAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { intervalSeconds: 0, ticks: [], scheduleId: null };

  /** Recurring callback — fires every intervalSeconds once started. */
  async tick(): Promise<void> {
    const last = this.state.ticks[0]?.n ?? 0;
    const tick = { at: Date.now(), n: last + 1, load: Math.round(Math.random() * 1000) / 10 };
    this.setState({ ...this.state, ticks: [tick, ...this.state.ticks].slice(0, 50) });
  }

  private async stopTicking() {
    if (this.state.scheduleId) await this.cancelSchedule(this.state.scheduleId).catch(() => {});
    this.setState({ ...this.state, intervalSeconds: 0, scheduleId: null });
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const { intervalSeconds = 5, stop } = await request.json() as { intervalSeconds?: number; stop?: boolean };
      if (stop) { await this.stopTicking(); return Response.json({ ok: true, running: false }); }

      await this.stopTicking();   // ← mandatory before starting a new schedule
      const s = await this.scheduleEvery(intervalSeconds, "tick");
      this.setState({ ...this.state, intervalSeconds, scheduleId: s.id });
      return Response.json({ ok: true, running: true, intervalSeconds });
    }
    return Response.json({ instance: this.name, ...this.state });
  }
}`,
						highlightLines: [14, 15, 32, 33],
					},
				],
			},
			{
				title: "agents/heartbeat/app.tsx — live bar chart",
				blurb:
					"`useAgent()` subscribes to state. Every tick → setState → CF_AGENT_STATE message → React re-render. No polling, no SSE. Two buttons POST to the same URL to start/stop the loop.",
				files: [
					{
						path: "agents/heartbeat/app.tsx",
						lang: "tsx",
						code: `import { useAgent } from "@ayjnt/heartbeat";

export default function Heartbeat() {
  const agent = useAgent();
  const ticks = agent.state?.ticks ?? [];
  const running = (agent.state?.intervalSeconds ?? 0) > 0;

  const post = (body: object) =>
    fetch(window.location.pathname, { method: "POST", body: JSON.stringify(body) });

  const max = Math.max(100, ...ticks.map((t) => t.load));

  return (
    <main>
      <h1>heartbeat — {agent.name}</h1>
      <button disabled={running} onClick={() => post({ intervalSeconds: 2 })}>start 2s</button>
      <button disabled={!running} onClick={() => post({ stop: true })}>stop</button>
      <div style={{ display: "flex", alignItems: "end", height: 120 }}>
        {ticks.slice().reverse().map((t) => (
          <div key={t.n} style={{ flex: 1, background: "#3b82f6", height: \`\${(t.load/max)*100}%\` }} />
        ))}
      </div>
    </main>
  );
}`,
					},
				],
			},
			{
				title: "Run + start ticking",
				blurb:
					"Open the URL in the browser. Click start; bars start dropping in every 2 seconds. Close the tab — the agent keeps ticking because the alarm is persistent, not tied to any websocket.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "command", text: "open http://localhost:8787/heartbeat/demo" },
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Each vertical bar is one tick. New ticks come in on the left; the chart scrolls right as the window fills.",
				screenshot: {
					label: "heartbeat — live bar chart",
					content: `  heartbeat — demo
  instance: demo · status: ticking every 2s
  [start 2s] [start 5s] [stop]

  load history (9 ticks)
  ┌──────────────────────────────────────────┐
  │        ▄                                 │
  │   █    █   ▆                             │
  │   █ ▇  █   █    █                        │
  │   █ █  █ ▆ █ ▃  █ ▂                      │
  │   █ █ ▅█ █ █ █▄ █ █  █                   │
  └──────────────────────────────────────────┘

  15:42:18  #9  load: 74.3%
  15:42:16  #8  load: 52.1%
  15:42:14  #7  load: 88.0%
  15:42:12  #6  load: 31.4%
  …`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- scheduler ---------------------------------------------------------
	{
		slug: "scheduler",
		title: "Scheduler showcase — carbon poller + reminders",
		description:
			"Two agents in one project: one polls the UK National Grid carbon-intensity API every minute via scheduleEvery(), the other accepts user-set reminders via schedule() and fires a system Notification when the time arrives. Demonstrates recurring + one-shot scheduling side by side.",
		tags: ["scheduling", "recurring", "fetch", "ui", "notifications"],
		status: "stable",
		exampleDir: "examples/scheduler",
		preview: {
			kind: "ui",
			caption: "current: 187 gCO₂/kWh — moderate · 4 reminders pending",
		},
		whatYoullLearn: [
			"How `scheduleEvery(seconds, \"method\")` installs a recurring DO alarm",
			"How `schedule(date, \"method\", payload)` installs a one-shot DO alarm",
			"How a recurring agent calls an external API and broadcasts results to the UI via setState",
			"How to wire `agent.state.fired` to the browser Notification API for system-level alerts",
			"How recurring + one-shot schedules survive worker restarts (alarms are persisted on the DO)",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Two agents, two schedule patterns",
				blurb:
					"Each folder is its own DO-backed agent. `carbon` self-drives on a recurring cadence (`scheduleEvery`); `reminders` schedules one-shot work in response to user input (`schedule`). Both ship a co-located `app.tsx`.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/counter" },
					{ kind: "command", text: "mkdir -p agents/carbon agents/reminders" },
				],
				treeTitle: "my-app/agents/",
				tree: [
					{
						type: "folder",
						name: "carbon",
						defaultOpen: true,
						highlight: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", note: "scheduleEvery → fetch" },
							{ type: "file", name: "app.tsx", kind: "tsx", note: "live bar chart" },
							{ type: "file", name: "docs.md", kind: "md" },
						],
					},
					{
						type: "folder",
						name: "reminders",
						defaultOpen: true,
						highlight: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", note: "schedule → fire" },
							{ type: "file", name: "app.tsx", kind: "tsx", note: "Notification API" },
							{ type: "file", name: "docs.md", kind: "md" },
						],
					},
				],
			},
			{
				title: "CarbonAgent — recurring schedule + external fetch",
				blurb:
					"`startPolling` cancels any existing schedule, fires one immediate tick (so the UI doesn't sit empty for a full interval), then installs a recurring schedule via `scheduleEvery(intervalSeconds, \"tick\")`. The framework writes the alarm to DO storage so it survives worker restarts.",
				files: [
					{
						path: "agents/carbon/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Sample = {
  fetchedAt: number;
  from: string; to: string;
  forecast: number;
  actual: number | null;
  index: string;
};

type State = {
  intervalSeconds: number;
  scheduleId: string | null;
  current: Sample | null;
  history: Sample[];
  error: string | null;
};

const CARBON_URL = "https://api.carbonintensity.org.uk/intensity";
const MAX_HISTORY = 60;

export default class CarbonAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    intervalSeconds: 0, scheduleId: null,
    current: null, history: [], error: null,
  };

  /** Recurring callback. Errors are stashed in state, not re-thrown. */
  async tick(): Promise<void> {
    try {
      const res = await fetch(CARBON_URL, { headers: { accept: "application/json" } });
      const body = await res.json() as { data: { from: string; to: string;
        intensity: { forecast: number; actual: number | null; index: string } }[] };
      const row = body.data[0]!;
      const sample: Sample = {
        fetchedAt: Date.now(),
        from: row.from, to: row.to,
        forecast: row.intensity.forecast,
        actual: row.intensity.actual,
        index: row.intensity.index,
      };
      this.setState({
        ...this.state,
        current: sample,
        history: [sample, ...this.state.history].slice(0, MAX_HISTORY),
        error: null,
      });
    } catch (err) {
      this.setState({ ...this.state, error: String(err) });
    }
  }

  async startPolling(intervalSeconds: number) {
    await this.stopPolling();
    await this.tick();                                          // fire once now
    const schedule = await this.scheduleEvery(intervalSeconds, "tick");
    this.setState({ ...this.state, intervalSeconds, scheduleId: schedule.id });
  }

  async stopPolling(): Promise<void> {
    if (this.state.scheduleId) {
      try { await this.cancelSchedule(this.state.scheduleId); } catch {}
    }
    this.setState({ ...this.state, intervalSeconds: 0, scheduleId: null });
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const body = await request.json() as { intervalSeconds?: number; stop?: boolean };
      if (body.stop) { await this.stopPolling(); return Response.json({ ok: true }); }
      await this.startPolling(body.intervalSeconds ?? 60);
      return Response.json({ ok: true, intervalSeconds: body.intervalSeconds ?? 60 });
    }
    return Response.json({ instance: this.name, ...this.state });
  }
}`,
						highlightLines: [33, 49, 57, 58, 60, 61, 62, 63],
					},
				],
			},
			{
				title: "RemindersAgent — one-shot schedule + persisted payload",
				blurb:
					"`this.schedule(due, \"fire\", payload)` registers a DO alarm for a specific moment in time and stores the payload alongside it. When the alarm fires, the framework calls `fire(payload)` and we move the reminder from `pending` to `fired`. Cancellation looks up the schedule by payload id via `getSchedules()`.",
				files: [
					{
						path: "agents/reminders/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Reminder = {
  id: string; text: string;
  createdAt: number; due: number;
  firedAt?: number;
};

type State = { pending: Reminder[]; fired: Reminder[] };

export default class RemindersAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { pending: [], fired: [] };

  /** Scheduler callback — runs at the scheduled \`due\` instant. */
  async fire(reminder: Reminder): Promise<void> {
    this.setState({
      pending: this.state.pending.filter((r) => r.id !== reminder.id),
      fired: [{ ...reminder, firedAt: Date.now() }, ...this.state.fired].slice(0, 50),
    });
  }

  async createReminder(text: string, inSeconds: number): Promise<Reminder> {
    const due = new Date(Date.now() + inSeconds * 1000);
    const reminder: Reminder = {
      id: crypto.randomUUID(), text,
      createdAt: Date.now(), due: due.getTime(),
    };
    await this.schedule(due, "fire", reminder);                 // ← one-shot
    this.setState({
      pending: [...this.state.pending, reminder],
      fired: this.state.fired,
    });
    return reminder;
  }

  async cancelReminder(id: string) {
    for (const s of this.getSchedules()) {
      const payload = s.payload as unknown as Reminder | undefined;
      if (payload?.id === id) await this.cancelSchedule(s.id).catch(() => {});
    }
    this.setState({
      pending: this.state.pending.filter((r) => r.id !== id),
      fired: this.state.fired,
    });
  }
  /* ... onRequest dispatches POST/DELETE to the methods above ... */
}`,
						highlightLines: [15, 16, 28, 38, 39],
					},
				],
			},
			{
				title: "Wire fired reminders to system Notifications",
				blurb:
					"The agent itself doesn't send push notifications — it persists the fired reminder and broadcasts the state change. The UI listens via `useAgent`, dedupes new entries against a `Set` of seen ids, and pops `new Notification(...)` for each new one. Works as long as the tab is open. (Real Web Push needs a service worker + VAPID — out of scope here, see `docs.md`.)",
				files: [
					{
						path: "agents/reminders/app.tsx",
						lang: "tsx",
						code: `import { useEffect, useRef, useState } from "react";
import { useAgent } from "@ayjnt/reminders";

export default function RemindersApp() {
  const agent = useAgent();
  const fired = agent.state?.fired ?? [];
  const [permission, setPermission] = useState(Notification.permission);

  // Dedupe so React strict-mode double-effects don't fire twice.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (permission !== "granted") return;
    for (const r of fired) {
      if (seen.current.has(r.id)) continue;
      seen.current.add(r.id);
      new Notification("Reminder", { body: r.text, tag: r.id });
    }
  }, [fired, permission]);

  return (
    <main>
      {permission !== "granted" && (
        <button onClick={async () => setPermission(await Notification.requestPermission())}>
          allow notifications
        </button>
      )}
      {/* ...form to set reminders + lists for pending/fired... */}
    </main>
  );
}`,
						highlightLines: [10, 12, 13, 14, 15, 16, 17, 18],
					},
				],
			},
			{
				title: "Run it",
				blurb:
					"Open the carbon UI, click start, and the agent installs a recurring schedule that fetches the live UK grid sample every minute. Open the reminders UI, allow notifications, set a reminder for 30s — watch it move from pending to fired and pop a system notification.",
				terminal: [
					{ kind: "command", text: "bun install" },
					{ kind: "command", text: "bun run dev" },
					{ kind: "output", text: "✓ ayjnt: 2 agent(s), 2 with UI, 2 with docs → .ayjnt/dist/wrangler.jsonc" },
					{ kind: "output", text: "⎔ Listening on http://localhost:8787" },
					{ kind: "blank" },
					{ kind: "command", text: "open http://localhost:8787/carbon/main" },
					{ kind: "command", text: "open http://localhost:8787/reminders/me" },
					{ kind: "blank" },
					{ kind: "command", text: "# or set a reminder via curl" },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/reminders/me \\",
					},
					{
						kind: "command",
						text: "  -d '{\"text\":\"check the kettle\",\"in\":30}'",
					},
					{
						kind: "success",
						text: '{ "ok":true, "reminder":{ "id":"…", "text":"check the kettle", "due":… }, "msFromNow":30000 }',
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Two agents, two scheduling patterns, one URL each. Both agents broadcast state changes to their UIs through the same `setState` → WebSocket pipe — the UI does no polling on its own.",
				screenshot: {
					label: "/carbon/main and /reminders/me side by side",
					content: `┌─ /carbon/main ────────────────────────┐  ┌─ /reminders/me ──────────────────────┐
│ UK Grid Carbon Intensity              │  │ Reminders                            │
│                                       │  │                                      │
│  ┌─────────────────────────────────┐  │  │ instance: me · 1 pending · 2 fired   │
│  │ 187 gCO₂/kWh                    │  │  │                                      │
│  │ MODERATE · forecast 187         │  │  │ [check the kettle____] [in 30s] [SET]│
│  │ window 14:30 — 15:00            │  │  │                                      │
│  │ fetched 12s ago                 │  │  │ pending                              │
│  └─────────────────────────────────┘  │  │  ┌─ check the kettle  fires in 19s ┐ │
│                                       │  │  │                          [cancel]│ │
│ [start (60s)] [start (15s, demo)]     │  │  └────────────────────────────────┘  │
│ [stop]        [clear history]         │  │                                      │
│                                       │  │ fired (2)                            │
│ forecast history (8 samples)          │  │  ┌─ take out the bins  just now    ┐ │
│  ▁▂▃▃▄▅▅▆ █  ← bar chart, by index    │  │  └────────────────────────────────┘  │
│                                       │  │  ┌─ stand up           5m ago      ┐ │
│ 14:32:01  [moderate]  forecast 187    │  │  └────────────────────────────────┘  │
│ 14:31:01  [moderate]  forecast 184    │  │                                      │
│ 14:30:01  [low]       forecast 142    │  │  💬 OS notification: "Reminder —     │
│ ...                                   │  │     take out the bins"               │
└───────────────────────────────────────┘  └──────────────────────────────────────┘`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- chat-rooms --------------------------------------------------------
	{
		slug: "chat-rooms",
		title: "Agent chat rooms with UI",
		description:
			"Multi-user realtime chat. One DO per room, broadcast via the Agents connection API, co-located React UI with presence + typing indicators — demonstrates the state-sync vs broadcast trade-off.",
		tags: ["websocket", "realtime", "ui"],
		status: "stable",
		exampleDir: "examples/chat-rooms",
		preview: { kind: "ui", caption: "#general — 3 online" },
		whatYoullLearn: [
			"WebSocket lifecycle: `onConnect`, `onMessage`, `onClose`",
			"Per-connection state via `conn.setState({ name })`",
			"When to use state sync (persistent) vs `broadcast()` (ephemeral)",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Replace counter/ with room/",
				blurb:
					"One folder, one room class. Path segments after /room/ are separate DOs, so /room/general and /room/random are independent rooms with their own history and presence.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/counter" },
					{ kind: "command", text: "mkdir agents/room" },
				],
			},
			{
				title: "agents/room/agent.ts — history + broadcast",
				blurb:
					"The SDK's `Agent` extends partyserver's `Server`, which gives you `onConnect`, `onMessage`, `onClose`, plus `this.broadcast(msg, without?)` and `this.getConnections()`. State sync carries history + presence (new connections see them on join); broadcast carries transient events like typing indicators.",
				files: [
					{
						path: "agents/room/agent.ts",
						lang: "ts",
						code: `import { Agent, type Connection, type WSMessage } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Message = { id: string; from: string; text: string; at: number };
type State = { messages: Message[]; members: string[] };

type ClientFrame =
  | { kind: "hello"; name: string }
  | { kind: "say"; text: string }
  | { kind: "typing"; on: boolean };

export default class RoomAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { messages: [], members: [] };

  override async onConnect(conn: Connection) {
    conn.setState({ name: null });   // anonymous until \`hello\`
  }

  override async onMessage(conn: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    const frame = JSON.parse(message) as ClientFrame;
    const name = (conn.state as { name: string | null } | null)?.name;

    switch (frame.kind) {
      case "hello": {
        conn.setState({ name: frame.name });
        this.refreshMembers();
        break;
      }
      case "say": {
        if (!name) return;
        const msg = { id: crypto.randomUUID(), from: name, text: frame.text, at: Date.now() };
        this.setState({ ...this.state, messages: [...this.state.messages, msg].slice(-100) });
        break;
      }
      case "typing": {
        if (!name) return;
        // Transient — broadcast, don't persist. Skip the sender by passing [conn.id].
        this.broadcast(JSON.stringify({ kind: "typing", from: name, on: frame.on }), [conn.id]);
        break;
      }
    }
  }

  override async onClose() { this.refreshMembers(); }

  private refreshMembers() {
    const names = new Set<string>();
    for (const c of this.getConnections()) {
      const n = (c.state as { name: string | null } | null)?.name;
      if (n) names.add(n);
    }
    const members = Array.from(names).sort();
    this.setState({ ...this.state, members });
  }

  override async onRequest() { return Response.json({ instance: this.name, ...this.state }); }
}`,
						highlightLines: [15, 19, 38, 39],
					},
				],
			},
			{
				title: "agents/room/app.tsx — UI",
				blurb:
					"`useAgent()` reads state (history + members). `agent.send(JSON.stringify(...))` writes frames back to the server. The component also passes an `onMessage` callback to catch broadcast frames (typing indicators) that don't live in state.",
				files: [
					{
						path: "agents/room/app.tsx",
						lang: "tsx",
						code: `import { useEffect, useState } from "react";
import { useAgent } from "@ayjnt/room";

export default function Room() {
  const [name] = useState(() => prompt("name?") ?? "guest");
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState<Record<string, true>>({});

  const agent = useAgent({
    onMessage: (e: MessageEvent) => {
      try {
        const m = JSON.parse(e.data as string);
        if (m.kind === "typing") {
          setTyping((t) => m.on ? { ...t, [m.from]: true } : (({ [m.from]: _, ...rest }) => rest)(t));
        }
      } catch { /* not ours */ }
    },
  });

  useEffect(() => { agent.send(JSON.stringify({ kind: "hello", name })); }, [agent, name]);

  const send = () => {
    if (!draft.trim()) return;
    agent.send(JSON.stringify({ kind: "say", text: draft.trim() }));
    agent.send(JSON.stringify({ kind: "typing", on: false }));
    setDraft("");
  };

  const messages = agent.state?.messages ?? [];
  const members = agent.state?.members ?? [];
  const typingNames = Object.keys(typing).filter((n) => n !== name);

  return (
    <main>
      <h1>#{agent.name}</h1>
      <div>online: {members.join(", ")}</div>
      <ul>{messages.map((m) => <li key={m.id}><b>{m.from}:</b> {m.text}</li>)}</ul>
      <div>{typingNames.length ? \`\${typingNames.join(", ")} typing…\` : ""}</div>
      <input value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          agent.send(JSON.stringify({ kind: "typing", on: e.target.value.length > 0 }));
        }}
        onKeyDown={(e) => e.key === "Enter" && send()} />
      <button onClick={send}>send</button>
    </main>
  );
}`,
					},
				],
			},
			{
				title: "State sync vs broadcast — the trade-off",
				blurb:
					"If you tried to drive typing indicators through state, every new connection would see 'alice typing' frozen in time, and every keystroke would re-snapshot the entire messages array. Broadcast is the right tool for events that shouldn't persist.",
				files: [
					{
						path: "trade-off.ts",
						lang: "ts",
						code: `// setState(...) ─┬─ persisted on the DO
//                ├─ sent to every new connection at connect time
//                ├─ ships a state diff to every live connection
//                └─ use for: history, members, anything a fresh tab should see
//
// this.broadcast(JSON.stringify(...)) ─┬─ fire-and-forget to live sockets only
//                                      ├─ not persisted
//                                      ├─ skip sender by passing [conn.id]
//                                      └─ use for: typing, presence pulses, game events
`,
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Open /room/general in two tabs, pick different names. Messages sync both ways; typing indicator shows for the other party; shared presence list updates in seconds.",
				screenshot: {
					label: "two tabs, one room",
					content: `  tab 1 (alice)                  tab 2 (bob)
  ┌────────────────────────┐    ┌────────────────────────┐
  │ #general               │    │ #general               │
  │ you: alice · 2 online  │    │ you: bob   · 2 online  │
  │ [alice] [bob]          │    │ [alice] [bob]          │
  ├────────────────────────┤    ├────────────────────────┤
  │ alice  hi everyone     │    │ alice  hi everyone     │
  │ bob    oh hey!         │    │ bob    oh hey!         │
  │ alice  what's up       │    │ alice  what's up       │
  │                        │    │ alice is typing…       │
  │ [ about to send… ]     │    │                        │
  └────────────────────────┘    └────────────────────────┘
           │                              ▲
           │ JSON.stringify(              │
           │   { kind:"typing", on:true } │
           │ ) over WebSocket             │
           ▼                              │
        server broadcast() → bob ─────────┘`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- ai-chatbot --------------------------------------------------------
	{
		slug: "ai-chatbot",
		title: "AI chatbot (Gemini)",
		description:
			"Streaming chatbot backed by Google Gemini. The DO holds the conversation; the React UI subscribes to state and renders incrementally as setState ticks every SSE chunk. No streaming plumbing in the client.",
		tags: ["llm", "streaming", "ui"],
		status: "stable",
		exampleDir: "examples/ai-chatbot",
		preview: { kind: "ui", caption: "gemini streams via setState" },
		whatYoullLearn: [
			"How `ctx.waitUntil` lets the agent stream work after the HTTP response returns",
			"How to turn SSE chunks into setState updates that the UI renders incrementally",
			"Adding secrets via `.dev.vars` without editing the generated wrangler config",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Replace counter/ with chat/, add Gemini key",
				blurb:
					"`.dev.vars` is wrangler-native — put env vars there for `bun run dev`, and they appear as `c.env.*`. `.dev.vars` is gitignored by the scaffold's .gitignore. For deploys you use `wrangler secret put`.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/counter" },
					{ kind: "command", text: "mkdir agents/chat" },
					{
						kind: "command",
						text: "echo 'GOOGLE_API_KEY=AIza…' > .dev.vars",
					},
				],
			},
			{
				title: "agents/chat/agent.ts — streaming into state",
				blurb:
					"Three things make this work: (1) POST returns immediately after kicking off streaming; (2) `ctx.waitUntil` keeps the worker alive long enough for the stream to finish; (3) each SSE chunk calls setState to append to the in-flight assistant message. State sync ships diffs to every connected tab.",
				files: [
					{
						path: "agents/chat/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Message = { id: string; role: "user" | "assistant"; text: string; at: number };
type State = { messages: Message[]; streaming: boolean; streamingId: string | null };

export default class ChatAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { messages: [], streaming: false, streamingId: null };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ instance: this.name, ...this.state });

    const { text } = (await request.json()) as { text: string };
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text, at: Date.now() };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", text: "", at: Date.now() };

    this.setState({
      messages: [...this.state.messages, userMsg, assistantMsg],
      streaming: true, streamingId: assistantId,
    });

    // Fire-and-forget: HTTP returns now, generation continues in the background.
    // ctx.waitUntil keeps the worker alive until the promise resolves.
    this.ctx.waitUntil(this.streamReply(assistantId));

    return Response.json({ ok: true, assistantId });
  }

  private async streamReply(assistantId: string) {
    const history = this.state.messages
      .filter((m) => m.id !== assistantId)
      .map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));

    const url = \`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=\${this.env.GOOGLE_API_KEY}\`;
    const res = await fetch(url, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ contents: history }) });

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            this.setState({
              ...this.state,
              messages: this.state.messages.map((m) =>
                m.id === assistantId ? { ...m, text: m.text + text } : m),
            });
          }
        } catch { /* chunk boundary; keep buffering */ }
      }
    }
    this.setState({ ...this.state, streaming: false, streamingId: null });
  }
}`,
						highlightLines: [24, 37, 46, 47],
					},
				],
			},
			{
				title: "agents/chat/app.tsx — UI that renders incrementally",
				blurb:
					"The UI doesn't care about streaming. It reads state, renders messages, disables input while `state.streaming` is true. The realtime feel comes from state sync firing every chunk.",
				files: [
					{
						path: "agents/chat/app.tsx",
						lang: "tsx",
						code: `import { useState } from "react";
import { useAgent } from "@ayjnt/chat";

export default function Chat() {
  const agent = useAgent();
  const [draft, setDraft] = useState("");
  const messages = agent.state?.messages ?? [];
  const streaming = agent.state?.streaming ?? false;

  const send = async () => {
    if (!draft.trim() || streaming) return;
    const text = draft; setDraft("");
    await fetch(window.location.pathname, { method: "POST", body: JSON.stringify({ text }) });
  };

  return (
    <main>
      <h1>chat — {agent.name}</h1>
      {messages.map((m) => (
        <div key={m.id} className={m.role}>
          <b>{m.role}:</b> {m.text}{m.id === agent.state?.streamingId && <span>▍</span>}
        </div>
      ))}
      <input disabled={streaming} value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()} />
    </main>
  );
}`,
					},
				],
			},
			{
				title: "Run + ask a question",
				blurb:
					"Bun dev picks up `.dev.vars` automatically (wrangler convention). Open the URL, ask something, watch tokens land in the assistant bubble.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{
						kind: "command",
						text: "open http://localhost:8787/chat/demo",
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"The assistant bubble fills in word by word with a caret. The input is disabled until streaming completes. Open the same URL in a second tab — the streaming text appears there simultaneously.",
				screenshot: {
					label: "/chat/demo — streaming",
					content: `  ┌──────────────────────────────────────────────────────┐
  │ chat — demo                       [new conversation] │
  ├──────────────────────────────────────────────────────┤
  │                                                      │
  │  USER                                                │
  │  tell me a haiku about cloudflare workers            │
  │                                                      │
  │                                          ASSISTANT    │
  │                     Isolates in flight,               │
  │                     Milliseconds bloom like           │
  │                     code at every edge ▍              │
  │                                                      │
  ├──────────────────────────────────────────────────────┤
  │ [thinking…]                                   [send] │
  └──────────────────────────────────────────────────────┘
                          ↑
           state.messages[-1].text grows every
           setState() call — one per SSE chunk`,
				},
			},
			{
				title: "Deploy — wrangler secret put",
				blurb:
					"For production, put the key into wrangler's secret store. Same env variable name; same code path — no branch needed for dev vs deploy.",
				terminal: [
					{
						kind: "command",
						text: "wrangler secret put GOOGLE_API_KEY",
					},
					{ kind: "output", text: "? Enter a secret value › ••••••••" },
					{ kind: "blank" },
					{ kind: "command", text: "bun run deploy" },
					{
						kind: "success",
						text: "✓ deployed https://my-app.<account>.workers.dev",
					},
				],
			},
		],
	},

	// --- agentic-rag -------------------------------------------------------
	{
		slug: "agentic-rag",
		title: "Agentic RAG",
		description:
			"A two-agent retrieval pipeline. QA agent decomposes the question, fans out retrievals to the Index agent over typed RPC, then composes a grounded answer. Workers AI for both embeddings and generation.",
		tags: ["rag", "multi-agent", "workers-ai"],
		status: "stable",
		exampleDir: "examples/agentic-rag",
		preview: {
			kind: "diagram",
			nodes: ["QA · planner", "Index · vectors", "QA · composer"],
		},
		whatYoullLearn: [
			"Typed cross-agent RPC with `getAgent<T>` for multi-agent pipelines",
			"Cosine-similarity over Workers AI embeddings (bge-base-en)",
			"Calling Workers AI through the HTTP API when bindings aren't available",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Two agents, two roles",
				blurb:
					"Index holds an in-memory vector store per corpus (/index/policies, /index/recipes). QA orchestrates plan → retrieve → compose. They talk over typed RPC — `getAgent<IndexAgent>` returns a DO stub with method autocomplete.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/alive" },
					{ kind: "command", text: "mkdir -p agents/index agents/qa" },
					{
						kind: "command",
						text: "echo 'CF_ACCOUNT_ID=…\\nCF_API_TOKEN=…' > .dev.vars",
					},
				],
				treeTitle: "my-app/agents/",
				tree: [
					{
						type: "folder",
						name: "index",
						defaultOpen: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", highlight: true },
						],
					},
					{
						type: "folder",
						name: "qa",
						defaultOpen: true,
						children: [
							{ type: "file", name: "agent.ts", kind: "ts", highlight: true },
						],
					},
					{ type: "file", name: "shared.ts", kind: "ts", highlight: true, note: "Workers AI helper" },
				],
			},
			{
				title: "agents/shared.ts — Workers AI over HTTP",
				blurb:
					"ayjnt's wrangler.jsonc generator doesn't yet support custom bindings like `AI`, so we hit the Workers AI HTTP API directly. Two secrets: `CF_ACCOUNT_ID` and `CF_API_TOKEN` (needs \"Workers AI: Read\"). For deploy: `wrangler secret put` each.",
				files: [
					{
						path: "agents/shared.ts",
						lang: "ts",
						code: `type AiEnv = { CF_ACCOUNT_ID?: string; CF_API_TOKEN?: string };

export async function runWorkersAi<T = unknown>(env: AiEnv, model: string, body: unknown): Promise<T> {
  const acct = env.CF_ACCOUNT_ID, token = env.CF_API_TOKEN;
  if (!acct || !token) throw new Error("CF_ACCOUNT_ID and CF_API_TOKEN must be set");

  const url = \`https://api.cloudflare.com/client/v4/accounts/\${acct}/ai/run/\${model}\`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: \`Bearer \${token}\` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(\`Workers AI \${res.status}: \${await res.text()}\`);
  const json = await res.json() as { success?: boolean; result?: T };
  if (!json.success || json.result === undefined) throw new Error("Workers AI returned non-success");
  return json.result;
}`,
					},
				],
			},
			{
				title: "agents/index/agent.ts — vector store on a DO",
				blurb:
					"Each doc is { id, text, embedding } stored in state. `addDoc(text)` embeds via bge-base-en (768-dim); `search(query, k)` cosines all docs and returns the top k. Both are callable via typed RPC from the QA agent.",
				files: [
					{
						path: "agents/index/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";
import { runWorkersAi } from "../shared.ts";

type Doc = { id: string; text: string; embedding: number[] };
type State = { docs: Doc[] };

export default class IndexAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { docs: [] };

  async addDoc(text: string): Promise<{ id: string }> {
    const embedding = await this.embed(text.trim());
    const id = crypto.randomUUID();
    this.setState({ docs: [...this.state.docs, { id, text: text.trim(), embedding }] });
    return { id };
  }

  async search(query: string, k = 3): Promise<{ id: string; text: string; score: number }[]> {
    if (this.state.docs.length === 0) return [];
    const q = await this.embed(query);
    return this.state.docs
      .map((d) => ({ id: d.id, text: d.text, score: cosine(q, d.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  private async embed(text: string): Promise<number[]> {
    const r = await runWorkersAi<{ data: number[][] }>(this.env, "@cf/baai/bge-base-en-v1.5", { text: [text] });
    return r.data[0]!;
  }

  // onRequest / DELETE / cosine() elided for brevity — see examples/agentic-rag
  override async onRequest() { return Response.json({ instance: this.name, count: this.state.docs.length }); }
}
function cosine(a: number[], b: number[]) { /* … standard cosine … */ return 0; }`,
						highlightLines: [11, 18, 22],
					},
				],
			},
			{
				title: "agents/qa/agent.ts — plan → retrieve → compose",
				blurb:
					"Three steps in one method: (1) llama decomposes the question into 2-3 subqueries; (2) for each subquery, call Index.search via typed RPC; (3) llama composes a grounded answer from the union of evidence. The whole trace (plan + hits + answer) gets stored in state for replay.",
				files: [
					{
						path: "agents/qa/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type { GeneratedEnv } from "@ayjnt/env";
import type IndexAgent from "../index/agent.ts";
import { runWorkersAi } from "../shared.ts";

export default class QAAgent extends Agent<GeneratedEnv, { history: any[]; pending: boolean }> {
  override initialState = { history: [], pending: false };

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ instance: this.name, ...this.state });
    const { question } = (await request.json()) as { question: string };
    this.setState({ ...this.state, pending: true });

    const plan = await this.plan(question);
    const index = await getAgent<IndexAgent>(this.env.INDEX_AGENT, "main");
    const hits = await Promise.all(plan.map(async (sub) => ({ sub, docs: await index.search(sub, 3) })));
    const evidence = hits.flatMap((h) => h.docs.map((d) => d.text))
      .filter((t, i, a) => a.indexOf(t) === i).join("\\n\\n---\\n\\n");
    const answer = await this.compose(question, evidence);

    const qa = { id: crypto.randomUUID(), question, plan, hits, answer, at: Date.now() };
    this.setState({ history: [...this.state.history, qa], pending: false });
    return Response.json({ ok: true, qa });
  }

  private async plan(question: string): Promise<string[]> {
    const r = await runWorkersAi<{ response: string }>(this.env, "@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "Return ONLY a JSON array of 2-3 search queries." },
        { role: "user", content: question },
      ],
    });
    const m = r.response.match(/\\[[^\\]]*\\]/);
    try { return m ? JSON.parse(m[0]) : [question]; } catch { return [question]; }
  }

  private async compose(question: string, evidence: string) {
    const r = await runWorkersAi<{ response: string }>(this.env, "@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "Answer using ONLY the context. Be concise. Say so if insufficient." },
        { role: "user", content: \`CONTEXT:\\n\${evidence}\\n\\nQUESTION:\\n\${question}\` },
      ],
    });
    return r.response.trim();
  }
}`,
						highlightLines: [16, 17, 18, 19, 20],
					},
				],
			},
			{
				title: "Run + index + ask",
				blurb:
					"POST to /index to embed documents, POST to /qa to ask. The response includes the plan and the top hits per subquery so you can see how the LLM decomposed the question.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "blank" },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/index/main -d '{\"docs\":[\"Cloudflare Workers run V8 isolates…\", \"Durable Objects provide strongly consistent stateful objects…\", …]}'",
					},
					{ kind: "success", text: '{ "ok":true, "indexed":8 }' },
					{ kind: "blank" },
					{
						kind: "command",
						text: "curl -X POST localhost:8787/qa/session-1 -d '{\"question\":\"What is ayjnt?\"}'",
					},
					{
						kind: "success",
						text: '{ "ok":true, "qa":{ "plan":["what is ayjnt","how ayjnt uses DOs",…], "hits":[…], "answer":"ayjnt is…" } }',
					},
				],
			},
			{
				title: "What it looks like",
				blurb:
					"The trace is the interesting output. You can see what the planner decomposed the question into, which docs each subquery surfaced, and how the composer grounded the final answer.",
				screenshot: {
					label: "pipeline trace",
					content: `  question:  What is ayjnt and how does it use Durable Objects?
  ────────────────────────────────────────────────────────────
  plan:                                          │
    • what is ayjnt                              │ (llama-3.1)
    • how does ayjnt use durable objects         │
    • durable objects cloudflare workers         │
                                                 │
  retrieve (getAgent<IndexAgent>.search):        │
    for "what is ayjnt":                         │
      [0.87]  ayjnt is a Cloudflare-Workers-nat…│
      [0.67]  An ayjnt agent's URL is derived…  │
    for "how ayjnt uses durable objects":        │
      [0.80]  ayjnt is a Cloudflare-Workers-nat…│
      [0.63]  Durable Objects provide single-i…│
                                                 │
  compose:                                       │
    ayjnt is a framework for Cloudflare Workers  │ (llama-3.1)
    where each folder under agents/ becomes a    │
    Durable Object class. The framework auto-    │
    generates the worker entry point and         │
    wrangler config from the file tree. Each DO  │
    is a single-instance, strongly consistent    │
    stateful object running on the edge.`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- space-game --------------------------------------------------------
	{
		slug: "space-game",
		title: "Multiplayer space game",
		description:
			"Asteroid-field shooter. One Durable Object owns the world, runs a 30Hz physics tick, and broadcasts the entire state every frame. Clients send keyboard inputs and render the canvas from state.",
		tags: ["realtime", "game", "multiplayer"],
		status: "stable",
		exampleDir: "examples/space-game",
		preview: { kind: "game", caption: "SECTOR 7-G" },
		whatYoullLearn: [
			"Running a real setInterval physics loop inside a Durable Object",
			"Authoritative server + dumb clients — send inputs, render state",
			"Why 30Hz state sync is fine for 12 ships but not for AAA production",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Replace counter/ with sector/",
				blurb:
					"One DO per /sector/<name> — /sector/7-G and /sector/9 are independent games. Ships are tracked by connection id. Asteroids and bullets live in state.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/counter" },
					{ kind: "command", text: "mkdir agents/sector" },
				],
			},
			{
				title: "agents/sector/agent.ts — physics on the DO",
				blurb:
					"The physics loop is a real `setInterval` inside the DO. The DO is alive as long as there's an open WebSocket, so the loop survives request boundaries. `ensureLoop()` starts it on first connect; `stopLoop()` tears down on last disconnect so the alarm bill doesn't pile up.",
				files: [
					{
						path: "agents/sector/agent.ts",
						lang: "ts",
						code: `import { Agent, type Connection, type WSMessage } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

const WORLD = { w: 800, h: 600 };
const TICK_HZ = 30;

type Ship = { id: string; name: string; x: number; y: number; vx: number; vy: number; a: number; thrust: boolean; left: boolean; right: boolean; kills: number; deaths: number; nextShotAt: number; respawnedAt: number; };
type State = { ships: Ship[]; bullets: unknown[]; asteroids: unknown[]; lastTick: number };

export default class SectorAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { ships: [], bullets: [], asteroids: [], lastTick: 0 };
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  override async onConnect(conn: Connection) {
    this.seedAsteroids();
    this.setState({ ...this.state, ships: [...this.state.ships, this.spawn(conn.id, "guest")] });
    this.ensureLoop();
  }

  override async onMessage(conn: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    const frame = JSON.parse(message);
    // handle hello / input / fire — see examples/space-game for full code
  }

  override async onClose(conn: Connection) {
    this.setState({ ...this.state, ships: this.state.ships.filter((s) => s.id !== conn.id) });
    if (this.state.ships.length === 0) this.stopLoop();
  }

  private ensureLoop() {
    if (this.loopHandle) return;
    this.loopHandle = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }
  private stopLoop() { if (this.loopHandle) clearInterval(this.loopHandle); this.loopHandle = null; }

  private tick() {
    // integrate ships, advance bullets, collide, setState(world)
  }

  private spawn(id: string, name: string): Ship { /* random edge, random heading */ return {} as Ship; }
  private seedAsteroids() { /* 12 drifting asteroids if state empty */ }

  override async onRequest() { return Response.json({ instance: this.name, ...this.state }); }
}`,
						highlightLines: [12, 14, 15, 30, 31, 32],
					},
				],
			},
			{
				title: "agents/sector/app.tsx — canvas renderer",
				blurb:
					"Clients are display + input. On state change (30Hz), re-draw the canvas from `agent.state`. Keyboard handler only sends deltas — when a key's flag changes, it ships one input frame.",
				files: [
					{
						path: "agents/sector/app.tsx",
						lang: "tsx",
						code: `import { useEffect, useRef, useState } from "react";
import { useAgent } from "@ayjnt/sector";

export default function Game() {
  const [name] = useState(() => prompt("pilot?") ?? "guest");
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const agent = useAgent();
  const input = useRef({ thrust: false, left: false, right: false });

  useEffect(() => { agent.send(JSON.stringify({ kind: "hello", name })); }, [agent, name]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => update(e.key, true);
    const up = (e: KeyboardEvent) => update(e.key, false);
    function update(key: string, on: boolean) {
      const i = input.current;
      let changed = false;
      if (key === "w" || key === "ArrowUp") { if (i.thrust !== on) { i.thrust = on; changed = true; } }
      else if (key === "a" || key === "ArrowLeft") { if (i.left !== on) { i.left = on; changed = true; } }
      else if (key === "d" || key === "ArrowRight") { if (i.right !== on) { i.right = on; changed = true; } }
      else if (key === " " && on) { agent.send(JSON.stringify({ kind: "fire" })); return; }
      if (changed) agent.send(JSON.stringify({ kind: "input", ...i }));
    }
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [agent]);

  useEffect(() => {
    /* draw asteroids, bullets, ships from agent.state onto canvas */
  });

  return <canvas ref={canvas} width={800} height={600} tabIndex={0} />;
}`,
						highlightLines: [13, 14, 27],
					},
				],
			},
			{
				title: "Run + open two browsers",
				blurb:
					"One tab per pilot. W/↑ thrust, A/D turn, SPACE fire. Your ship is green, others are blue. Leaderboard in the HUD tracks kills/deaths across tabs.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "command", text: "open http://localhost:8787/sector/7-G  # alice" },
					{ kind: "command", text: "open http://localhost:8787/sector/7-G  # bob" },
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Two ships on the same canvas. Server is authoritative — if you edit `agent.state.ships[0].x = 10000` in DevTools, it snaps back on the next tick because the server overwrites client state on every setState.",
				screenshot: {
					label: "SECTOR 7-G — 2 pilots",
					content: `  ┌──────────── SECTOR 7-G  2 pilots ────────────┐
  │                                                │
  │        ○               ·        ◯              │
  │                                                │
  │           ▷ alice                              │
  │                      ·    ·                    │
  │         ·                                      │
  │                        ▷ bob                   │
  │                          →→→ .                 │
  │    ○                           ·               │
  │                                                │
  │              ·     ○                  ○        │
  └────────────────────────────────────────────────┘
   [W/↑] thrust  [A D] turn  [SPACE] fire

   pilot   kills   deaths
   alice     3       1
   bob       1       3

   ▷ you  ▷ others  · bullet  ○ asteroid`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- chess -------------------------------------------------------------
	{
		slug: "chess",
		title: "Chess game",
		description:
			"Two-player chess with turn enforcement + legal-move validation server-side and a React board synced via useAgent. A study in constraining client-side mutations.",
		tags: ["realtime", "game", "2p"],
		status: "stable",
		exampleDir: "examples/chess",
		preview: { kind: "game", caption: "♚  ♛  ♜  ♝  ♞  ♟" },
		whatYoullLearn: [
			"Constraining client-side mutations: validate on the server, echo state",
			"Seat claiming via connection id, freeing seats in `onClose`",
			"When to auto-queen promote vs require a follow-up frame",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Replace counter/ with match/",
				blurb:
					"One DO per /match/<name>. Two seats (white, black), any number of spectators. Seats are bound to connection ids; they open up automatically when a player disconnects.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/counter" },
					{ kind: "command", text: "mkdir agents/match" },
				],
			},
			{
				title: "agents/match/agent.ts — validation shape",
				blurb:
					"Clients propose intents: `{ kind: \"move\", from: 52, to: 36 }`. The server validates (piece belongs to you, right turn, legal move) and only then mutates state. Everything about the game — board, turn, history, result — lives in DO state and syncs to every connected tab.",
				files: [
					{
						path: "agents/match/agent.ts",
						lang: "ts",
						code: `import { Agent, type Connection, type WSMessage } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Piece = { color: "w" | "b"; type: "K" | "Q" | "R" | "B" | "N" | "P" };
type State = {
  board: (Piece | null)[];
  toMove: "w" | "b";
  white: string | null; black: string | null;
  whiteName: string | null; blackName: string | null;
  history: { from: number; to: number; san: string }[];
  result: "white" | "black" | "draw" | null;
};

export default class MatchAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = freshState();

  override async onConnect(conn: Connection) { conn.setState({ name: null }); }

  override async onMessage(conn: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    const frame = JSON.parse(message);
    if (frame.kind === "join") { /* bind seat by connection id */ }
    if (frame.kind === "move" && !this.state.result) {
      const side = sideOf(conn.id, this.state);
      if (!side || side !== this.state.toMove) return;                          // wrong turn
      const check = validateMove(this.state.board, frame.from, frame.to, side);
      if (!check.ok) return;                                                    // illegal
      const piece = this.state.board[frame.from]!;
      const capture = this.state.board[frame.to];
      const board = [...this.state.board];
      board[frame.to] = piece; board[frame.from] = null;
      this.setState({ ...this.state, board,
        toMove: side === "w" ? "b" : "w",
        history: [...this.state.history, { from: frame.from, to: frame.to, san: square(frame.to) }],
        result: capture?.type === "K" ? (side === "w" ? "white" : "black") : null });
    }
  }

  override async onClose(conn: Connection) { /* open the seat if this was a player */ }
  override async onRequest() { return Response.json({ instance: this.name, ...this.state }); }
}
function freshState(): State { /* 32 pieces in starting position */ return {} as State; }
function sideOf(id: string, s: State) { return id === s.white ? "w" : id === s.black ? "b" : null; }
function validateMove(board: any, from: number, to: number, side: "w"|"b") { return { ok: true }; }
function square(i: number) { return "abcdefgh"[i % 8] + String(8 - Math.floor(i / 8)); }`,
						highlightLines: [23, 24, 25, 26],
					},
				],
			},
			{
				title: "agents/match/app.tsx — click-to-move board",
				blurb:
					"Click a piece to select, click a destination to move. The UI never mutates board state locally — it just sends `{ kind: \"move\", from, to }`. If the move is illegal, the server drops it silently and the UI shows no change.",
				files: [
					{
						path: "agents/match/app.tsx",
						lang: "tsx",
						code: `import { useState } from "react";
import { useAgent } from "@ayjnt/match";

const GLYPH: Record<string, string> = { wK:"♔", wQ:"♕", wR:"♖", wB:"♗", wN:"♘", wP:"♙", bK:"♚", bQ:"♛", bR:"♜", bB:"♝", bN:"♞", bP:"♟" };

export default function Match() {
  const agent = useAgent();
  const [selected, setSelected] = useState<number | null>(null);
  const state = agent.state;
  if (!state) return null;

  const click = (i: number) => {
    if (selected === null) { if (state.board[i]) setSelected(i); return; }
    agent.send(JSON.stringify({ kind: "move", from: selected, to: i }));
    setSelected(null);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 40px)" }}>
      {state.board.map((p, i) => (
        <button key={i} onClick={() => click(i)}
          style={{ background: (Math.floor(i/8) + i%8) % 2 ? "#b58863" : "#f0d9b5",
                   outline: selected === i ? "2px solid gold" : "none" }}>
          {p ? GLYPH[p.color + p.type] : ""}
        </button>
      ))}
    </div>
  );
}`,
					},
				],
			},
			{
				title: "The \"constrain mutations\" pattern",
				blurb:
					"This is the same pattern as the space-game but with discrete moves instead of continuous physics. Works for anything turn-based: card games, grid-based strategy, tic-tac-toe.",
				files: [
					{
						path: "pattern.ts",
						lang: "ts",
						code: `// client: here's what I want to do
//   agent.send({ kind: "move", from: 52, to: 36 })
//
// server: I decide whether it's legal
//   sideOfConnection(conn.id) === state.toMove ?  ──── wrong turn? drop.
//   validateMove(board, from, to, side).ok     ?  ──── illegal? drop.
//   this.setState({ board: ..., toMove: ..., history: ... })
//
// client: re-render from the new state
//   state.board is the source of truth
//   useAgent hook causes React to re-render on each CF_AGENT_STATE frame
`,
					},
				],
			},
			{
				title: "Run + play",
				blurb:
					"Open /match/saturday in two tabs with different names. Click ♔ in tab 1 to claim white; click ♚ in tab 2 to claim black. Spectators can connect to the same URL and watch without moving.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "command", text: "open http://localhost:8787/match/saturday  # alice, white" },
					{ kind: "command", text: "open http://localhost:8787/match/saturday  # bob, black" },
				],
			},
			{
				title: "What it looks like",
				blurb:
					"White moves first. Your turn badge highlights. Move history piles up below. Game ends when a king gets captured (simplified win condition — no checkmate detection).",
				screenshot: {
					label: "/match/saturday — white to move",
					content: `  match — saturday
  ♔ white: alice ← your move     ♚ black: bob

  white to move — your move

    a b c d e f g h
   ┌───────────────┐
  8│ ♜ ♞ ♝ ♛ ♚ ♝ ♞ ♜│
  7│ ♟ ♟ ♟ ♟ ♟ ♟ ♟ ♟│
  6│ . . . . . . . .│
  5│ . . . . . . . .│
  4│ . . . . ♙ . . .│    ← selected: e4
  3│ . . . . . . . .│
  2│ ♙ ♙ ♙ ♙ . ♙ ♙ ♙│
  1│ ♖ ♘ ♗ ♕ ♔ ♗ ♘ ♖│
   └───────────────┘

  history:  1. e4`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- mission-control ---------------------------------------------------
	{
		slug: "mission-control",
		title: "Multi-agent mission",
		description:
			"A four-agent collaborative system on an asteroid-mining mission. Commander orchestrates navigator, scout, and engineer via typed RPC every 2s. Each role has its own UI so you can dive in and inspect what that crew member knows.",
		tags: ["multi-agent", "rpc", "ui", "middleware"],
		status: "stable",
		exampleDir: "examples/mission-control",
		preview: {
			kind: "diagram",
			nodes: ["commander", "navigator · scout", "engineer"],
		},
		whatYoullLearn: [
			"Orchestrating multiple agents via typed `getAgent<T>` RPC",
			"Route groups (parens) for shared middleware that doesn't leak into URLs",
			"Why each agent has its own UI — separate DOs, separate state, separate concerns",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Four agents under a shared (mission) group",
				blurb:
					"The `(mission)` folder is a route group — parens strip it from the URL, so you still get `/commander/:id`, `/navigator/:id`, `/scout/:id`, `/engineer/:id`. But every request under that subtree runs the shared middleware.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/counter" },
					{
						kind: "command",
						text: "mkdir -p 'agents/(mission)/commander' 'agents/(mission)/navigator' 'agents/(mission)/scout' 'agents/(mission)/engineer'",
					},
				],
				treeTitle: "my-app/agents/",
				tree: [
					{
						type: "folder",
						name: "(mission)",
						defaultOpen: true,
						highlight: true,
						note: "route group — stripped from URL",
						children: [
							{
								type: "file",
								name: "middleware.ts",
								kind: "ts",
								highlight: true,
								note: "mission-id validation + req id",
							},
							{
								type: "folder",
								name: "commander",
								defaultOpen: true,
								children: [
									{ type: "file", name: "agent.ts", kind: "ts" },
									{ type: "file", name: "app.tsx", kind: "tsx" },
								],
							},
							{
								type: "folder",
								name: "navigator",
								defaultOpen: false,
								children: [
									{ type: "file", name: "agent.ts", kind: "ts" },
									{ type: "file", name: "app.tsx", kind: "tsx" },
								],
							},
							{
								type: "folder",
								name: "scout",
								defaultOpen: false,
								children: [
									{ type: "file", name: "agent.ts", kind: "ts" },
									{ type: "file", name: "app.tsx", kind: "tsx" },
								],
							},
							{
								type: "folder",
								name: "engineer",
								defaultOpen: false,
								children: [
									{ type: "file", name: "agent.ts", kind: "ts" },
									{ type: "file", name: "app.tsx", kind: "tsx" },
								],
							},
						],
					},
				],
			},
			{
				title: "agents/(mission)/middleware.ts — shared by all four",
				blurb:
					"Mission-id validation + request id. Applies to every descendant of `(mission)/`. If you wanted auth, password-gating the whole mission subtree is two lines here.",
				files: [
					{
						path: "agents/(mission)/middleware.ts",
						lang: "ts",
						code: `import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  const missionId = c.params.instanceId;
  if (!/^[a-z0-9-]{1,40}$/.test(missionId)) {
    return c.json({ error: "invalid mission id", missionId }, 400);
  }
  const reqId = crypto.randomUUID().slice(0, 8);
  c.set("reqId", reqId);
  console.log(\`[\${reqId}] \${c.request.method} \${c.url.pathname}\`);

  const res = await next();
  const headers = new Headers(res.headers);
  headers.set("x-mission-request-id", reqId);
  headers.set("x-mission-id", missionId);
  return new Response(res.body, { status: res.status, headers });
};

export default middleware;`,
					},
				],
			},
			{
				title: "The three crew agents",
				blurb:
					"Each crew role is its own DO class with its own state shape and its own RPC methods. `getAgent<NavigatorAgent>(env.NAVIGATOR_AGENT, id)` returns a typed stub — rename a method in the callee and every caller breaks at compile time.",
				files: [
					{
						path: "agents/(mission)/navigator/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

export type Vec3 = { x: number; y: number; z: number };
export type NavigatorStatus = { position: Vec3; target: Vec3 | null; fuel: number; heading: Vec3; arrived: boolean; trail: Vec3[]; speed: number };

export default class NavigatorAgent extends Agent<GeneratedEnv, NavigatorStatus & { lastUpdate: number }> {
  override initialState = { position: {x:0,y:0,z:0}, target: null, fuel: 100, heading: {x:1,y:0,z:0}, arrived: false, trail: [], speed: 1.4, lastUpdate: 0 };

  async setCourse(target: Vec3): Promise<NavigatorStatus> { /* recompute heading, setState */ return this.report(); }
  async refuel(): Promise<NavigatorStatus>                 { /* fuel = 100 */ return this.report(); }
  async tick(): Promise<NavigatorStatus>                   { /* advance one step toward target, burn fuel */ return this.report(); }
  async report(): Promise<NavigatorStatus>                 { const { lastUpdate, ...rest } = this.state; return rest; }

  override async onRequest(request: Request) { /* accept action=course|tick|refuel */ return Response.json(this.state); }
}`,
					},
					{
						path: "agents/(mission)/scout/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

export type Contact = { id: string; kind: "asteroid"|"debris"|"signal"|"hostile"; distance: number; bearing: number; severity: number; spottedAt: number };
export type ScoutStatus = { scanning: boolean; sensorRange: number; contacts: Contact[]; threatLevel: number; lastScan: number | null };

export default class ScoutAgent extends Agent<GeneratedEnv, ScoutStatus> {
  override initialState = { scanning: false, sensorRange: 25, contacts: [], threatLevel: 0, lastScan: null };

  async scan(): Promise<ScoutStatus> { /* generate 1-3 contacts, recompute threat */ return { ...this.state }; }
  async clear(): Promise<ScoutStatus> { this.setState({ ...this.state, contacts: [], threatLevel: 0 }); return this.state; }
  async report(): Promise<ScoutStatus> { return { ...this.state }; }

  override async onRequest() { return Response.json(this.state); }
}`,
					},
					{
						path: "agents/(mission)/engineer/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

export type SystemName = "power" | "lifeSupport" | "comms" | "hull" | "drill";
export type EngineerStatus = { systems: Record<SystemName, number>; repairs: number; repairing: SystemName | null; aggregate: number };

export default class EngineerAgent extends Agent<GeneratedEnv, EngineerStatus> {
  override initialState = { systems: { power: 100, lifeSupport: 100, comms: 100, hull: 100, drill: 100 }, repairs: 0, repairing: null, aggregate: 100 };

  async repair(system: SystemName): Promise<EngineerStatus> { /* set repairing, delay, heal, clear */ return this.state; }
  async degrade(): Promise<EngineerStatus> { /* pick random system, drop 2-8% */ return this.state; }
  async report(): Promise<EngineerStatus> { return { ...this.state }; }

  override async onRequest() { return Response.json(this.state); }
}`,
					},
				],
			},
			{
				title: "agents/(mission)/commander/agent.ts — orchestrator",
				blurb:
					"`scheduleEvery(2, \"tick\")` drives the mission. Every tick, commander calls nav.tick(), eng.degrade(), and every third tick scout.scan(). It aggregates all three statuses into its own state and decides whether to advance the mission phase.",
				files: [
					{
						path: "agents/(mission)/commander/agent.ts",
						lang: "ts",
						code: `import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type { GeneratedEnv } from "@ayjnt/env";
import type NavigatorAgent from "../navigator/agent.ts";
import type ScoutAgent from "../scout/agent.ts";
import type EngineerAgent from "../engineer/agent.ts";

type Phase = "idle" | "survey" | "approach" | "extract" | "return" | "done";
type State = { phase: Phase; cycle: number; running: boolean; scheduleId: string | null; log: { at: number; text: string; level: string }[]; crew: { navigator: any; scout: any; engineer: any } };

export default class CommanderAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { phase: "idle", cycle: 0, running: false, scheduleId: null, log: [], crew: { navigator: null, scout: null, engineer: null } };

  async start(): Promise<State> {
    const s = await this.scheduleEvery(2, "tick");
    this.setState({ ...this.state, running: true, scheduleId: s.id });
    await this.nav().then((a) => a.setCourse({ x: 40, y: 10, z: 0 }));
    return this.state;
  }

  async tick() {
    if (!this.state.running) return;
    const nav = await this.nav();
    const scout = await this.scout();
    const eng = await this.engineer();

    const [navStatus, engStatus] = await Promise.all([nav.tick(), eng.degrade()]);
    const scoutStatus = this.state.cycle % 3 === 0 ? await scout.scan() : await scout.report();

    // Fuel emergency?  divert to return phase
    // Arrived?  advance to next phase
    this.setState({ ...this.state, cycle: this.state.cycle + 1,
      crew: { navigator: navStatus, scout: scoutStatus, engineer: engStatus } });
  }

  private async nav() { return getAgent<NavigatorAgent>(this.env.NAVIGATOR_AGENT, this.name); }
  private async scout() { return getAgent<ScoutAgent>(this.env.SCOUT_AGENT, this.name); }
  private async engineer() { return getAgent<EngineerAgent>(this.env.ENGINEER_AGENT, this.name); }

  override async onRequest(request: Request) { /* POST start/stop/reset */ return Response.json(this.state); }
}`,
						highlightLines: [14, 15, 22, 23, 24, 25, 26, 27, 28],
					},
				],
			},
			{
				title: "Four URLs, four UIs, one mission",
				blurb:
					"Every crew member has an app.tsx. Use the same mission id across URLs to join them up: /commander/apollo, /navigator/apollo, /scout/apollo, /engineer/apollo. Each UI connects to its own DO over WebSocket and re-renders when commander's tick updates that DO's state.",
				files: [
					{
						path: "tie-together.ts",
						lang: "ts",
						code: `// every tab → its own WebSocket → its own DO's state feed
//
// /commander/apollo  ── uses @ayjnt/commander  (typed to CommanderAgent state)
// /navigator/apollo  ── uses @ayjnt/navigator  (typed to NavigatorAgent state)
// /scout/apollo      ── uses @ayjnt/scout      (typed to ScoutAgent state)
// /engineer/apollo   ── uses @ayjnt/engineer   (typed to EngineerAgent state)
//
// Mission id is the URL segment after the route prefix. Using the same id
// across URLs is what ties the crew together — commander's tick calls
// getAgent<NavigatorAgent>(env.NAVIGATOR_AGENT, this.name), so "apollo"
// commander talks to "apollo" navigator (not "luna").
`,
					},
				],
			},
			{
				title: "Run + engage",
				blurb:
					"Open the commander UI and click ENGAGE. The crew agents start reporting. The navigator moves through survey → approach → extract → return waypoints; engineer degrades a random system each tick; scout surfaces contacts every third tick. You can drill into any crew UI while the mission runs.",
				terminal: [
					{ kind: "command", text: "bun run dev" },
					{ kind: "command", text: "open http://localhost:8787/commander/apollo" },
					{ kind: "command", text: "open http://localhost:8787/navigator/apollo" },
					{ kind: "command", text: "open http://localhost:8787/scout/apollo" },
					{ kind: "command", text: "open http://localhost:8787/engineer/apollo" },
				],
			},
			{
				title: "What it looks like",
				blurb:
					"Commander is the big-picture view. Each crew tab is a dense single-role console. Click the role cards on the commander page to jump to any crew UI; use the ← commander link in each crew tab to come back.",
				screenshot: {
					label: "four tabs, one mission",
					content: `  ┌──────────── /commander/apollo ────────────────────────────┐
  │ MISSION CONTROL   APOLLO                 [ENGAGE] [reset] │
  │ survey-and-extract · cycle 7 · APPROACH                   │
  ├───────────────────────────────────────────────────────────┤
  │  NAVIGATOR ↗    SCOUT ↗         ENGINEER ↗                │
  │    87.3%          34%              78%                    │
  │    fuel          threat           health                  │
  │    en route →    5 contacts       2 repairs               │
  ├───────────────────────────────────────────────────────────┤
  │ mission log                                               │
  │   14:32:18  phase → approach                              │
  │   14:32:16  systems degrading (68%)                       │
  │   14:32:12  phase → survey                                │
  │   14:32:10  mission engaged                               │
  └───────────────────────────────────────────────────────────┘

  /navigator/apollo            /scout/apollo             /engineer/apollo
  ┌─────── radar ──────┐       ┌ threat  34% ─┐          ┌ aggregate 78% ─┐
  │   · BASE  ◯ TGT     │       │ ████████▁▁▁▁ │          │   power  71% ▆│
  │     ━━━▶             │       │ [scan now]   │          │   life   58% ▃│
  │  ship  ship          │       │              │          │   comms  92% ▅│
  │  trail               │       │ contacts     │          │   hull  100% █│
  │                      │       │ ▸ hostile  · │          │   drill  80% ▇│
  │ POS 51,19 FUEL 87.3% │       │ ▸ asteroid · │          └─────────────────┘
  │ TGT 80,30  EN-ROUTE  │       │ ▸ signal   · │
  └─────────────────────┘       └──────────────┘`,
				},
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- conference --------------------------------------------------------
	{
		slug: "conference",
		title: "Zoom-lite with per-speaker transcription",
		description:
			"Two collaborating agents: a ConferenceRoom DO that holds participants + transcript + relays WebRTC signaling, and a per-user Transcriber DO that runs Whisper and RPC-forwards utterances to the room. WebRTC P2P mesh for video, Workers AI for STT. Shows how ayjnt agents compose.",
		tags: ["multi-agent", "voice", "rpc", "websocket", "ui"],
		status: "stable",
		exampleDir: "examples/conference",
		preview: {
			kind: "diagram",
			nodes: ["browser", "ConferenceRoom", "Transcriber (× N)", "Workers AI"],
		},
		whatYoullLearn: [
			"Composing multiple agent types — a shared room DO plus one transcriber DO per user, talking to each other via typed `getAgent<T>` RPC",
			"Running `WorkersAIFluxSTT` server-side, one streaming session per WebSocket connection",
			"WebRTC P2P mesh with the agent as a pure signaling relay (offer/answer/ICE)",
			"Why `participantId` (minted by the client) is the right cross-agent key — not the WebSocket connection id",
		],
		steps: [
			SCAFFOLD_WITH_UI,
			{
				title: "Two agents under agents/",
				blurb:
					"`agents/room/` holds the shared ConferenceRoom + the React UI; `agents/transcriber/` holds the per-user STT agent. Both land in wrangler.jsonc automatically because they're discovered by the file scan.",
				terminal: [
					{ kind: "command", text: "rm -rf agents/counter" },
					{ kind: "command", text: "mkdir -p agents/room agents/transcriber" },
				],
				treeTitle: "my-app/agents/",
				tree: [
					{
						type: "folder",
						name: "room",
						defaultOpen: true,
						children: [
							{
								type: "file",
								name: "agent.ts",
								kind: "ts",
								note: "ConferenceRoom: state + signaling",
							},
							{
								type: "file",
								name: "peer-mesh.ts",
								kind: "ts",
								note: "WebRTC mesh helper",
							},
							{
								type: "file",
								name: "audio-capture.ts",
								kind: "ts",
								note: "mic → 16kHz PCM",
							},
							{
								type: "file",
								name: "app.tsx",
								kind: "tsx",
								note: "React UI",
							},
						],
					},
					{
						type: "folder",
						name: "transcriber",
						defaultOpen: true,
						children: [
							{
								type: "file",
								name: "agent.ts",
								kind: "ts",
								note: "per-user Whisper",
							},
						],
					},
				],
			},
			{
				title: "agents/room/agent.ts — shared room state",
				blurb:
					"No STT here — the room is a participant tracker, WebRTC signaling relay, and the receiver of `recordUtterance` RPC calls from each user's Transcriber. The shared transcript broadcasts to every connected client through ayjnt's state sync.",
				files: [
					{
						path: "agents/room/agent.ts",
						lang: "ts",
						code: `import { Agent, callable, type Connection, type WSMessage } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Participant = {
  id: string;             // client-minted, shared with the user's Transcriber
  displayName: string;
  joinedAt: number;
  muted: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
};

type TranscriptEntry = {
  id: string;
  participantId: string;
  displayName: string;
  text: string;
  at: number;
};

type State = { participants: Participant[]; transcript: TranscriptEntry[] };

export default class ConferenceRoom extends Agent<GeneratedEnv, State> {
  override initialState: State = { participants: [], transcript: [] };

  override async onMessage(conn: Connection, message: WSMessage) {
    // Audio doesn't flow through this agent at all — it lives in the
    // Transcriber. Drop any stray binary frames as a safety net.
    if (typeof message !== "string") return;
    const frame = JSON.parse(message);
    // ... handle hello / media-state / webrtc relay ...
  }

  /** Inter-agent RPC entry point — called by Transcriber DOs.
   *  Returns void; errors propagate through the await on the other side. */
  async recordUtterance(participantId: string, text: string): Promise<void> {
    const participant = this.state.participants.find((p) => p.id === participantId);
    if (!participant) return; // unknown speaker — drop
    this.setState({
      ...this.state,
      transcript: [
        ...this.state.transcript,
        { id: crypto.randomUUID(), participantId, displayName: participant.displayName, text, at: Date.now() },
      ].slice(-200),
    });
  }

  @callable({ description: "Clear the conversation transcript." })
  async clearTranscript() {
    this.setState({ ...this.state, transcript: [] });
  }
}`,
						highlightLines: [27, 33, 34, 35],
					},
				],
			},
			{
				title: "agents/transcriber/agent.ts — per-user Whisper",
				blurb:
					"One DO instance per participant. Each WebSocket connection gets its own streaming Whisper session. On every finalized utterance, the transcriber calls back into the room via `getAgent<ConferenceRoom>(env.CONFERENCE_ROOM, roomId)` — typed DO RPC. No magic strings: the type comes from a single type-only import.",
				files: [
					{
						path: "agents/transcriber/agent.ts",
						lang: "ts",
						code: `import { Agent, type Connection, type WSMessage } from "agents";
import { getAgent } from "ayjnt/rpc";
import { WorkersAIFluxSTT, type TranscriberSession } from "@cloudflare/voice";
import type { GeneratedEnv } from "@ayjnt/env";
import type ConferenceRoom from "../room/agent.ts";

type ConnState = {
  roomId: string | null;
  participantId: string | null;
  displayName: string | null;
};

export default class Transcriber extends Agent<GeneratedEnv> {
  private sessions = new Map<string, TranscriberSession>();

  override async onConnect(conn: Connection) {
    conn.setState({ roomId: null, participantId: null, displayName: null });
  }

  override async onMessage(conn: Connection, message: WSMessage) {
    if (message instanceof ArrayBuffer) {
      this.sessions.get(conn.id)?.feed(message);
      return;
    }
    if (typeof message !== "string") return;
    const { kind, roomId, participantId, displayName } = JSON.parse(message);
    if (kind !== "bind") return;

    conn.setState({ roomId, participantId, displayName });

    // One Whisper session per WebSocket connection. onUtterance fires
    // once the model finalizes a turn → RPC to the room.
    const session = new WorkersAIFluxSTT(this.env.AI).createSession({
      language: "en",
      onUtterance: async (text: string) => {
        const room = await getAgent<ConferenceRoom>(
          this.env.CONFERENCE_ROOM,
          roomId,
        );
        await room.recordUtterance(participantId, text);
      },
    });
    this.sessions.set(conn.id, session);
  }

  override async onClose(conn: Connection) {
    this.sessions.get(conn.id)?.close();
    this.sessions.delete(conn.id);
  }
}`,
						highlightLines: [2, 5, 31, 35, 36, 37, 38, 39],
					},
				],
			},
			{
				title: "On the client — two WebSockets, one mic",
				blurb:
					"useAgent() handles WS #1 to the room (state sync + signaling). A raw WebSocket handles WS #2 to the user's Transcriber (audio frames). The same client-minted participantId is what ties them together — that's why the room can attribute every utterance to a known participant.",
				files: [
					{
						path: "agents/room/app.tsx",
						lang: "tsx",
						code: `import { useAgent } from "@ayjnt/room";
import { startAudioCapture } from "./audio-capture.ts";

export default function ConferenceUI() {
  const agent = useAgent();                         // WS #1 → room
  const participantId = useMemo(() => crypto.randomUUID(), []);

  const onJoin = async (name: string) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

    // Tell the room who we are — it'll see this participantId everywhere.
    agent.send(JSON.stringify({ kind: "hello", participantId, displayName: name }));

    // Open WS #2 → this user's own Transcriber DO.
    const ws = new WebSocket(\`wss://\${location.host}/transcriber/\${participantId}\`);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ kind: "bind", roomId: agent.name, participantId, displayName: name }));
    });

    // Mic frames → Transcriber (NOT room). The Transcriber feeds them
    // to Whisper, then RPCs the room with the finalized utterance.
    const micTrack = stream.getAudioTracks()[0];
    await startAudioCapture(micTrack, (pcm) => ws.send(pcm));
  };
  // ... peer-mesh setup, video tiles, transcript pane ...
}`,
						highlightLines: [6, 11, 14, 17, 21, 22],
					},
				],
			},
			deployStep("https://my-app.<account>.workers.dev"),
		],
	},

	// --- compiled-cli --------------------------------------------------------
	{
		slug: "compiled-cli",
		title: "A CLI in one binary",
		description:
			"An agent, its model tools, and a command-line program shipped as a single executable. Covers the root-level cli.ts, tools.ts (workerd) vs tools.host.ts (Bun host), and `ayjnt compile`.",
		tags: ["cli", "tools", "compile"],
		status: "stable",
		exampleDir: "examples/compiled-cli",
		preview: {
			kind: "terminal",
			lines: [
				"$ ayjnt compile",
				"✓ ayjnt: notes-app (170MB)",
				"$ ./notes-app add hello",
				"added 2b02e3f6…",
			],
		},
		whatYoullLearn: [
			"How a root-level `cli.ts` turns a project into a runnable program",
			"How to call agent methods as in-process RPC — no HTTP, no port, no handshake",
			"Why `tools.ts` runs in workerd and `tools.host.ts` runs in Bun, and when to reach for each",
			"How host tools gate `write` / `exec` side effects, and why that guards against prompt injection",
			"Why `ayjnt deploy` refuses a project containing host tools",
		],
		steps: [
			SCAFFOLD_BLANK,
			{
				title: "Add a cli.ts at the project root",
				blurb:
					"A root-level `cli.ts` default-exports a function. `ayjnt run` boots the worker under a local workerd, calls it in the foreground, then shuts everything down — workerd included — when it returns. Import the context type from the *generated* `@ayjnt/cli`, which types `agents` against your actual classes.",
				files: [
					{
						path: "cli.ts",
						lang: "ts",
						code: `import type { AyjntCli } from "@ayjnt/cli";

export default async function ({ agents, argv }: AyjntCli) {
  const notes = agents.notes("default");
  const [command, ...rest] = argv;

  if (command === "add") {
    const note = await notes.addNote(rest.join(" "), "cli");
    console.log(\`added \${note.id}\`);
    return;
  }

  for (const n of await notes.listNotes()) {
    console.log(\`• \${n.text}  (\${n.source})\`);
  }
}`,
						highlightLines: [4, 8, 13],
					},
				],
			},
			{
				title: "Run it — arguments after `--` reach cli.ts",
				blurb:
					"`agents.notes(...)` is a real Durable Object stub, so `addNote` is RPC straight into workerd. That works because `cli.ts` runs in the same process that owns the runtime. Unlike `ayjnt dev`, which wraps `wrangler dev`, `ayjnt run` is byte-for-byte the code path a compiled binary uses.",
				terminal: [
					{ kind: "command", text: "bun run start add hello world" },
					{ kind: "output", text: "[ayjnt] serving on http://127.0.0.1:8787" },
					{ kind: "success", text: "added 2b02e3f6-d97f-4ff8-8e28-11ede840b67d" },
					{ kind: "command", text: "bun run start list" },
					{ kind: "output", text: "• hello world  (cli)" },
				],
			},
			{
				title: "Add model tools — one file per runtime",
				blurb:
					"`tools.ts` runs inside workerd next to the agent and deploys normally. `tools.host.ts` runs in the Bun process, so it can use `Bun.$`, `Bun.file` and `bun:sqlite` — things workerd has no answer for. There is deliberately no `\"use host\"` directive: the filename is the declaration. `sideEffects` is required, because the arguments come from model output.",
				files: [
					{
						path: "agents/notes/tools.ts",
						lang: "ts",
						code: `import { tool } from "ai";
import { z } from "zod";

// Runs in workerd. Pure computation — no reason to leave the runtime.
export const countWords = tool({
  description: "Count the words in a piece of text.",
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => ({
    words: text.trim().split(/\\s+/).filter(Boolean).length,
  }),
});`,
					},
					{
						path: "agents/notes/tools.host.ts",
						lang: "ts",
						code: `import { confinePath, hostTool } from "ayjnt/tools";
import { z } from "zod";

const ROOT = process.cwd();

// Runs on the Bun host. \`confinePath\` matters: the path comes from a model.
export const readProjectFile = hostTool({
  description: "Read a text file from the project directory.",
  sideEffects: "read",
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ path }: { path: string }) =>
    await Bun.file(confinePath(ROOT, path)).text(),
});`,
						highlightLines: [9, 12],
					},
					{
						path: "agents/notes/agent.ts",
						lang: "ts",
						code: `import { agentTools } from "ayjnt/tools";

// Both kinds merge into one AI-SDK ToolSet. The agent doesn't know or care
// which runtime a tool lives in.
const tools = { ...browserTools(this), ...agentTools(this) };
const result = await generateText({ model, tools, messages });`,
						highlightLines: [5],
					},
				],
			},
			{
				title: "Host tools need permission for anything dangerous",
				blurb:
					"`read` runs freely; `write` and `exec` are refused unless you opt in. This is not ceremony — if an agent ever reads untrusted content (an inbound email, a retrieved document, a fetched page), attacker-controlled text can reach a function that runs `Bun.$` on your machine.",
				terminal: [
					{
						kind: "command",
						text: "bun run start tool notes__appendToLog '{\"line\":\"hi\"}'",
					},
					{
						kind: "error",
						text: 'tool failed: host tool appendToLog declares sideEffects: "write", which is not permitted. Re-run with --allow-host-writes.',
					},
					{
						kind: "command",
						text: "bun run start tool notes__readProjectFile '{\"path\":\"../../../etc/passwd\"}'",
					},
					{
						kind: "error",
						text: 'tool failed: path "../../../etc/passwd" escapes the permitted directory',
					},
				],
			},
			{
				title: "Compile it",
				blurb:
					"One file containing your agents, their UIs, `cli.ts`, the host tools, the Bun runtime and workerd. It runs on a machine with no Bun, no node_modules and no wrangler. Durable Object state persists in a per-app OS directory, so `add` today and `list` tomorrow behave the way a user expects.",
				terminal: [
					{ kind: "command", text: "bun run compile" },
					{ kind: "output", text: "[ayjnt] bundling worker (wrangler --dry-run)…" },
					{ kind: "output", text: "[ayjnt] embedding workerd (103MB)" },
					{ kind: "success", text: "✓ ayjnt: notes-app (170MB)" },
					{ kind: "command", text: "./notes-app add shipped as one file" },
					{ kind: "success", text: "added 7c9db569-2ffa-4375-b19d-b184a7e9934d" },
				],
				screenshot: {
					label: "Two runtimes, one binary",
					content: `┌─ notes-app (one executable, ~170MB) ─────────────────┐
│                                                      │
│  ┌─ Bun process ──────────┐  ┌─ workerd ──────────┐  │
│  │ cli.ts                 │  │ agents/notes/      │  │
│  │   Bun.$  Bun.file      │  │   agent.ts         │  │
│  │   bun:sqlite  argv     │  │   tools.ts         │  │
│  │                        │  │                    │  │
│  │ tools.host.ts          │  │ DO state, alarms,  │  │
│  │   readProjectFile      │  │ setState, workflows│  │
│  └────────────┬───────────┘  └─────────┬──────────┘  │
│               │   in-process DO RPC    │             │
│               │◀───────────────────────┤             │
│               │   __AYJNT_HOST bridge  │             │
│               ├───────────────────────▶│             │
└──────────────────────────────────────────────────────┘
   cli.ts returns ──▶ everything stops, workerd included`,
				},
			},
			{
				title: "…but you cannot deploy it",
				blurb:
					"A deployed Cloudflare worker has no host process, so `tools.host.ts` has nowhere to run. Failing at deploy time beats the alternatives: silently omitting the tools gives the same agent different capabilities in production with nothing to indicate it, and deploying throwing stubs turns a build error into a production incident. Move the functions into `tools.ts`, ship with `ayjnt compile`, or mark the file `@ayjnt-optional-on-deploy` if the agent works without them.",
				terminal: [
					{ kind: "command", text: "bun run deploy" },
					{
						kind: "error",
						text: "cannot deploy: 1 host tool file(s) would not work in production.",
					},
					{ kind: "output", text: "  agents/notes/tools.host.ts  (/notes)" },
				],
			},
		],
	},
];

export function getExample(slug: string): ExampleMeta | undefined {
	return EXAMPLES.find((e) => e.slug === slug);
}
