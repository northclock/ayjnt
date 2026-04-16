import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
	title: "Runtime API — ayjnt docs",
	description:
		"Every import path ayjnt exposes to user code. Signatures, intended use, and what each symbol is re-exported from.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="reference/runtime-api"
			lede="ayjnt's runtime is deliberately thin. Most of the framework is in build-time codegen; the runtime is a handful of re-exports and one compose helper."
		>
			<h2>Import paths at a glance</h2>
			<table>
				<thead>
					<tr>
						<th>Import path</th>
						<th>What it gives you</th>
						<th>Source</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>ayjnt</code>
						</td>
						<td>
							<code>Agent</code>, <code>getAgent</code>,{" "}
							<code>VERSION</code>
						</td>
						<td>ayjnt package</td>
					</tr>
					<tr>
						<td>
							<code>ayjnt/rpc</code>
						</td>
						<td>
							<code>getAgent&lt;T&gt;</code>
						</td>
						<td>ayjnt package</td>
					</tr>
					<tr>
						<td>
							<code>ayjnt/middleware</code>
						</td>
						<td>
							<code>Middleware</code>, <code>Context</code>,{" "}
							<code>Next</code> (types);{" "}
							<code>compose</code>, <code>createContext</code> (used by
							generated code)
						</td>
						<td>ayjnt package</td>
					</tr>
					<tr>
						<td>
							<code>@ayjnt/env</code>
						</td>
						<td>
							<code>GeneratedEnv</code>
						</td>
						<td>Generated at <code>.ayjnt/env.d.ts</code></td>
					</tr>
					<tr>
						<td>
							<code>@ayjnt/&lt;route&gt;</code>
						</td>
						<td>
							<code>useAgent</code> typed to that agent
						</td>
						<td>Generated at <code>.ayjnt/client/&lt;route&gt;/index.tsx</code></td>
					</tr>
				</tbody>
			</table>

			<h2>ayjnt</h2>

			<h3>Agent</h3>
			<p>
				Re-exported from <code>agents</code>. The base class for every
				Durable Object agent.
			</p>
			<CodeBlock
				lang="ts"
				code={`import { Agent } from "ayjnt";
// Equivalent to:
import { Agent } from "agents";

class MyAgent extends Agent<Env, State> {
  override initialState: State = { /* ... */ };
  override async onRequest(request: Request): Promise<Response> { /* ... */ }
}`}
			/>
			<p>
				Generics: <code>Agent&lt;Env, State, Props&gt;</code>.{" "}
				<code>Env</code> is the worker env (DO bindings + KV/R2/vars).{" "}
				<code>State</code> is the shape of <code>this.state</code>.{" "}
				<code>Props</code> is optional per-instance metadata (used less
				often). Exhaustive reference in the{" "}
				<a
					href="https://developers.cloudflare.com/agents/api-reference/agents-api/"
					target="_blank"
					rel="noreferrer"
					className="link-underline"
				>
					Cloudflare Agents docs
				</a>
				.
			</p>

			<h3>getAgent</h3>
			<CodeBlock
				lang="ts"
				code={`import { getAgent } from "ayjnt";
// or:
import { getAgent } from "ayjnt/rpc";`}
			/>
			<p>
				Typed inter-agent RPC stub. See <code>ayjnt/rpc</code> below.
			</p>

			<h3>VERSION</h3>
			<CodeBlock
				lang="ts"
				code={`import { VERSION } from "ayjnt";
console.log(VERSION); // "0.1.0" at time of writing`}
			/>

			<h2>ayjnt/rpc</h2>

			<h3>getAgent&lt;T&gt;(namespace, name)</h3>
			<CodeBlock
				lang="ts"
				code={`async function getAgent<T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
  name: string,
): Promise<DurableObjectStub<T>>;`}
			/>
			<p>
				Thin wrapper over the SDK&apos;s <code>getAgentByName</code> with
				the generic parameter order reshuffled so the call site reads as{" "}
				<code>getAgent&lt;ChatAgent&gt;(env.CHAT_AGENT, id)</code>{" "}
				instead of threading <code>Env</code> through. Under the hood:
			</p>
			<ol>
				<li><code>namespace.idFromName(name)</code> → DO id</li>
				<li><code>namespace.get(id)</code> → stub</li>
				<li><code>stub.setName(name)</code> → DO learns its identity</li>
				<li>returns the stub</li>
			</ol>
			<p>
				The returned stub exposes every public method on <code>T</code>{" "}
				with full type inference, plus <code>.fetch(request)</code> for
				HTTP-over-DO.
			</p>
			<p>
				For the full pattern — including exception propagation and
				structured-clone argument limits — see{" "}
				<a href="/docs/guides/inter-agent-rpc" className="link-underline">
					Inter-agent RPC
				</a>
				.
			</p>

			<h2>ayjnt/middleware</h2>

			<h3>Middleware (type)</h3>
			<CodeBlock
				lang="ts"
				code={`type Middleware<Env = unknown> = (
  c: Context<Env>,
  next: () => Promise<Response>,
) => Promise<Response> | Response;`}
			/>
			<p>
				The signature every <code>middleware.ts</code> default-exports.
				Return a Response to short-circuit; call <code>next()</code> to
				continue; wrap <code>next()</code>&apos;s return value to modify
				the inner response.
			</p>

			<h3>Context (type)</h3>
			<CodeBlock
				lang="ts"
				code={`type Context<Env = unknown> = {
  readonly request: Request;
  readonly url: URL;
  readonly env: Env;
  readonly executionCtx: ExecutionContext;
  readonly params: {
    instanceId: string;
    pathSuffix: string;
  };

  json(body: unknown, init?: number | ResponseInit): Response;
  text(body: string, init?: number | ResponseInit): Response;
  html(body: string, init?: number | ResponseInit): Response;
  redirect(location: string, status?: number): Response;

  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T | undefined;
};`}
			/>
			<p>
				Full description in{" "}
				<a href="/docs/guides/middleware" className="link-underline">
					Middleware
				</a>
				.
			</p>

			<h3>Next (type)</h3>
			<CodeBlock
				lang="ts"
				code={`type Next = () => Promise<Response>;`}
			/>

			<h3>compose + createContext</h3>
			<p>
				These are exported from the module but only meant to be called by
				the generated <code>entry.ts</code>. You can use them if you&apos;re
				writing your own dispatch, but there&apos;s rarely a reason to.
			</p>
			<CodeBlock
				lang="ts"
				code={`function compose<Env>(
  stack: Middleware<Env>[],
  ctx: Context<Env>,
  finalize: () => Promise<Response>,
): Promise<Response>;

function createContext<Env>(init: {
  request: Request;
  url: URL;
  env: Env;
  executionCtx: ExecutionContext;
  params: Context<Env>["params"];
}): Context<Env>;`}
			/>

			<h2>@ayjnt/env</h2>
			<CodeBlock
				lang="ts"
				code={`import type { GeneratedEnv } from "@ayjnt/env";`}
			/>
			<p>
				Regenerated on every <code>ayjnt build</code>. Declares every DO
				binding for every agent in your tree, each typed against the
				specific agent class. Shape:
			</p>
			<CodeBlock
				lang="ts"
				code={`// .ayjnt/env.d.ts (generated)
import type ChatAgent from "../agents/chat/agent.ts";
import type OrdersAgent from "../agents/orders/agent.ts";

export type GeneratedEnv = {
  CHAT_AGENT: DurableObjectNamespace<ChatAgent>;
  ORDERS_AGENT: DurableObjectNamespace<OrdersAgent>;
};`}
			/>
			<p>
				To use: extend it with your own non-DO bindings and declare the
				result as the <code>Agent</code>&apos;s first generic:
			</p>
			<CodeBlock
				lang="ts"
				code={`type Env = GeneratedEnv & {
  KV: KVNamespace;
  JWT_SECRET: string;
};

export default class MyAgent extends Agent<Env, State> {
  // this.env.CHAT_AGENT is typed to DurableObjectNamespace<ChatAgent>
  // this.env.KV, this.env.JWT_SECRET work too
}`}
			/>

			<Callout kind="tip" title="Path setup">
				<code>@ayjnt/env</code> resolves via tsconfig paths. See{" "}
				<a href="/docs/guides/co-located-ui" className="link-underline">
					Co-located UI
				</a>{" "}
				for the exact config.
			</Callout>

			<h2>@ayjnt/&lt;route&gt;</h2>
			<p>
				One path per agent — <code>@ayjnt/chat</code>,{" "}
				<code>@ayjnt/admin/users</code>, etc. Each exports a typed{" "}
				<code>useAgent</code> hook bound to that agent&apos;s class and
				route prefix.
			</p>
			<CodeBlock
				lang="tsx"
				code={`import { useAgent } from "@ayjnt/counter";

function Counter() {
  const agent = useAgent();
  // agent.state is typed to CounterAgent's State
  // agent.setState round-trips through the DO
  // agent.name is the DO instance name (from the URL)
  return <div>{agent.state?.count ?? 0}</div>;
}`}
			/>

			<h3>Options</h3>
			<CodeBlock
				lang="ts"
				code={`useAgent<State = InferredFromAgentClass>(options?: {
  // All standard agents/react UseAgentOptions except agent and basePath
  name?: string;             // Override URL-derived instance name
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (e: Event) => void;
  onMessage?: (m: MessageEvent) => void;
  onStateUpdate?: (state: State, source: "server" | "client") => void;
  query?: Record<string, string>;
})`}
			/>
			<p>
				<code>agent</code> and <code>basePath</code> are set automatically;
				override <code>name</code> to pick an instance that doesn&apos;t
				come from the URL. Everything else passes through to the upstream{" "}
				<code>useAgent</code>.
			</p>

			<h3>Return value</h3>
			<p>
				An <code>AgentClient</code> instance from the SDK, with{" "}
				<code>.state</code>, <code>.setState</code>, <code>.name</code>,{" "}
				<code>.agent</code>, WebSocket event handlers, method proxies, and
				an async <code>ready</code> promise that resolves once the first{" "}
				<code>CF_AGENT_IDENTITY</code> message arrives. Full shape in the{" "}
				<a
					href="https://developers.cloudflare.com/agents/api-reference/client-sdk/"
					target="_blank"
					rel="noreferrer"
					className="link-underline"
				>
					Cloudflare client SDK reference
				</a>
				.
			</p>
		</DocPageShell>
	);
}
