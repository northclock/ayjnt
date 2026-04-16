import { DocPageShell } from "@/components/DocPageShell";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata = {
	title: "Middleware — ayjnt docs",
	description:
		"Writing middleware.ts, the Context object, root-to-leaf chaining, response wrapping, and per-request data stashing.",
};

export default function Page() {
	return (
		<DocPageShell
			slug="guides/middleware"
			lede="Middleware is a plain function that sits between a request and an agent. Put one in any folder under agents/ and it applies to everything below."
		>
			<h2>The contract</h2>
			<CodeBlock
				lang="ts"
				code={`type Middleware<Env = unknown> = (
  c: Context<Env>,
  next: () => Promise<Response>,
) => Promise<Response> | Response;`}
			/>
			<p>
				A middleware receives a <code>Context</code> (details below) and a{" "}
				<code>next</code> callable. It returns a <code>Response</code> either
				by calling <code>next()</code> (hand off to the next layer) or by
				returning directly (short-circuit).
			</p>

			<h2>Your first middleware</h2>
			<p>
				Create <code>agents/middleware.ts</code> at the root of your{" "}
				<code>agents/</code> folder:
			</p>
			<CodeBlock
				filename="agents/middleware.ts"
				lang="ts"
				code={`import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  const start = Date.now();
  console.log(\`\${c.request.method} \${c.url.pathname}\`);
  const res = await next();
  const ms = Date.now() - start;

  const headers = new Headers(res.headers);
  headers.set("x-response-time-ms", String(ms));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};

export default middleware;`}
			/>
			<p>
				This one logs every request and stamps a{" "}
				<code>x-response-time-ms</code> header on every response — including
				responses from agents deeper in the tree. The pattern for
				&ldquo;wrap the response after it comes back&rdquo; is:{" "}
				<code>const res = await next(); return new Response(res.body, ...)</code>.
			</p>

			<Callout kind="danger" title="Don't consume the stream">
				<p>
					If you write <code>await res.text()</code> or{" "}
					<code>await res.json()</code> on the response from <code>next()</code>{" "}
					and don&apos;t reconstruct a new Response with a fresh body,{" "}
					you&apos;ll send an empty body to the client. Streams can only be
					read once.
				</p>
				<p>
					The pattern in the example — passing <code>res.body</code> through
					to a new Response — keeps the body as a stream that the client
					eventually consumes.
				</p>
			</Callout>

			<h2>Short-circuiting</h2>
			<p>
				Return a <code>Response</code> without calling <code>next()</code>{" "}
				and the rest of the chain (plus the agent) is skipped:
			</p>
			<CodeBlock
				filename="agents/admin/middleware.ts"
				lang="ts"
				code={`import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  const auth = c.request.headers.get("authorization");
  if (auth !== "Bearer letmein") {
    return c.text("forbidden", 403);
  }
  c.set("authenticated", true);
  return next();
};

export default middleware;`}
				highlightLines={[5, 6, 7, 8]}
			/>
			<p>
				Requests to anything under <code>agents/admin/</code> without the
				right bearer token get a <code>403</code> without the agent ever
				running. The outer root-level middleware still gets to wrap the
				response on the way out (timing header, etc.) because it&apos;s in
				the chain above the gate.
			</p>

			<h2>The chain, root → leaf</h2>
			<p>
				Every <code>middleware.ts</code> from the project root down to the
				agent folder contributes one layer. The scanner walks up from the
				agent&apos;s folder and collects them in order:
			</p>
			<CodeBlock
				lang="sh"
				code={`Request: /admin/users/alice

Chain:
  agents/middleware.ts            (timing + logging)
  agents/admin/middleware.ts      (bearer token check)
  AdminUsersAgent.onRequest       (the agent itself)

Returning: agent response → admin wraps → root wraps → client`}
			/>
			<p>
				Route-group folders (<code>(public)/</code>, <code>(auth)/</code>)
				contribute to the chain but don&apos;t appear in the URL, which is
				useful for sharing auth across several agents that don&apos;t share a
				URL prefix. See{" "}
				<a href="/docs/guides/file-conventions" className="link-underline">
					File conventions
				</a>{" "}
				for the route-group pattern.
			</p>

			<h2>The Context object</h2>
			<CodeBlock
				lang="ts"
				code={`type Context<Env = unknown> = {
  readonly request: Request;            // original incoming request
  readonly url: URL;                    // parsed URL
  readonly env: Env;                    // bindings, as typed by Env
  readonly executionCtx: ExecutionContext;  // waitUntil, passThroughOnException
  readonly params: {
    instanceId: string;                 // first path segment after route prefix
    pathSuffix: string;                 // everything after that, always starts "/"
  };

  json(body: unknown, init?: number | ResponseInit): Response;
  text(body: string, init?: number | ResponseInit): Response;
  html(body: string, init?: number | ResponseInit): Response;
  redirect(location: string, status?: number): Response;

  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T | undefined;
};`}
			/>

			<h3>Response helpers</h3>
			<p>
				<code>c.json(body)</code>, <code>c.text(body)</code>,{" "}
				<code>c.html(body)</code>, <code>c.redirect(url, status)</code>.
				The second argument to each accepts either a status number or a
				full <code>ResponseInit</code> — matching Hono&apos;s signature. For
				example:
			</p>
			<CodeBlock
				lang="ts"
				code={`return c.text("forbidden", 403);
return c.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": "60" } });
return c.redirect("/login");`}
			/>

			<h3>c.set / c.get — per-request stash</h3>
			<p>
				Middleware can attach values to the context for downstream middleware
				to read. Scope is a single request; values don&apos;t leak:
			</p>
			<CodeBlock
				lang="ts"
				code={`// In root middleware — parse auth once
const token = await verifyJwt(c.request.headers.get("authorization"));
c.set("user", token.user);

// In a nested middleware — re-use without re-parsing
const user = c.get<User>("user");
if (user.role !== "admin") return c.text("forbidden", 403);`}
			/>

			<Callout kind="note" title="Doesn't reach the agent">
				<p>
					<code>c.set</code> is visible to other middleware in the same
					request — not to the agent itself. The agent runs inside a
					Durable Object, which is a different execution context; the
					per-request stash doesn&apos;t survive the DO boundary.
				</p>
				<p>
					To pass a value from middleware to the agent, either set a request
					header before <code>next()</code> or include it in the request
					body. Many teams standardize on a set of <code>x-auth-*</code>{" "}
					headers that root middleware populates.
				</p>
			</Callout>

			<h2>Typing env</h2>
			<p>
				The <code>Middleware</code> type is generic over <code>Env</code> —
				the second generic on <code>Agent</code>. Parameterize it for
				autocomplete:
			</p>
			<CodeBlock
				lang="ts"
				code={`import type { Middleware } from "ayjnt/middleware";
import type { GeneratedEnv } from "@ayjnt/env";

type MyEnv = GeneratedEnv & {
  KV: KVNamespace;
  JWT_SECRET: string;
};

const middleware: Middleware<MyEnv> = async (c, next) => {
  const cached = await c.env.KV.get(c.params.instanceId);
  // ...
};`}
			/>
			<p>
				Most middleware declares its own <code>Env</code> alias to pick up
				the bindings it cares about plus <code>GeneratedEnv</code> for the
				DO namespaces.
			</p>

			<h2>Common patterns</h2>

			<h3>CORS</h3>
			<CodeBlock
				lang="ts"
				code={`const middleware: Middleware = async (c, next) => {
  if (c.request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, DELETE",
        "access-control-allow-headers": "content-type, authorization",
      },
    });
  }
  const res = await next();
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", "*");
  return new Response(res.body, { status: res.status, headers });
};`}
			/>

			<h3>Rate limiting via KV</h3>
			<CodeBlock
				lang="ts"
				code={`const middleware: Middleware<MyEnv> = async (c, next) => {
  const ip = c.request.headers.get("cf-connecting-ip") ?? "anon";
  const key = \`rl:\${ip}\`;
  const hits = Number(await c.env.KV.get(key)) || 0;
  if (hits > 100) return c.json({ error: "rate limited" }, 429);
  c.executionCtx.waitUntil(c.env.KV.put(key, String(hits + 1), { expirationTtl: 60 }));
  return next();
};`}
			/>

			<h3>Request logging with timing</h3>
			<p>
				The root-middleware example at the top of this page is already the
				canonical form. Add structured fields (user id from{" "}
				<code>c.get</code>, request id, status code) for your observability
				backend of choice.
			</p>

			<h2>What order things execute in</h2>
			<p>
				For a request to <code>/admin/users/bob</code> with a root timing
				middleware and an admin auth middleware:
			</p>
			<ol>
				<li>Root middleware starts: records <code>start = Date.now()</code>.</li>
				<li>
					Root calls <code>next()</code> → admin middleware starts.
				</li>
				<li>Admin checks bearer → calls <code>next()</code>.</li>
				<li>Agent <code>onRequest</code> runs, returns a Response.</li>
				<li>Admin receives response, returns it unchanged.</li>
				<li>
					Root receives response, wraps with timing header, returns.
				</li>
				<li>Client receives the final response.</li>
			</ol>
			<p>
				If admin short-circuits (returns 403 without calling next), the
				agent doesn&apos;t run but root still wraps — the short-circuit
				response gets the timing header too.
			</p>

			<h2>Calling next() twice is a bug</h2>
			<p>
				If a single middleware calls <code>await next()</code> more than
				once, the framework throws{" "}
				<code>next() called multiple times in a middleware</code>. There&apos;s
				no useful semantic to it — either you meant to short-circuit
				(don&apos;t call next) or to wrap (call once, use the response). The
				error makes the bug loud.
			</p>
		</DocPageShell>
	);
}
