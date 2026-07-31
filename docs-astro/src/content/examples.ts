export type Example = {
  slug: string;
  index: string;
  title: string;
  description: string;
  teaches: string;
  tags: string[];
  files: string[];
  accent: string;
  projectName: string;
  install?: string;
  environment?: string;
  run: string;
  open: string;
  steps: Array<{
    title: string;
    body: string;
    file?: string;
  }>;
  verify: string[];
  screenshot: string;
};

export const examples: Example[] = [
  {
    slug: "code",
    index: "01",
    title: "Coding harness",
    description:
      "A full-screen terminal coding agent with browser-visible sessions, transcripts, and token usage.",
    teaches: "CLI + host tools + durable sessions",
    tags: ["OpenTUI", "Bun host", "app.tsx", "cli.ts"],
    files: ["agents/ayjnt-code/agent.ts", "agents/ayjnt-code/app.tsx", "agents/ayjnt-code/tools.host.ts", "agents/sessions/agent.ts", "agents/app.tsx", "cli.ts"],
    accent: "blue",
    projectName: "coding-harness",
    install: "bun add @ai-sdk/openai @opentui/core ai zod",
    environment: "OPENAI_API_KEY=your-key",
    run: "bun run start",
    open: "http://localhost:8787/",
    steps: [
      { title: "Create durable coding sessions", body: "The coding agent owns one conversation and its usage totals. Notice the simplified <code>Agent&lt;State&gt;</code> signature and the typed class-based call to the session registry.", file: "agents/ayjnt-code/agent.ts" },
      { title: "Give the model narrow host tools", body: "Host tools run in Bun, not inside the isolate. Their schemas and side-effect metadata define the bridge contract.", file: "agents/ayjnt-code/tools.host.ts" },
      { title: "Build the terminal surface", body: "The root CLI renders a full-screen OpenTUI conversation and calls the same durable agent instance as the browser.", file: "cli.ts" },
      { title: "Add the browser history", body: "The home page lists sessions; the co-located page renders the complete transcript and token usage.", file: "agents/app.tsx" },
    ],
    verify: [
      "Enter a coding request in the terminal and wait for the completion.",
      "Open the browser dashboard and confirm the session and token totals appear.",
      "Open the session route and compare its transcript with the terminal conversation.",
    ],
    screenshot: "/examples/code.jpg",
  },
  {
    slug: "realtime-voice",
    index: "02",
    title: "Realtime voice",
    description:
      "A Gemini-powered conversation with a fluid audio-reactive sphere that turns green while listening.",
    teaches: "Realtime input + an expressive human interface",
    tags: ["Gemini", "audio", "app.tsx"],
    files: ["agents/voice/agent.ts", "agents/voice/app.tsx"],
    accent: "mint",
    projectName: "voice-harness",
    environment: "GEMINI_API_KEY=your-key",
    run: "bun run dev",
    open: "http://localhost:8787/voice/demo",
    steps: [
      { title: "Track durable voice usage", body: "The agent keeps session and turn counters while the browser handles low-latency audio.", file: "agents/voice/agent.ts" },
      { title: "Build the realtime interface", body: "The browser connects to Gemini Live, captures the microphone, plays model audio, and drives the sphere from input and output energy.", file: "agents/voice/app.tsx" },
    ],
    verify: [
      "Allow microphone access and press Start conversation.",
      "The sphere turns green while listening and reacts while Gemini speaks.",
      "Refresh the route and confirm the durable session counters remain.",
    ],
    screenshot: "/examples/realtime-voice.jpg",
  },
  {
    slug: "chess",
    index: "03",
    title: "Chess arena",
    description:
      "Play an agent or let two providers play each other. Bring OpenAI, Gemini, Claude, or Ollama.",
    teaches: "Provider choice + human and agent participants",
    tags: ["multi-provider", "state", "app.tsx"],
    files: ["agents/match/agent.ts", "agents/match/app.tsx"],
    accent: "orange",
    projectName: "chess-harness",
    install: "bun add chess.js",
    run: "bun run dev",
    open: "http://localhost:8787/match/demo",
    steps: [
      { title: "Own rules and model turns in the agent", body: "The agent validates every move with chess.js and constrains provider output to the legal move list.", file: "agents/match/agent.ts" },
      { title: "Create the arena", body: "The UI supports human versus agent and agent versus agent, with provider keys kept in browser memory for the demo.", file: "agents/match/app.tsx" },
    ],
    verify: [
      "Make one legal human move and confirm the board and history update.",
      "Choose a provider, add its key or Ollama URL, and request the next move.",
      "Switch both sides to agents to watch the same harness orchestrate them.",
    ],
    screenshot: "/examples/chess.jpg",
  },
  {
    slug: "scheduler",
    index: "04",
    title: "Endpoint monitor",
    description:
      "Check an HTTP endpoint once, on an interval, or with cron and inspect status, latency, and response history.",
    teaches: "One-time, interval, and cron schedules",
    tags: ["scheduling", "state", "notifications"],
    files: ["agents/monitor/agent.ts", "agents/monitor/app.tsx"],
    accent: "yellow",
    projectName: "monitor-harness",
    run: "bun run dev",
    open: "http://localhost:8787/monitor/demo",
    steps: [
      { title: "Schedule checks where state lives", body: "One agent method handles one-time, interval, and cron schedules and records a bounded run history.", file: "agents/monitor/agent.ts" },
      { title: "Make schedules visible", body: "The UI creates monitors, runs them immediately, removes schedules, and explains their cadence in human terms.", file: "agents/monitor/app.tsx" },
    ],
    verify: [
      "Create a monitor for a public HTTP endpoint.",
      "Press Run now and inspect status, latency, and response preview.",
      "Create a short interval, wait for the next scheduled entry, then remove it.",
    ],
    screenshot: "/examples/scheduler.jpg",
  },
  {
    slug: "workflow",
    index: "05",
    title: "Content review",
    description:
      "A useful approval workflow that researches, drafts, pauses for a human, and publishes after approval.",
    teaches: "Durable steps + human-in-the-loop approval",
    tags: ["workflow", "approval", "app.tsx"],
    files: ["agents/review/agent.ts", "agents/review/workflow.ts", "agents/review/app.tsx"],
    accent: "violet",
    projectName: "review-harness",
    run: "bun run dev",
    open: "http://localhost:8787/review/demo",
    steps: [
      { title: "Define the co-located workflow", body: "The workflow declares only its parameter type. Durable steps fetch, extract, draft, validate, and report completion.", file: "agents/review/workflow.ts" },
      { title: "Start it without a binding string", body: "The agent calls <code>this.workflow(params)</code>; generated types connect those params to the neighboring workflow.", file: "agents/review/agent.ts" },
      { title: "Put the decision in front of a person", body: "The UI surfaces the draft and checks, then records an explicit approval or rejection.", file: "agents/review/app.tsx" },
    ],
    verify: [
      "Submit a topic and reachable source URL.",
      "Watch the item move from preparing to awaiting approval.",
      "Review the draft and checks, then approve or reject it.",
    ],
    screenshot: "/examples/workflow.jpg",
  },
  {
    slug: "orchestration",
    index: "06",
    title: "Research team",
    description:
      "A lead agent delegates investigation, fact-checking, and synthesis to focused agents and shows the handoffs.",
    teaches: "Typed inter-agent RPC + orchestration",
    tags: ["multi-agent", "RPC", "observability"],
    files: ["agents/lead/agent.ts", "agents/researcher/agent.ts", "agents/reviewer/agent.ts"],
    accent: "coral",
    projectName: "research-team",
    run: "bun run dev",
    open: "http://localhost:8787/lead/demo",
    steps: [
      { title: "Give each agent one responsibility", body: "The researcher extracts candidate facts and the reviewer removes risky claims. Their public methods are the internal RPC contract.", file: "agents/researcher/agent.ts" },
      { title: "Orchestrate with class-safe RPC", body: "The lead imports each target class and calls <code>this.agent(TargetClass, instance)</code>, receiving autocomplete without binding-name strings.", file: "agents/lead/agent.ts" },
      { title: "Show every handoff", body: "The browser interface displays stages, agent attribution, source links, and the final synthesized brief.", file: "agents/lead/app.tsx" },
    ],
    verify: [
      "Enter a question and two reachable article URLs.",
      "Watch the stage move through researcher, reviewer, and lead.",
      "Inspect the attributed facts and caveats in the final brief.",
    ],
    screenshot: "/examples/orchestration.jpg",
  },
];
