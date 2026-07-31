export type DocTable = {
  headers: string[];
  rows: string[][];
};

export type DocSection = {
  title: string;
  body?: string[];
  bullets?: string[];
  code?: string;
  codeTitle?: string;
  table?: DocTable;
  note?: { title: string; body: string };
};

export type ReferenceDoc = {
  slug: string;
  title: string;
  description: string;
  eyebrow?: string;
  sections: DocSection[];
};

const cloudflareNotice = {
  title: "Built on Cloudflare Agents",
  body: 'Ayjnt’s <code>Agent</code> is a thin abstraction over Cloudflare’s Agents SDK. Native methods keep their upstream behavior and you can import directly from <code>agents</code> whenever you need an API Ayjnt does not document. See the <a href="https://developers.cloudflare.com/agents/" target="_blank">Cloudflare Agents documentation ↗</a> for the complete underlying runtime.',
};

const tutorialOutcomes: Record<string, string> = {
  agents: "Open <code>http://localhost:8787/support/demo</code>. Refreshing or reconnecting to the same name reaches the same durable instance.",
  "writing-agents": "Open the route shown in the guide, call the method once, and confirm the returned state survives a page refresh.",
  "callable-methods": "Open the co-located browser UI and call the decorated method through <code>agent.stub</code>. TypeScript should autocomplete its arguments and return type.",
  state: "Change state from the UI, refresh the page, and confirm the synchronized snapshot and SQLite rows remain available.",
  sessions: "Append two messages, restart the dev server, and request history again. The session is stored in the agent’s SQLite database.",
  scheduling: "Create a one-minute schedule, keep the dev server running, and watch the run appear in state after the agent wakes.",
  workflows: "Start the workflow from the agent UI and watch the workflow ID, durable steps, and completion callback appear.",
  "durable-execution": "Interrupt one run after its first checkpoint, restart development, and verify that the selected durable primitive resumes or retries safely.",
  "inter-agent": "Call the order agent once. Autocomplete should expose the inventory agent’s public methods, and both agent instances should preserve independent state.",
  "sub-agents": "Create two child names and list them from the parent. Each child should return its own isolated state.",
  "host-bridge": "Run with the documented host permission flag, invoke the host tool, and confirm the agent receives only its serialized result.",
  tools: "Give the exported tools to your model, ask for the demonstrated action, and inspect which runtime executed it.",
  client: "Open the browser route in two tabs. A state change in one tab should synchronize to the other.",
  routing: "Visit two different instance names and verify they have independent state while sharing the same agent class.",
  voice: "Add the provider key, allow microphone access, and confirm the sphere changes to its listening state before the model answers.",
  browser: "Run the example request and inspect the returned page title or extracted text instead of a raw browser session.",
  mcp: "Connect an MCP inspector to the generated route and invoke the example tool with its documented input.",
  email: "Send a message to the configured local part and confirm <code>onEmail()</code> receives it and selects the expected agent instance.",
  observability: "Trigger one state update and one callable method, then confirm both event categories appear in the subscriber output.",
};

function freshProjectSection(slug: string): DocSection {
  const directory = `try-${slug.replaceAll("/", "-")}`;
  return {
    title: "Start from a fresh project",
    body: [
      "This guide is self-contained. Create an empty Ayjnt project, then replace the starter agent with the files shown below. Run commands from the new project directory unless a step says otherwise.",
    ],
    codeTitle: "terminal",
    code: `bunx ayjnt new ${directory} --empty
cd ${directory}
bun install

# remove agents/alive once you are ready to add the guide's files`,
  };
}

function tryItSection(slug: string): DocSection {
  return {
    title: "Run it and verify the result",
    codeTitle: "terminal",
    code: `bun run build
bun run dev

# the local app is now available at http://localhost:8787`,
    body: [
      tutorialOutcomes[slug] ??
        "Run the example interaction described above and confirm the durable state or returned value matches the guide.",
    ],
    note: {
      title: "What build proves",
      body: "<code>bun run build</code> discovers the files, generates bindings and types, and catches structural mistakes before the development server starts.",
    },
  };
}

const docs: ReferenceDoc[] = [
  {
    slug: "agents",
    title: "How agents work",
    description: "An agent instance is a durable, addressable micro-server with its own state, storage, connections, and work.",
    sections: [
      {
        title: "Class, route, instance",
        body: [
          "A folder such as <code>agents/support/agent.ts</code> defines an agent class and the route <code>/support/:name</code>. The class describes behavior; the final path segment selects one durable instance.",
          "The same name always resolves to the same instance. That is the unit to model around: one user, game, coding session, project, or coordination boundary.",
        ],
        table: {
          headers: ["Part", "Example", "Meaning"],
          rows: [
            ["Class", "SupportAgent", "Shared behavior and lifecycle"],
            ["Route", "/support", "Human-facing address"],
            ["Instance", "customer-42", "Durable identity and isolated SQLite"],
          ],
        },
      },
      {
        title: "Lifecycle",
        body: [
          "<code>onStart()</code> runs when an instance starts or wakes. HTTP reaches <code>onRequest()</code>. Realtime connections use <code>onConnect()</code>, <code>onMessage()</code>, <code>onClose()</code>, and <code>onError()</code>. State changes notify <code>onStateChanged()</code>.",
          "Instances can hibernate between events. Persist anything important in state or SQLite; do not treat in-memory fields as durable.",
        ],
        codeTitle: "agents/support/agent.ts",
        code: `import { Agent } from "ayjnt";

type State = { status: "idle" | "working"; task?: string };

export default class SupportAgent extends Agent<State> {
  initialState: State = { status: "idle" };

  async onStart() {
    console.log("ready", this.name);
  }

  async onRequest() {
    return Response.json(this.state);
  }
}`,
        note: cloudflareNotice,
      },
    ],
  },
  {
    slug: "writing-agents",
    title: "Write an agent",
    description: "Start with one durable responsibility, then add the human surface and capabilities it actually needs.",
    sections: [
      {
        title: "The smallest useful agent",
        body: [
          "Create <code>agents/&lt;route&gt;/agent.ts</code> and default-export a class extending Ayjnt’s <code>Agent</code>. Code generation discovers it, creates the Durable Object binding, and routes requests from the folder path.",
          "You may instead import <code>Agent</code> directly from <code>agents</code>. Discovery, routing, bindings, <code>app.tsx</code>, tools, and workflows work the same way. Use Ayjnt’s class when you want its peer-agent and session conveniences; use Cloudflare’s class when you want the upstream surface only.",
        ],
        codeTitle: "agents/counter/agent.ts",
        code: `import { Agent, callable } from "ayjnt";

type State = { count: number };

export default class CounterAgent extends Agent<State> {
  initialState: State = { count: 0 };

  @callable({ description: "Increase the counter." })
  increment(by = 1) {
    this.setState({ count: this.state.count + by });
    return this.state.count;
  }
}`,
      },
      {
        title: "Add a front door",
        body: [
          "Place <code>app.tsx</code> beside the agent for a browser interface. Add a root <code>cli.ts</code> for a terminal interface. Both receive typed access generated from the agent class.",
          "Keep privileged work out of the model loop by default. Expose narrow tools, validate their input, declare side effects, and require a person before consequential actions.",
        ],
        bullets: [
          "<code>agent.ts</code> — isolated durable behavior in workerd",
          "<code>app.tsx</code> — browser UI for people",
          "<code>tools.ts</code> — deployable tools in workerd",
          "<code>tools.host.ts</code> — explicitly permissioned Bun capabilities",
          "<code>workflow.ts</code> — durable multi-step work",
        ],
      },
    ],
  },
  {
    slug: "callable-methods",
    title: "Callable methods",
    description: "Expose a deliberately small typed RPC surface to browser and mobile clients.",
    sections: [
      {
        title: "Use @callable for external clients",
        body: [
          "Decorate methods that a browser should call through <code>agent.stub</code>. Arguments and return values must be serializable. Plain public methods remain available to internal Durable Object RPC without becoming browser-callable.",
        ],
        code: `import { Agent, callable } from "ayjnt";

export default class ReviewAgent extends Agent {
  @callable({ description: "Submit a document for review." })
  async submit(documentId: string): Promise<{ accepted: true }> {
    await this.queue("review", { documentId });
    return { accepted: true };
  }

  // Internal RPC only: no decorator.
  async review(payload: { documentId: string }) {
    // ...
  }
}`,
      },
      {
        title: "Streaming and failures",
        body: [
          "Use <code>@callable({ streaming: true })</code> with <code>StreamingResponse</code> for incremental results. Throwing rejects the client call; prefer stable, structured error shapes for failures a UI is expected to handle.",
          "Callable RPC travels over the Agent WebSocket protocol. Agent-to-agent calls use Durable Object RPC instead, which is more direct and does not require the decorator.",
        ],
        note: {
          title: "Upstream reference",
          body: 'Descriptions, streaming, timeouts, serialization, and access control follow Cloudflare’s <a href="https://developers.cloudflare.com/agents/runtime/lifecycle/callable-methods/" target="_blank">callable methods API ↗</a>.',
        },
      },
    ],
  },
  {
    slug: "state",
    title: "State and SQLite",
    description: "Use synced state for what interfaces need now, and SQLite for durable records and queries.",
    sections: [
      {
        title: "Synced state",
        body: [
          "Define <code>initialState</code>, read <code>this.state</code>, and replace it with <code>this.setState(next)</code>. Updates persist and broadcast to connected clients.",
          "<code>validateStateChange()</code> runs synchronously before persistence. <code>onStateChanged()</code> observes a successful update.",
        ],
        code: `type State = { phase: "waiting" | "running"; progress: number };

initialState: State = { phase: "waiting", progress: 0 };

validateStateChange(next: State) {
  if (next.progress < 0 || next.progress > 1) {
    throw new Error("progress must be between 0 and 1");
  }
}

setProgress(progress: number) {
  this.setState({ ...this.state, phase: "running", progress });
}`,
      },
      {
        title: "Embedded SQL",
        body: [
          "Each agent instance has isolated SQLite. Use the tagged <code>this.sql</code> helper for history, indexes, queues, and data that should not be broadcast as one state object.",
        ],
        code: `this.sql\`CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL
)\`;

this.sql\`INSERT INTO turns (id, role, content)
  VALUES (\${crypto.randomUUID()}, \${role}, \${content})\`;

const turns = this.sql<{ role: string; content: string }>\`
  SELECT role, content FROM turns ORDER BY rowid
\`;`,
        note: {
          title: "Choose by audience",
          body: 'State is a small synchronized snapshot. SQLite is the durable data model. See Cloudflare’s <a href="https://developers.cloudflare.com/agents/runtime/lifecycle/state/" target="_blank">state guide ↗</a> for persistence details.',
        },
      },
    ],
  },
  {
    slug: "sessions",
    title: "Sessions and memory",
    description: "Keep conversation history, context blocks, branches, search, and compaction close to the agent.",
    sections: [
      {
        title: "One session",
        body: [
          "Ayjnt’s <code>createSession()</code> returns Cloudflare’s Session builder backed by the agent’s SQLite. Add stable identity or instructions as a context block, and give learned memory a bounded token budget.",
        ],
        code: `import { Agent } from "ayjnt";

export default class Assistant extends Agent {
  session = this.createSession()
    .withContext("soul", {
      provider: { get: async () => "You are a careful project assistant." },
    })
    .withContext("memory", {
      description: "Useful facts learned about the person",
      maxTokens: 1100,
    })
    .withCachedPrompt();

  async remember(message: Parameters<typeof this.session.appendMessage>[0]) {
    await this.session.appendMessage(message);
    return this.session.getHistory();
  }
}`,
      },
      {
        title: "Many sessions",
        body: [
          "Use <code>createSession(id)</code> when you already know the namespace, or <code>createSessionManager()</code> to create, list, branch, and archive multiple conversations inside one agent instance.",
          "Session compaction summarizes older turns without rewriting your agent’s state. Search providers and context blocks let a harness load relevant memory instead of replaying everything.",
        ],
        note: {
          title: "Experimental upstream API",
          body: 'Sessions are currently experimental in Cloudflare’s SDK. Ayjnt exposes them without changing their storage or behavior. Track the <a href="https://developers.cloudflare.com/agents/runtime/lifecycle/sessions/" target="_blank">Cloudflare Sessions docs ↗</a> when upgrading.',
        },
      },
    ],
  },
  {
    slug: "scheduling",
    title: "Scheduling",
    description: "Run one-time, delayed, recurring, and cron work inside the agent that owns it.",
    sections: [
      {
        title: "Schedule methods by name",
        body: [
          "A scheduled callback is a method on the agent. Use a number for seconds from now, a <code>Date</code> for a specific time, a cron expression for calendar schedules, or <code>scheduleEvery()</code> for fixed intervals.",
        ],
        code: `async onStart() {
  await this.scheduleEvery(60, "checkInbox");
  await this.schedule("0 9 * * 1-5", "dailyBrief");
}

async remind(taskId: string) {
  const schedule = await this.schedule(15 * 60, "sendReminder", { taskId });
  return schedule.id;
}

async sendReminder(payload: { taskId: string }) {
  // durable callback
}`,
      },
      {
        title: "Inspect and cancel",
        body: [
          "Use <code>getScheduleById()</code>, <code>listSchedules()</code>, and <code>cancelSchedule()</code>. Recurring and cron calls are idempotent where documented, which makes <code>onStart()</code> a safe place to ensure a recurring schedule exists.",
        ],
        note: {
          title: "Ownership matters",
          body: "A sub-agent’s schedules belong to that sub-agent even though the root Durable Object owns the physical alarm. Deleting the child also cleans up its scheduled work.",
        },
      },
    ],
  },
  {
    slug: "workflows",
    title: "Workflows",
    description: "Use durable steps for multi-stage work that must survive retries, pauses, and human approval.",
    sections: [
      {
        title: "Co-located AgentWorkflow",
        body: [
          "Place <code>workflow.ts</code> beside <code>agent.ts</code>. Extend <code>AgentWorkflow</code> when the workflow should call back into the originating agent, report progress, update state, or wait for approval.",
        ],
        codeTitle: "agents/review/workflow.ts",
        code: `import {
  AgentWorkflow,
  type AgentWorkflowEvent,
  type AgentWorkflowStep,
} from "ayjnt/workflows";

type Params = { documentId: string };

export default class ReviewWorkflow extends AgentWorkflow<Params> {
  async run(
    event: Readonly<AgentWorkflowEvent<Params>>,
    step: AgentWorkflowStep,
  ) {
    const result = await step.do("analyze", async () => {
      return analyze(event.payload.documentId);
    });
    await step.reportComplete(result);
    return result;
  }
}`,
      },
      {
        title: "Start it from the agent",
        body: [
          "Co-location is the relationship: extend Ayjnt’s <code>Agent</code> and call <code>this.workflow(params)</code>. Generated declarations carry the workflow payload type into the agent, so there is no agent-name generic, mixin, or binding string to repeat.",
        ],
        code: `import { Agent, callable } from "ayjnt";

export default class ReviewAgent extends Agent {
  @callable()
  async start(documentId: string) {
    return this.workflow({ documentId });
  }
}`,
        note: {
          title: "Upstream semantics",
          body: 'Ayjnt’s workflow classes subclass Cloudflare’s implementations. Read <a href="https://developers.cloudflare.com/agents/runtime/execution/run-workflows/" target="_blank">Run Workflows ↗</a> for step retries, approvals, callbacks, progress, querying, and limits.',
        },
      },
    ],
  },
  {
    slug: "durable-execution",
    title: "Durable execution",
    description: "Choose queues, retries, fibers, or workflows based on the recovery guarantee the work needs.",
    sections: [
      {
        title: "Four execution tools",
        table: {
          headers: ["Primitive", "Use it for"],
          rows: [
            ["retry()", "A fallible operation that can be tried again now"],
            ["queue()", "FIFO work owned by one agent"],
            ["runFiber() / startFiber()", "Long work with checkpoints and recovery hooks"],
            ["AgentWorkflow", "Durable multi-step processes, approvals, and external control"],
          ],
        },
        body: [
          "<code>keepAliveWhile()</code> protects in-memory work from idle eviction but does not make it recoverable. Fibers add a durable run ledger and <code>stash()</code> checkpoints. Workflows add durable steps and a full instance lifecycle.",
        ],
        codeTitle: "agents/importer/agent.ts",
        code: `import { Agent, callable } from "ayjnt";

export default class ImporterAgent extends Agent {
  @callable()
  async importFile(fileId: string) {
    return this.runFiber(
      \`import:\${fileId}\`,
      async (fiber) => {
        const rows = await this.retry(
          () => downloadRows(fileId),
          { maxAttempts: 3 },
        );

        fiber.stash({ downloadedRows: rows.length });
        return this.queue("indexRows", { fileId, rows });
      },
    );
  }

  async indexRows(payload: { fileId: string; rows: Row[] }) {
    await saveRows(payload.fileId, payload.rows);
  }
}`,
      },
      {
        title: "Make effects idempotent",
        body: [
          "A recovery path may execute again. Give external writes idempotency keys, record completion before notifying clients, and keep non-durable progress messages separate from durable state transitions.",
        ],
        code: `await chargeCustomer({
  customerId,
  amount,
  // A retry receives the same key instead of creating a second charge.
  idempotencyKey: \`order:\${orderId}:charge\`,
});`,
      },
    ],
  },
  {
    slug: "inter-agent",
    title: "Inter-agent communication",
    description: "Call a separately bound agent by durable name with typed RPC.",
    sections: [
      {
        title: "Use this.agent inside Ayjnt Agent",
        body: [
          "The protected <code>this.agent()</code> helper is Ayjnt’s typed wrapper around Cloudflare <code>getAgentByName()</code>. The target has its own top-level Durable Object namespace and storage.",
        ],
        codeTitle: "agents/orders/agent.ts",
        code: `import { Agent } from "ayjnt";
import InventoryAgent from "../inventory/agent";

export default class OrdersAgent extends Agent {
  async reserve(sku: string, quantity: number) {
    const inventory = await this.agent(InventoryAgent, "primary");
    return inventory.reserve(sku, quantity);
  }
}`,
        note: {
          title: "Why the class is a value import",
          body: "The class gives TypeScript the complete RPC surface for autocomplete and gives Ayjnt a runtime-safe key for the generated binding. Renaming the folder or binding cannot silently redirect this call.",
        },
      },
      {
        title: "Outside an Agent",
        body: [
          "Import <code>getAgent&lt;T&gt;()</code> from <code>ayjnt</code> when calling from a Worker handler or other framework code. Browser code should use callable methods instead of a Durable Object binding.",
          "Internal agent RPC does not need <code>@callable()</code>. Public methods are callable through the typed Durable Object stub.",
        ],
      },
    ],
  },
  {
    slug: "sub-agents",
    title: "Sub-agents",
    description: "Create co-located child agents with isolated storage and typed parent–child RPC.",
    sections: [
      {
        title: "Delegate durable responsibilities",
        body: [
          "Use native <code>this.subAgent(ChildClass, name)</code> when one root entity owns an open-ended set of children such as chats, documents, sessions, projects, or orchestration workers.",
        ],
        code: `export class Orchestrator extends Agent {
  async research(topics: string[]) {
    return Promise.all(topics.map(async (topic, index) => {
      const child = await this.subAgent(Researcher, \`research-\${index}\`);
      return child.search(topic);
    }));
  }
}

export class Researcher extends Agent {
  async search(topic: string) {
    return { topic, findings: [] };
  }
}`,
      },
      {
        title: "Lifecycle and access",
        bullets: [
          "Export child classes from the worker entry so the runtime can discover them.",
          "Children have isolated SQLite but run as facets co-located with the parent.",
          "Use <code>parentAgent()</code> for child-to-parent RPC.",
          "Use <code>hasSubAgent()</code> and <code>listSubAgents()</code> for registry-backed access control.",
          "<code>abortSubAgent()</code> stops execution but preserves storage; <code>deleteSubAgent()</code> permanently removes it.",
        ],
        note: {
          title: "Native feature",
          body: 'Sub-agents are implemented by Cloudflare’s Agent base class and currently carry upstream experimental status. See the <a href="https://developers.cloudflare.com/agents/runtime/execution/sub-agents/" target="_blank">sub-agents reference ↗</a>.',
        },
      },
    ],
  },
  {
    slug: "host-bridge",
    title: "The host bridge",
    description: "Let isolated agents request narrow, permission-aware actions from a Bun host.",
    sections: [
      {
        title: "A boundary, not a shared global",
        body: [
          "Agent code runs in workerd. Host tools run in Bun. Ayjnt sends a tool description and validated input across a private bridge; the Bun implementation never ships into the isolate.",
          "The bridge is active under <code>ayjnt run</code> and compiled executables. Deployed Cloudflare Workers have no Bun host process, so host tools are rejected unless explicitly marked optional on deploy.",
        ],
      },
      {
        title: "Declare side effects",
        codeTitle: "agents/code/tools.host.ts",
        code: `import { z } from "zod";
import { confinePath, hostTool } from "ayjnt/tools";

const root = process.cwd();

export const readProjectFile = hostTool({
  description: "Read a UTF-8 file inside the project.",
  sideEffects: "read",
  inputSchema: z.object({ path: z.string() }),
  execute: ({ path }) => Bun.file(confinePath(root, path)).text(),
});`,
        table: {
          headers: ["sideEffects", "Runtime permission"],
          rows: [
            ["read", "Allowed by default"],
            ["write", "Requires --allow-host-writes"],
            ["exec", "Requires --allow-host-exec"],
          ],
        },
      },
    ],
  },
  {
    slug: "tools",
    title: "Tools",
    description: "Give models small capabilities with explicit schemas, descriptions, and execution boundaries.",
    sections: [
      {
        title: "Two tool locations",
        table: {
          headers: ["File", "Runtime", "Good for"],
          rows: [
            ["tools.ts", "workerd", "fetch, bindings, durable state, deployable services"],
            ["tools.host.ts", "Bun", "files, shell, processes, local databases, native connectors"],
          ],
        },
        body: [
          "Call <code>agentTools(this)</code> to receive one AI SDK ToolSet containing local agent tools plus allowed host proxies. Worker-side tools win name collisions.",
        ],
      },
      {
        title: "Design for a person to supervise",
        bullets: [
          "Describe the effect, not just the function name.",
          "Validate every model-produced argument.",
          "Confine paths and use argument arrays instead of shell interpolation.",
          "Separate preparing an action from committing it.",
          "Put approval immediately before consequential writes or execution.",
        ],
      },
    ],
  },
  {
    slug: "client",
    title: "Browser client",
    description: "Connect a co-located React interface to state and callable methods with generated types.",
    sections: [
      {
        title: "Generated useAgent hook",
        body: [
          "When <code>app.tsx</code> sits beside an agent, Ayjnt generates a route-bound <code>useAgent()</code> hook. It derives the instance from the URL, subscribes to state, and types <code>stub</code> from the server class.",
        ],
        code: `import { useAgent } from "@ayjnt/counter";

export default function Counter() {
  const agent = useAgent();
  const count = agent.state?.count ?? 0;

  return <button onClick={() => agent.stub.increment(1)}>
    Count: {count}
  </button>;
}`,
      },
      {
        title: "AgentClient without React",
        body: [
          "Use Ayjnt’s <code>AgentClient</code> when you want the same WebSocket state and RPC protocol without a React hook. The wrapper translates a file route and instance into Cloudflare’s client <code>basePath</code>.",
        ],
        code: `import { AgentClient } from "ayjnt/client";
import type CounterAgent from "./agents/counter/agent";

const client = new AgentClient<CounterAgent>({
  route: "/counter",
  name: "demo",
  onStateUpdate: (state) => console.log(state),
});

await client.ready;
await client.stub.increment(1);`,
        note: {
          title: "Transparent client",
          body: "Reconnects, state sync, callable RPC, errors, and readiness come from Cloudflare AgentClient. <code>CloudflareAgentClient</code> is re-exported for direct use.",
        },
      },
    ],
  },
  {
    slug: "routing",
    title: "Routing and middleware",
    description: "The folder tree is the route tree; middleware follows the same hierarchy.",
    sections: [
      {
        title: "Routes from files",
        body: [
          "<code>agents/reports/agent.ts</code> maps to <code>/reports/:name</code>. Nested folders create nested prefixes. A folder may contain both an agent and descendants.",
          "Ayjnt routes HTTP and WebSocket upgrades to the named Durable Object instance and serves a co-located app shell on the same route.",
        ],
      },
      {
        title: "Middleware",
        body: [
          "Place <code>middleware.ts</code> in an agent folder to wrap that route and every descendant. Use it for authentication, tenancy, request context, and policy before an agent wakes.",
        ],
        code: `import type { Middleware } from "ayjnt";

const auth: Middleware = async (context, next) => {
  const token = context.request.headers.get("authorization");
  if (!token) return new Response("Unauthorized", { status: 401 });
  return next();
};

export default auth;`,
      },
    ],
  },
  {
    slug: "voice",
    title: "Voice",
    description: "Build realtime spoken interfaces while keeping the durable agent and browser surface co-located.",
    sections: [
      {
        title: "Realtime transport, durable identity",
        body: [
          "Voice agents use the Cloudflare Voice integration for audio transport while Ayjnt generates the bindings and route plumbing. The browser owns microphone permission and visualization; the agent owns session identity, policy, and durable state.",
          "Use the realtime voice example when integrating Gemini Live or another realtime model. Never place long-lived API keys in committed browser code; accept them for a local demo or exchange them through a server-controlled path.",
        ],
      },
    ],
  },
  {
    slug: "browser",
    title: "Browser tools",
    description: "Give an agent a sandboxed browser tool set without hand-writing every binding.",
    sections: [
      {
        title: "One runtime helper",
        body: [
          "Importing <code>ayjnt/browser</code> signals code generation to add the Browser Rendering, Worker Loader, AI, and compatibility configuration needed by Cloudflare’s browser tools.",
        ],
        code: `import { browserTools } from "ayjnt/browser";

const result = await generateText({
  model,
  messages,
  tools: browserTools(this),
});`,
      },
      {
        title: "Local endpoint",
        body: [
          "When a Browser binding is unavailable locally, pass a CDP URL for a Chromium instance. Browser tools are agent-runtime capabilities; they are different from Bun host tools.",
        ],
      },
    ],
  },
  {
    slug: "mcp",
    title: "Model Context Protocol",
    description: "Connect agents to MCP servers or expose an agent as one without losing the co-located UI.",
    sections: [
      {
        title: "MCP clients",
        body: [
          "Cloudflare Agent includes a durable MCP client manager for registering servers, OAuth callbacks, discovery, and namespaced tools. Use native <code>addMcpServer()</code>, <code>removeMcpServer()</code>, and the manager on <code>this.mcp</code>.",
          "Treat tool descriptions and remote content as untrusted. Gate sensitive tools and keep authorization tied to the person and agent instance.",
        ],
      },
      {
        title: "MCP agents",
        body: [
          "An MCP agent can live in the same file-routed project and still have <code>app.tsx</code>. Ayjnt detects the agent type and generates the correct handler while preserving the browser interface.",
        ],
      },
    ],
  },
  {
    slug: "email",
    title: "Email",
    description: "Route inbound mail to a durable agent and send replies from the same identity.",
    sections: [
      {
        title: "Handle mail as an event",
        body: [
          "Override <code>onEmail()</code> for inbound messages and use native <code>replyToEmail()</code> or <code>sendEmail()</code> for outbound mail. Secure reply routing signs agent identity headers so replies return to the correct durable instance.",
          "Email contents can contain prompt injection. Parse it as untrusted input, limit tools available during mail handling, and require approval before external side effects.",
        ],
      },
    ],
  },
  {
    slug: "observability",
    title: "Observability",
    description: "Make state changes, tool calls, scheduled work, and human decisions inspectable.",
    sections: [
      {
        title: "Observe the harness, not only the model",
        bullets: [
          "Agent identity, instance, and route",
          "Model request, provider, latency, and token usage",
          "Tool arguments, result summary, duration, and side-effect class",
          "Schedules, workflow steps, retries, queues, and fiber recovery",
          "Human approvals, edits, cancellations, and overrides",
        ],
        body: [
          "The Agents SDK emits diagnostics-channel events and integrates with Cloudflare logs, metrics, and traces. Ayjnt’s browser and terminal surfaces should present the same execution record in a human-readable way.",
        ],
      },
    ],
  },
  {
    slug: "cli",
    title: "CLI command reference",
    description: "The Ayjnt CLI discovers the file tree, generates runtime wiring, and runs the same harness locally or in the cloud.",
    sections: [
      {
        title: "Commands",
        table: {
          headers: ["Command", "Purpose"],
          rows: [
            ["new", "Scaffold a project with a browser UI by default"],
            ["dev", "Generate files, watch changes, run Wrangler dev"],
            ["run", "Boot Ayjnt’s Bun + workerd local runtime and cli.ts"],
            ["build", "Generate .ayjnt without starting or deploying"],
            ["compile", "Package the app, Bun, and workerd into an executable"],
            ["migrate", "Preview the Durable Object migration diff"],
            ["deploy", "Run safety checks, build, and deploy with Wrangler"],
          ],
        },
      },
      {
        title: "Shared conventions",
        body: [
          "<code>dev</code>, <code>build</code>, <code>migrate</code>, and <code>deploy</code> accept <code>--cwd &lt;path&gt;</code>. Unknown flags for Wrangler-backed commands are forwarded, so <code>ayjnt dev --port 8788</code> works.",
          "Set <code>AYJNT_DEBUG=1</code> to include stack traces when a command fails.",
        ],
      },
    ],
  },
  {
    slug: "cli/new",
    title: "ayjnt new",
    description: "Scaffold a new project with a durable counter agent and browser interface.",
    eyebrow: "CLI",
    sections: [
      {
        title: "Usage",
        code: `ayjnt new <directory> [options]

--empty     scaffold one bare “alive” agent without a UI
-h, --help  show command help`,
        body: [
          "The default starter includes <code>agents/counter/agent.ts</code>, a co-located <code>app.tsx</code>, project scripts, generated-artifact ignores, and the current authoring skills.",
          "The destination may not exist or may be an empty directory. Use <code>ayjnt new .</code> after creating and entering an empty folder.",
        ],
      },
    ],
  },
  {
    slug: "cli/dev",
    title: "ayjnt dev",
    description: "Watch the project, regenerate Ayjnt artifacts, and run the Worker through Wrangler.",
    eyebrow: "CLI",
    sections: [
      {
        title: "Usage",
        code: `ayjnt dev [options]

--cwd <path>  project root
-h, --help    show command help

# unknown flags go to Wrangler
ayjnt dev --port 8788 --remote`,
        body: [
          "Use <code>dev</code> for normal browser-facing development and Cloudflare service bindings. It rebuilds when agent files, apps, tools, workflows, middleware, or environment inputs change.",
          "A root <code>cli.ts</code> is not the foreground under this command. Use <code>ayjnt run</code> to exercise the Bun host and terminal interface.",
        ],
      },
    ],
  },
  {
    slug: "cli/run",
    title: "ayjnt run",
    description: "Run the full local harness: Bun host, workerd agents, host bridge, and cli.ts.",
    eyebrow: "CLI",
    sections: [
      {
        title: "Usage",
        code: `ayjnt run [options] [-- <args for cli.ts>]

--cwd <path>
--port <n>             default 8787; 0 chooses a free port
--data-dir <path>      Durable Object persistence directory
--allow-host-writes    allow hostTool sideEffects: "write"
--allow-host-exec      allow hostTool sideEffects: "exec"`,
      },
      {
        title: "Arguments and permissions",
        body: [
          "Non-flag arguments are passed to <code>cli.ts</code>. Use <code>--</code> when your CLI needs a flag that Ayjnt would otherwise claim.",
          "Read-only host tools are available by default. Write and execution permissions must be granted explicitly each run.",
        ],
      },
    ],
  },
  {
    slug: "cli/build",
    title: "ayjnt build",
    description: "Generate the Worker entry, configuration, typed clients, assets, environment types, and migration lockfile.",
    eyebrow: "CLI",
    sections: [
      {
        title: "Usage",
        code: `ayjnt build [options]

--cwd <path>  project root
-h, --help    show command help`,
        body: [
          "Build is code generation only. It writes regenerable output under <code>.ayjnt/</code> and stages intentional migration changes in <code>.ayjnt/migrations.json</code>.",
          "Run it in CI to verify discovery and bundling without opening a development server or contacting the deployment API.",
        ],
      },
    ],
  },
  {
    slug: "cli/compile",
    title: "ayjnt compile",
    description: "Produce one executable containing the Bun host, generated Worker, browser assets, cli.ts, and workerd.",
    eyebrow: "CLI",
    sections: [
      {
        title: "Usage",
        code: `ayjnt compile [options]

--cwd <path>
--outfile <path>
--target <target>       for example bun-linux-x64
--no-embed-workerd      require AYJNT_WORKERD_PATH at runtime
--bytecode              precompile embedded JavaScript
--minify                minify embedded JavaScript`,
      },
      {
        title: "Runtime contract",
        body: [
          "The resulting executable accepts <code>--port</code>, <code>--data-dir</code>, <code>--allow-host-writes</code>, and <code>--allow-host-exec</code>. Other arguments go to <code>cli.ts</code>.",
          "Cross-compiling Bun does not cross-compile workerd. Build for the current platform when embedding it, or use <code>--no-embed-workerd</code> and provide a compatible binary.",
        ],
      },
    ],
  },
  {
    slug: "cli/migrate",
    title: "ayjnt migrate",
    description: "Preview the Durable Object migration that a build would stage, without writing files.",
    eyebrow: "CLI",
    sections: [
      {
        title: "Usage",
        code: `ayjnt migrate [options]

--cwd <path>  project root
-h, --help    show command help`,
        body: [
          "Use this in code review before renaming or deleting agent classes. A stable <code>agentId</code> lets a renamed folder retain the same storage identity.",
          "After reviewing, run <code>ayjnt build</code> to write the migration lockfile, then commit it with the source change.",
        ],
      },
    ],
  },
  {
    slug: "cli/deploy",
    title: "ayjnt deploy",
    description: "Build and deploy the agent runtime to Cloudflare with migration safety checks.",
    eyebrow: "CLI",
    sections: [
      {
        title: "Usage",
        code: `ayjnt deploy [options]

--cwd <path>  project root
--force       skip git safety checks
-h, --help    show command help

# additional flags go to wrangler deploy
ayjnt deploy --env production`,
      },
      {
        title: "Preflight",
        body: [
          "By default Ayjnt requires a clean tree, a branch that is synchronized with its origin, and a committed migration lockfile. This prevents two deploys from creating divergent append-only Durable Object histories.",
          "<code>--force</code> bypasses git coordination, not runtime constraints. Projects with required Bun host tools cannot deploy because Cloudflare has no host process.",
        ],
      },
    ],
  },
  {
    slug: "api/agent",
    title: "Agent API",
    description: "A practical reference to Ayjnt’s Agent<State> and the upstream capabilities it preserves.",
    eyebrow: "API reference",
    sections: [
      {
        title: "Agent<State>",
        body: [
          "Pass only the synchronized state shape. Ayjnt owns and augments the generated environment, so you do not thread <code>GeneratedEnv</code> through every class. The optional second generic is initialization props.",
          "Use the direct Cloudflare <code>Agent&lt;Env, State, Props&gt;</code> import when you intentionally want to own the complete environment type yourself.",
        ],
        codeTitle: "agents/counter/agent.ts",
        code: `import { Agent, callable } from "ayjnt";

type State = { count: number };

export default class CounterAgent extends Agent<State> {
  initialState: State = { count: 0 };

  @callable()
  increment() {
    this.setState({ count: this.state.count + 1 });
    return this.state.count;
  }
}`,
      },
      {
        title: "Use the upstream class when you need it",
        body: [
          "Ayjnt discovers the default export from <code>agent.ts</code>, so that class may extend either Ayjnt’s wrapper or Cloudflare’s class. <code>CloudflareAgent</code> is the unchanged upstream export; use it when explicitly controlling the full environment generic matters more than Ayjnt’s class-safe peer and co-located workflow helpers.",
        ],
        codeTitle: "agents/advanced/agent.ts",
        code: `import { CloudflareAgent } from "ayjnt";

interface Env extends Cloudflare.Env {
  PRIVATE_SERVICE: Service;
}

type State = { ready: boolean };

export default class AdvancedAgent
  extends CloudflareAgent<Env, State> {
  initialState: State = { ready: false };
}`,
        note: cloudflareNotice,
      },
      {
        title: "agent(TargetClass, name?, options?)",
        body: [
          "Returns a typed handle to another top-level agent instance. Import the target class as a value; it supplies autocomplete and is the runtime key for Ayjnt’s generated constructor-to-binding registry.",
          "The namespace overload remains available for custom Durable Object bindings: <code>this.agent(this.env.CUSTOM, name)</code>.",
        ],
        codeTitle: "agents/orders/agent.ts",
        code: `import { Agent } from "ayjnt";
import InventoryAgent from "../inventory/agent";

export default class OrdersAgent extends Agent {
  async placeOrder(sku: string, quantity: number) {
    const inventory = await this.agent(InventoryAgent, "primary");
    return inventory.reserve(sku, quantity);
  }
}`,
      },
      {
        title: "workflow(params)",
        body: [
          "Starts the <code>workflow.ts</code> beside this agent. Ayjnt generates the binding and parameter relationship, so there is no mixin or string binding name. The returned string is the workflow instance ID.",
        ],
        code: `const workflowId = await this.workflow({
  documentId,
  requestedBy: this.name,
});`,
      },
      {
        title: "createSession() and createSessionManager()",
        body: [
          "<code>createSession(id?)</code> creates an upstream Cloudflare Session backed by this agent’s SQLite. <code>createSessionManager()</code> manages multiple named conversations, branches, archives, and compaction.",
        ],
        code: `export default class AssistantAgent extends Agent {
  session = this.createSession("support")
    .withContext("identity", {
      provider: { get: async () => "You are a support assistant." },
    });

  async history() {
    return this.session.getHistory();
  }
}`,
      },
      {
        title: "Inherited capabilities",
        table: {
          headers: ["Capability", "Members", "Smallest useful example"],
          rows: [
            ["Lifecycle", "onStart, onRequest, onConnect", "<code>onRequest() { return Response.json(this.state) }</code>"],
            ["State", "initialState, state, setState, sql", "<code>this.setState({ count: this.state.count + 1 })</code>"],
            ["Connections", "broadcast, getConnections", "<code>this.broadcast(JSON.stringify({ type: \"ready\" }))</code>"],
            ["Scheduling", "schedule, scheduleEvery, cancelSchedule", "<code>await this.schedule(60, \"remind\", { id })</code>"],
            ["Execution", "retry, queue, runFiber, stash", "<code>await this.retry(() =&gt; fetch(url))</code>"],
            ["Sub-agents", "subAgent, parentAgent, listSubAgents", "<code>await this.subAgent(Researcher, topic)</code>"],
          ],
        },
        note: cloudflareNotice,
      },
    ],
  },
  {
    slug: "api/client",
    title: "AgentClient API",
    description: "A route-aware subclass of Cloudflare AgentClient for non-React browser clients.",
    eyebrow: "API reference",
    sections: [
      {
        title: "Constructor",
        code: `import { AgentClient } from "ayjnt/client";
import type SupportAgent from "../../agents/support/agent";

const client = new AgentClient<SupportAgent>({
  route: "/support",
  name: "customer-42",
  onStateUpdate(state, source) {
    console.log("state changed", source, state);
  },
  onIdentity(name, agentType) {
    console.log("connected", { name, agentType });
  },
});

await client.ready;`,
        body: [
          "<code>route</code> replaces the upstream default <code>/agents/&lt;class&gt;/&lt;name&gt;</code> path with Ayjnt’s file route. <code>name</code> is encoded as one path segment.",
          "In a browser on the same origin, omit <code>host</code> and <code>protocol</code>. Supply them when a separate frontend connects to a deployed agent.",
        ],
      },
      {
        title: "Inherited client surface",
        table: {
          headers: ["Member", "Meaning"],
          rows: [
            ["ready", "Promise resolved after server identity arrives"],
            ["state", "Latest synchronized state"],
            ["stub.method(...)", "Typed callable RPC"],
            ["call(name, args, options)", "Lower-level RPC including streaming options"],
            ["setState(next)", "Request a client-originated state update"],
            ["close(code?, reason?)", "Close and reject pending calls"],
          ],
        },
        codeTitle: "Call RPC and update state",
        code: `// Callable methods are inferred from SupportAgent.
const reply = await client.stub.answer("Where is my order?");

// Read the latest synchronized state.
console.log(client.state);

// If the agent permits client state updates:
client.setState({ ...client.state, draft: "" });

client.close();`,
        body: [
          "Prefer <code>client.stub.method(...)</code> for normal callable functions: the imported agent type supplies argument and return autocomplete. Use <code>call()</code> only when you need the lower-level RPC options.",
        ],
      },
    ],
  },
  {
    slug: "api/workflows",
    title: "Workflow APIs",
    description: "Co-located durable workflows without repeated agent classes or binding names.",
    eyebrow: "API reference",
    sections: [
      {
        title: "AgentWorkflow<Params, Progress?>",
        body: [
          "Use this for a <code>workflow.ts</code> beside an agent. <code>Params</code> types <code>event.payload</code> and the agent’s <code>this.workflow(params)</code> call. <code>Progress</code> optionally types <code>reportProgress()</code>.",
        ],
        codeTitle: "agents/review/workflow.ts",
        code: `import { AgentWorkflow } from "ayjnt/workflows";
import type {
  AgentWorkflowEvent,
  AgentWorkflowStep,
} from "ayjnt/workflows";

type Params = { documentId: string };

export default class ReviewWorkflow extends AgentWorkflow<Params> {
  async run(
    event: Readonly<AgentWorkflowEvent<Params>>,
    step: AgentWorkflowStep,
  ) {
    const result = await step.do("review", async () => {
      return { documentId: event.payload.documentId, approved: true };
    });
    await step.reportComplete(result);
    return result;
  }
}`,
      },
      {
        title: "Start it from the co-located agent",
        codeTitle: "agents/review/agent.ts",
        code: `import { Agent, callable } from "ayjnt";

export default class ReviewAgent extends Agent {
  @callable()
  async review(documentId: string) {
    return this.workflow({ documentId });
  }

  async onWorkflowComplete(
    workflowName: string,
    workflowId: string,
    result?: unknown,
  ) {
    console.log({ workflowName, workflowId, result });
  }
}`,
        body: [
          "Co-location supplies the workflow binding. The generated declarations connect the workflow’s <code>Params</code> to <code>this.workflow()</code>, so a missing or misspelled field is a TypeScript error.",
        ],
      },
      {
        title: "Workflow<Params, Env?>",
        body: [
          "Use <code>Workflow</code> for a plain Cloudflare Workflow without an originating agent. Its first generic is still the payload type; the generated environment is the default second generic.",
        ],
        code: `import { Workflow } from "ayjnt/workflows";

export default class NightlyWorkflow
  extends Workflow<{ date: string }> {
  async run(event: WorkflowEvent<{ date: string }>, step: WorkflowStep) {
    return step.do("summarize", () => summarize(event.payload.date));
  }
}`,
      },
      {
        title: "Exports and escape hatches",
        table: {
          headers: ["Export", "Base", "Use"],
          rows: [
            ["AgentWorkflow", "agents/workflows AgentWorkflow", "Co-located agent workflow; Params first"],
            ["Workflow", "cloudflare:workers WorkflowEntrypoint", "Plain workflow; Params first"],
            ["CloudflareAgentWorkflow", "direct upstream export", "Escape hatch"],
            ["WorkflowEntrypoint", "direct upstream export", "Escape hatch"],
          ],
        },
        note: cloudflareNotice,
      },
    ],
  },
  {
    slug: "deployment",
    title: "Local and cloud runtime",
    description: "Run the same agent classes locally in workerd, package them with Bun, or deploy them to Cloudflare.",
    sections: [
      {
        title: "Three ways to run",
        table: {
          headers: ["Mode", "Agent runtime", "Bun host", "Best for"],
          rows: [
            ["ayjnt dev", "Wrangler workerd", "No", "Web UI and Cloudflare bindings"],
            ["ayjnt run / compiled", "Local workerd", "Yes", "CLI, host tools, local products"],
            ["ayjnt deploy", "Cloudflare", "No", "Globally available durable agents"],
          ],
        },
      },
      {
        title: "Design portable capabilities",
        body: [
          "Agent code, state, schedules, workflows, and <code>tools.ts</code> can run locally or deployed. <code>cli.ts</code> and <code>tools.host.ts</code> are local-product capabilities powered by Bun.",
          "If a host tool is optional in cloud mode, mark it with the documented optional-deploy marker and make the agent behave sensibly when the tool is absent.",
        ],
      },
    ],
  },
  {
    slug: "migrations",
    title: "Durable Object migrations",
    description: "Keep storage identity stable while the file tree and class names evolve.",
    sections: [
      {
        title: "The lockfile is production history",
        body: [
          "<code>.ayjnt/migrations.json</code> is generated but committed. It records append-only Durable Object migrations so every developer and deployment agrees on what already exists.",
          "Run <code>ayjnt migrate</code> to preview, then <code>ayjnt build</code> to stage an intentional change.",
        ],
      },
      {
        title: "Renames and deletion",
        body: [
          "Give long-lived agents a stable exported <code>agentId</code> before renaming their folder or class. Ayjnt can then preserve storage identity across the rename.",
          "Removing an identity can produce a destructive class deletion. Treat migration diffs like database schema changes and review them before deploy.",
        ],
      },
    ],
  },
];

export const referenceDocs: ReferenceDoc[] = docs.map((doc) => {
  if (!(doc.slug in tutorialOutcomes)) return doc;
  return {
    ...doc,
    sections: [
      // freshProjectSection(doc.slug),
      ...doc.sections,
      // tryItSection(doc.slug),
    ],
  };
});
