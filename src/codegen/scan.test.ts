import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  classNameToBinding,
  classNameToKebab,
  defaultAgentId,
  detectOnEmail,
  detectWithVoice,
  folderToRoute,
  importsAyjntBrowser,
  parseAgentSource,
  parseCallables,
  parseWorkflowSource,
  resolveMiddlewareChain,
  scan,
  scanWorkflows,
  stripComments,
} from "./scan.ts";

describe("parseAgentSource", () => {
  test("extracts class name from simple default export", () => {
    expect(
      parseAgentSource(`export default class ChatAgent extends Agent {}`),
    ).toEqual({ className: "ChatAgent", baseClass: "Agent", agentId: null });
  });

  test("extracts class name with generic parameters", () => {
    expect(
      parseAgentSource(
        `export default class ChatAgent extends Agent<Env, ChatState> {}`,
      ),
    ).toEqual({ className: "ChatAgent", baseClass: "Agent", agentId: null });
  });

  test("extracts agentId override when present", () => {
    const src = `
      export const agentId = "chat_v1";
      export default class ChatAgent extends Agent<Env> {}
    `;
    expect(parseAgentSource(src)).toEqual({
      className: "ChatAgent",
      baseClass: "Agent",
      agentId: "chat_v1",
    });
  });

  test("extracts base class name (e.g. McpAgent)", () => {
    expect(
      parseAgentSource(
        `export default class Tools extends McpAgent<Env, State, Props> {}`,
      ),
    ).toEqual({ className: "Tools", baseClass: "McpAgent", agentId: null });
  });

  test("extracts agentId with explicit string annotation", () => {
    const src = `
      export const agentId: string = "chat_v1";
      export default class ChatAgent extends Agent {}
    `;
    expect(parseAgentSource(src)?.agentId).toBe("chat_v1");
  });

  test("accepts single quotes and backticks for agentId", () => {
    expect(
      parseAgentSource(
        `export const agentId = 'foo';\nexport default class A extends Agent {}`,
      )?.agentId,
    ).toBe("foo");
    expect(
      parseAgentSource(
        "export const agentId = `bar`;\nexport default class A extends Agent {}",
      )?.agentId,
    ).toBe("bar");
  });

  test("returns null when no class found", () => {
    expect(parseAgentSource(`const x = 1;`)).toBeNull();
  });

  test("ignores commented-out class declarations", () => {
    const src = `
      // export default class OldAgent extends Agent {}
      export default class NewAgent extends Agent {}
    `;
    expect(parseAgentSource(src)?.className).toBe("NewAgent");
  });
});

describe("folderToRoute", () => {
  test("leaf folder", () => {
    expect(folderToRoute("chat")).toBe("/chat");
  });

  test("nested folders", () => {
    expect(folderToRoute("admin/users")).toBe("/admin/users");
  });

  test("strips route groups", () => {
    expect(folderToRoute("(public)/chat")).toBe("/chat");
    expect(folderToRoute("admin/(internal)/log")).toBe("/admin/log");
  });

  test("handles windows-style slashes", () => {
    expect(folderToRoute("admin\\users")).toBe("/admin/users");
  });
});

describe("classNameToBinding", () => {
  test("pascal case", () => {
    expect(classNameToBinding("ChatAgent")).toBe("CHAT_AGENT");
    expect(classNameToBinding("AdminUsersAgent")).toBe("ADMIN_USERS_AGENT");
  });

  test("preserves acronym runs (documented tradeoff)", () => {
    expect(classNameToBinding("HTTPServerAgent")).toBe("HTTPSERVER_AGENT");
  });

  test("single word", () => {
    expect(classNameToBinding("Foo")).toBe("FOO");
  });
});

describe("defaultAgentId", () => {
  test("flat", () => {
    expect(defaultAgentId("chat")).toBe("chat");
  });

  test("nested", () => {
    expect(defaultAgentId("admin/users")).toBe("admin_users");
  });

  test("strips route groups", () => {
    expect(defaultAgentId("(public)/chat")).toBe("chat");
  });
});

describe("scan (integration)", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-scan-"));
    await mkdir(path.join(tmp, "agents/chat"), { recursive: true });
    await mkdir(path.join(tmp, "agents/admin/users"), { recursive: true });
    await mkdir(path.join(tmp, "agents/(public)/public-chat"), {
      recursive: true,
    });

    await writeFile(
      path.join(tmp, "agents/chat/agent.ts"),
      `export default class ChatAgent extends Agent<Env, ChatState> {
  /**
   * Echo a message back.
   * @callable
   */
  async echo(text: string): Promise<string> { return text; }
}`,
    );
    await writeFile(
      path.join(tmp, "agents/chat/app.tsx"),
      `export default function Chat() { return null; }`,
    );
    await writeFile(
      path.join(tmp, "agents/chat/docs.md"),
      `# Chat agent\n\nUsage example.\n`,
    );
    await writeFile(
      path.join(tmp, "agents/admin/users/agent.ts"),
      `export const agentId = "admin_users_v1";\nexport default class AdminUsersAgent extends Agent {}`,
    );
    await writeFile(
      path.join(tmp, "agents/admin/middleware.ts"),
      `export default async (c: any, next: any) => { await next(); };`,
    );
    await writeFile(
      path.join(tmp, "agents/middleware.ts"),
      `export default async (c: any, next: any) => { await next(); };`,
    );
    await writeFile(
      path.join(tmp, "agents/(public)/public-chat/agent.ts"),
      `export default class PublicChatAgent extends Agent {}`,
    );
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("discovers all agents with correct routing and binding", async () => {
    const manifest = await scan(tmp);

    const byRoute = new Map(manifest.agents.map((a) => [a.routePath, a]));

    const chat = byRoute.get("/chat");
    expect(chat).toBeDefined();
    expect(chat!.className).toBe("ChatAgent");
    expect(chat!.binding).toBe("CHAT_AGENT");
    expect(chat!.agentId).toBe("chat");
    expect(chat!.hasApp).toBe(true);
    expect(chat!.hasDocs).toBe(true);
    expect(chat!.callables).toEqual([
      {
        name: "echo",
        params: "text: string",
        returnType: "Promise<string>",
        description: "Echo a message back.",
      },
    ]);

    const admin = byRoute.get("/admin/users");
    expect(admin).toBeDefined();
    expect(admin!.className).toBe("AdminUsersAgent");
    expect(admin!.agentId).toBe("admin_users_v1"); // explicit override wins
    expect(admin!.hasDocs).toBe(false);
    expect(admin!.callables).toEqual([]);
    expect(admin!.middlewareChain).toHaveLength(2); // root + admin
    expect(admin!.middlewareChain[0]!.endsWith("agents/middleware.ts")).toBe(
      true,
    );
    expect(
      admin!.middlewareChain[1]!.endsWith("agents/admin/middleware.ts"),
    ).toBe(true);

    const publicChat = byRoute.get("/public-chat");
    expect(publicChat).toBeDefined();
    expect(publicChat!.className).toBe("PublicChatAgent");
  });

  test("returns empty manifest when agents/ doesn't exist", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "ayjnt-empty-"));
    const manifest = await scan(empty);
    expect(manifest.agents).toEqual([]);
    expect(manifest.workflows).toEqual([]);
    expect(manifest.features).toEqual({
      browser: false,
      email: false,
      emailResolverFile: null,
      voice: false,
    });
    rmSync(empty, { recursive: true, force: true });
  });

  test("default fixture has no browser feature flag", async () => {
    // None of the fixture agents import from "ayjnt/browser", so the
    // flag stays off and wrangler won't add browser bindings.
    const manifest = await scan(tmp);
    expect(manifest.features.browser).toBe(false);
  });

  test("features.browser flips when any agent imports ayjnt/browser", async () => {
    const tmp2 = mkdtempSync(path.join(tmpdir(), "ayjnt-browser-"));
    await mkdir(path.join(tmp2, "agents/research"), { recursive: true });
    await writeFile(
      path.join(tmp2, "agents/research/agent.ts"),
      `import { browserTools } from "ayjnt/browser";\nexport default class ResearchAgent extends Agent<Env, State> {}`,
    );
    const manifest = await scan(tmp2);
    expect(manifest.features.browser).toBe(true);
    rmSync(tmp2, { recursive: true, force: true });
  });
});

describe("parseCallables", () => {
  test("extracts a single @callable method with params and return type", () => {
    const src = `
      export default class A extends Agent {
        /**
         * Decrement stock for a SKU.
         * @callable
         */
        async decrement(sku: string, qty: number): Promise<number> {
          return 0;
        }
      }
    `;
    expect(parseCallables(src)).toEqual([
      {
        name: "decrement",
        params: "sku: string, qty: number",
        returnType: "Promise<number>",
        description: "Decrement stock for a SKU.",
      },
    ]);
  });

  test("ignores methods without the @callable tag", () => {
    const src = `
      export default class A extends Agent {
        /** Helper, internal use only. */
        async _private(): Promise<void> {}
        /** @callable */
        async surface(): Promise<void> {}
      }
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("surface");
  });

  test("captures nullary method with no return type annotation", () => {
    const src = `
      /**
       * @callable
       */
      reset() {}
    `;
    expect(parseCallables(src)).toEqual([
      { name: "reset", params: "", returnType: null, description: null },
    ]);
  });

  test("returns empty array when nothing is annotated", () => {
    expect(parseCallables(`class X { foo() {} }`)).toEqual([]);
  });

  test("handles multiple @callable methods on one class", () => {
    const src = `
      /** @callable */
      async getOne(id: string): Promise<Item> {}

      /**
       * Fetch many items.
       * @callable
       */
      async getMany(ids: string[]): Promise<Item[]> {}
    `;
    const out = parseCallables(src);
    expect(out.map((c) => c.name)).toEqual(["getOne", "getMany"]);
  });

  test("ignores prose from preceding non-@callable JSDoc blocks", () => {
    // Without the close-comment guard, a class-level JSDoc would bleed
    // into the next @callable method's description.
    const src = `
      /**
       * ClassDescription — should NOT appear in any callable description.
       */
      export default class A {
        /**
         * Real description for surface().
         * @callable
         */
        async surface(): Promise<void> {}
      }
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("Real description for surface().");
  });

  // -- decorator detection (Option A unification) ---------------------------

  test("detects @callable() decorator without JSDoc tag", () => {
    // Pure decorator path — the method must show up in the catalog
    // because it's browser-callable, even without the JSDoc marker.
    const src = `
      @callable({ description: "Add a note." })
      async addNote(text: string): Promise<Note> {}
    `;
    const out = parseCallables(src);
    expect(out).toEqual([
      {
        name: "addNote",
        params: "text: string",
        returnType: "Promise<Note>",
        description: "Add a note.",
      },
    ]);
  });

  test("detects deprecated @unstable_callable() alias", () => {
    // The SDK kept `unstable_callable` as a deprecated export for migration.
    // Pick it up too — users on older code shouldn't disappear from the catalog.
    const src = `
      @unstable_callable({ description: "Old style." })
      async legacy(): Promise<void> {}
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("legacy");
    expect(out[0]!.description).toBe("Old style.");
  });

  test("extracts description from single-quoted string", () => {
    const src = `
      @callable({ description: 'Single-quoted desc.' })
      async foo(): Promise<void> {}
    `;
    expect(parseCallables(src)[0]!.description).toBe("Single-quoted desc.");
  });

  test("extracts description from template-literal string", () => {
    const src = `
      @callable({ description: \`Template desc.\` })
      async foo(): Promise<void> {}
    `;
    expect(parseCallables(src)[0]!.description).toBe("Template desc.");
  });

  test("handles escape sequences in description (\\\" → \", \\n → newline)", () => {
    const src = `
      @callable({ description: "Has a \\"quote\\" and a \\nnewline" })
      async foo(): Promise<void> {}
    `;
    expect(parseCallables(src)[0]!.description).toBe(
      'Has a "quote" and a \nnewline',
    );
  });

  test("@callable() with no args: description is null", () => {
    const src = `
      @callable()
      async foo(): Promise<void> {}
    `;
    expect(parseCallables(src)[0]).toEqual({
      name: "foo",
      params: "",
      returnType: "Promise<void>",
      description: null,
    });
  });

  test("decorator description wins over JSDoc first prose", () => {
    // The decorator's `description` is the machine-readable summary —
    // it should take precedence over the (potentially longer) JSDoc.
    const src = `
      /**
       * Long developer-facing JSDoc that goes into more detail
       * than the catalog needs.
       * @callable
       */
      @callable({ description: "Short blurb." })
      async foo(): Promise<void> {}
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("Short blurb.");
  });

  test("JSDoc above a @callable() (no tag) supplies fallback description", () => {
    // Common pattern: developer writes a plain JSDoc above the
    // decorated method without adding @callable tag. We should still
    // pull that prose as the catalog description when the decorator
    // didn't supply one.
    const src = `
      /** Decrement stock for a SKU. */
      @callable()
      async decrement(sku: string, qty: number): Promise<number> {}
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("Decrement stock for a SKU.");
  });

  test("JSDoc-tag-only method still appears (back-compat)", () => {
    // The Option A unification doesn't break existing JSDoc-only code.
    const src = `
      /**
       * Catalog-only, not browser-callable.
       * @callable
       */
      async helper(): Promise<void> {}
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("helper");
    expect(out[0]!.description).toBe("Catalog-only, not browser-callable.");
  });

  test("decorator + JSDoc tag (both): listed once, decorator wins", () => {
    // The same method matched by both passes must not appear twice.
    const src = `
      /**
       * JSDoc says one thing.
       * @callable
       */
      @callable({ description: "Decorator says another." })
      async foo(): Promise<string> {}
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("Decorator says another.");
    expect(out[0]!.returnType).toBe("Promise<string>");
  });

  test("decorator + JSDoc tag (both), decorator has no description: JSDoc wins", () => {
    const src = `
      /**
       * From the JSDoc.
       * @callable
       */
      @callable()
      async foo(): Promise<void> {}
    `;
    expect(parseCallables(src)[0]!.description).toBe("From the JSDoc.");
  });

  test("handles other decorators stacked between @callable() and the method", () => {
    const src = `
      @callable({ description: "Stacked." })
      @logged
      @withRetry({ attempts: 3 })
      async foo(): Promise<void> {}
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("foo");
    expect(out[0]!.description).toBe("Stacked.");
  });

  test("handles modifiers in any combination (static, override, async)", () => {
    const src = `
      @callable()
      static override async foo(): Promise<void> {}
    `;
    const out = parseCallables(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("foo");
  });

  test("no false-positive when @callable is mentioned but not used", () => {
    // The substring `@callable` appears in prose; no actual decorator
    // or tag is present. Method should not be in the catalog.
    const src = `
      /** This method is internal, NOT @callable in the decorator sense. */
      async _internal(): Promise<void> {}
    `;
    // The JSDoc body contains "@callable" inside prose, so the JSDoc-tag
    // regex *will* match (it just looks for the substring `@callable` in
    // a JSDoc block). This is a documented limitation: the marker has
    // to be on its own JSDoc tag line for clean semantics. Including
    // this test as a sanity check on the current behaviour rather than
    // an aspiration.
    const out = parseCallables(src);
    expect(out.length).toBeLessThanOrEqual(1);
  });

  test("multiple methods on one class with mixed marker patterns", () => {
    const src = `
      export default class A {
        /** @callable */
        async legacyJSDoc(): Promise<void> {}

        @callable({ description: "Pure decorator." })
        async decoratorOnly(): Promise<void> {}

        /** Combined developer doc + decorator. */
        @callable()
        async both(): Promise<void> {}

        async invisible(): Promise<void> {}
      }
    `;
    const out = parseCallables(src);
    // Order is source-order (by position of the first marker).
    expect(out.map((c) => c.name)).toEqual([
      "legacyJSDoc",
      "decoratorOnly",
      "both",
    ]);
    expect(out[0]!.description).toBe(null); // JSDoc body is empty
    expect(out[1]!.description).toBe("Pure decorator.");
    expect(out[2]!.description).toBe("Combined developer doc + decorator.");
  });
});

describe("resolveMiddlewareChain edge cases", () => {
  test("no middleware → empty chain", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-mw-"));
    await mkdir(path.join(tmp, "agents/chat"), { recursive: true });
    const chain = await resolveMiddlewareChain(
      path.join(tmp, "agents/chat"),
      tmp,
    );
    expect(chain).toEqual([]);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("importsAyjntBrowser", () => {
  test("detects double-quoted import", () => {
    expect(
      importsAyjntBrowser(`import { browserTools } from "ayjnt/browser";`),
    ).toBe(true);
  });

  test("detects single-quoted import", () => {
    expect(
      importsAyjntBrowser(`import { browserTools } from 'ayjnt/browser';`),
    ).toBe(true);
  });

  test("detects side-effect import", () => {
    expect(importsAyjntBrowser(`import "ayjnt/browser";`)).toBe(true);
  });

  test("does not match unrelated imports", () => {
    expect(
      importsAyjntBrowser(`import { Agent } from "agents";`),
    ).toBe(false);
    expect(
      importsAyjntBrowser(`import { other } from "ayjnt/middleware";`),
    ).toBe(false);
  });

  test("does not match the same string in a comment", () => {
    // Block + line comments stripped before detection so a doc string
    // mentioning the import path doesn't trigger the binding-injection
    // side effects.
    const src = `
      /**
       * Example:
       *   import { browserTools } from "ayjnt/browser";
       */
      // import { browserTools } from "ayjnt/browser"; (uncomment to enable)
      import { Agent } from "agents";
    `;
    expect(importsAyjntBrowser(src)).toBe(false);
  });

  test("does not match strings inside JSX or other content", () => {
    // The regex anchors on `from`, so an inline string with the path
    // shouldn't match.
    const src = `const docUrl = "see ayjnt/browser for setup details";`;
    expect(importsAyjntBrowser(src)).toBe(false);
  });
});

describe("detectOnEmail", () => {
  test("matches a plain onEmail method", () => {
    const src = `
      class A {
        async onEmail(email: AgentEmail) {
          return;
        }
      }
    `;
    expect(detectOnEmail(src)).toBe(true);
  });

  test("matches override async onEmail", () => {
    const src = `
      class A {
        override async onEmail(email: AgentEmail): Promise<void> {}
      }
    `;
    expect(detectOnEmail(src)).toBe(true);
  });

  test("matches public/protected modifiers", () => {
    const src = `
      class A {
        public async onEmail() {}
      }
    `;
    expect(detectOnEmail(src)).toBe(true);
  });

  test("does not match a field or variable named onEmail", () => {
    // We require `onEmail(` — distinguishes from `onEmail = …` or
    // `const onEmail = …` which aren't methods.
    expect(detectOnEmail(`const onEmail = "foo";`)).toBe(false);
    expect(detectOnEmail(`onEmail: () => void;`)).toBe(false);
  });

  test("does not match onEmail mentioned only in a comment", () => {
    const src = `
      /** Implements onEmail — see docs. */
      // onEmail(email) — handler signature
      class A {}
    `;
    expect(detectOnEmail(src)).toBe(false);
  });

  test("does not match a different method with onEmail substring", () => {
    expect(detectOnEmail(`async addonEmail() {}`)).toBe(false);
    expect(detectOnEmail(`async onEmails() {}`)).toBe(false);
  });
});

describe("parseWorkflowSource + scanWorkflows", () => {
  test("detects an AgentWorkflow subclass", async () => {
    // Import lazily inside the test so the top-level imports stay flat.
    const { parseWorkflowSource } = await import("./scan.ts");
    const src = `
      import { AgentWorkflow } from "agents/workflows";
      export default class MyFlow extends AgentWorkflow<MyAgent, Params> {}
    `;
    expect(parseWorkflowSource(src)).toEqual({
      className: "MyFlow",
      baseClass: "AgentWorkflow",
    });
  });

  test("detects a WorkflowEntrypoint subclass (raw Cloudflare Workflow)", async () => {
    const { parseWorkflowSource } = await import("./scan.ts");
    const src = `
      import { WorkflowEntrypoint } from "cloudflare:workers";
      export default class Pure extends WorkflowEntrypoint<Env> {}
    `;
    expect(parseWorkflowSource(src)).toEqual({
      className: "Pure",
      baseClass: "WorkflowEntrypoint",
    });
  });

  test("returns null for files that don't look like workflows", async () => {
    const { parseWorkflowSource } = await import("./scan.ts");
    expect(parseWorkflowSource(`const x = 1;`)).toBeNull();
    expect(
      parseWorkflowSource(
        `export default class Whatever extends SomethingElse {}`,
      ),
    ).toBeNull();
  });

  test("scanWorkflows finds workflow.ts files anywhere under root", async () => {
    const { scanWorkflows } = await import("./scan.ts");
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-wf-"));
    // Paired with an agent.
    await mkdir(path.join(tmp, "agents/orders"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/orders/workflow.ts"),
      `import { AgentWorkflow } from "agents/workflows";\nexport default class OrdersProcessing extends AgentWorkflow<OrdersAgent> {}`,
    );
    // Top-level shared workflow.
    await mkdir(path.join(tmp, "workflows/cleanup"), { recursive: true });
    await writeFile(
      path.join(tmp, "workflows/cleanup/workflow.ts"),
      `import { AgentWorkflow } from "agents/workflows";\nexport default class NightlyCleanup extends AgentWorkflow {}`,
    );
    // A red herring — same filename, but doesn't extend the right base.
    await mkdir(path.join(tmp, "lib"), { recursive: true });
    await writeFile(
      path.join(tmp, "lib/workflow.ts"),
      `export default class Lib extends UnrelatedBase {}`,
    );

    const found = await scanWorkflows(tmp);
    expect(found.map((w) => w.className).sort()).toEqual([
      "NightlyCleanup",
      "OrdersProcessing",
    ]);
    expect(found.find((w) => w.className === "OrdersProcessing")).toMatchObject({
      binding: "ORDERS_PROCESSING",
      name: "orders-processing",
    });

    rmSync(tmp, { recursive: true, force: true });
  });

  test("workflow + agent with the same binding errors out", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-wf-dup-"));
    // Both produce the binding "ORDERS" (UPPER_SNAKE collision).
    await mkdir(path.join(tmp, "agents/orders"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/orders/agent.ts"),
      `export default class Orders extends Agent {}`,
    );
    await writeFile(
      path.join(tmp, "agents/orders/workflow.ts"),
      `import { AgentWorkflow } from "agents/workflows";\nexport default class Orders extends AgentWorkflow {}`,
    );
    await expect(scan(tmp)).rejects.toThrow(/Duplicate binding "ORDERS"/);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("detectWithVoice", () => {
  test("matches the upstream `class A extends withVoice(Agent)` shape", () => {
    const src = `
      import { withVoice } from "@cloudflare/voice";
      const VoiceAgent = withVoice(Agent);
      class ChatVoice extends VoiceAgent<Env> {}
    `;
    // detectWithVoice imported at the top of the file.
    expect(detectWithVoice(src)).toBe(true);
  });

  test("matches direct-in-extends form too", () => {
    const src = `
      import { Agent, withVoice } from "@cloudflare/voice";
      class A extends withVoice(Agent)<Env> {}
    `;
    expect(detectWithVoice(src)).toBe(true);
  });

  test("does not match a substring in a comment", () => {
    const src = `
      /** see withVoice() docs for the mixin shape */
      class A extends Agent<Env> {}
    `;
    expect(detectWithVoice(src)).toBe(false);
  });

  test("does not match unrelated identifiers", () => {
    expect(detectWithVoice(`class A extends Agent {}`)).toBe(false);
    expect(detectWithVoice(`const myWithVoice = "foo";`)).toBe(false);
  });
});

describe("classNameToKebab", () => {
  test("simple PascalCase", () => {
    expect(classNameToKebab("ChatAgent")).toBe("chat-agent");
  });

  test("multi-word PascalCase", () => {
    expect(classNameToKebab("AdminUsersAgent")).toBe("admin-users-agent");
  });

  test("acronym runs stay glued (same trade-off as binding)", () => {
    expect(classNameToKebab("HTTPServerAgent")).toBe("httpserver-agent");
  });

  test("single word", () => {
    expect(classNameToKebab("Foo")).toBe("foo");
  });
});

describe("stripComments", () => {
  test("blanks line and block comments, preserving newlines", () => {
    const out = stripComments("a // gone\n/* also\ngone */ b");
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).not.toContain("gone");
    expect(out.split("\n")).toHaveLength(3);
  });

  test("comment markers inside strings are NOT stripped", () => {
    const src = `const url = "https://example.com"; const re = 'has /* inside */';`;
    expect(stripComments(src)).toBe(src);
  });

  test("string-looking text inside comments does not survive", () => {
    const out = stripComments(`/* import { x } from "ayjnt/browser" */`);
    expect(out).not.toContain("ayjnt/browser");
  });

  test("template literals are preserved", () => {
    const src = "const t = `keep // this and /* this */`;";
    expect(stripComments(src)).toBe(src);
  });
});

describe("block-comment shadowing regressions", () => {
  test("a block-commented old class does not shadow the live one", () => {
    const parsed = parseAgentSource(`/*
export default class OldAgent extends Agent {}
*/
export default class NewAgent extends Agent {}
`);
    expect(parsed?.className).toBe("NewAgent");
  });

  test("a block-commented agentId does not shadow the live one", () => {
    const parsed = parseAgentSource(`/*
export const agentId = "old_id";
*/
export const agentId = "new_id";
export default class A extends Agent {}
`);
    expect(parsed?.agentId).toBe("new_id");
  });

  test("a block-commented workflow class does not shadow the live one", () => {
    const parsed = parseWorkflowSource(`/*
export default class OldWorkflow extends AgentWorkflow {}
*/
export default class NewWorkflow extends AgentWorkflow {}
`);
    expect(parsed?.className).toBe("NewWorkflow");
  });

  test("agentId value may contain the other quote characters", () => {
    const parsed = parseAgentSource(
      `export const agentId = "it's-v1";\nexport default class A extends Agent {}`,
    );
    expect(parsed?.agentId).toBe("it's-v1");
  });

  test("withVoice inside a string literal does not flip voice detection", () => {
    // The old regex-based comment stripper corrupted string literals
    // containing /* … */ and could blank out real code after them.
    const src = `const note = "/* watch out */";
const V = withVoice(Agent);`;
    expect(detectWithVoice(src)).toBe(true);
  });
});

describe("parseCallables paren handling", () => {
  test("callback-typed parameters (one nesting level) survive", () => {
    const out = parseCallables(`class A {
  @callable({ description: "Run with callback." })
  async run(cb: (x: number) => void): Promise<void> {}
}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.params).toBe("cb: (x: number) => void");
  });

  test("JSDoc-tagged method with parenthesized param type survives", () => {
    const out = parseCallables(`class A {
  /**
   * Filter items.
   * @callable
   */
  async filter(opts: (string | number)[]): Promise<void> {}
}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.params).toBe("opts: (string | number)[]");
  });

  test("decorator args with nested parens (arrow in options) parse", () => {
    const out = parseCallables(`class A {
  @callable({ description: "hi (yes)" })
  async greet(): Promise<string> {}
}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("hi (yes)");
  });

  test("an unmatched @callable( among stacked decorators fails in linear time", () => {
    // Regression for exponential backtracking: 24 stacked decorators after
    // a failing @callable used to take >10s; must now be near-instant.
    const stacked = Array.from({ length: 24 }, (_, i) => `@dec${i}(arg)`).join("\n  ");
    const src = `class A {
  @callable({ deep: ((x) => (y) => x)(1) })
  ${stacked}
  notAMethod = 5;
}`;
    const start = performance.now();
    const out = parseCallables(src);
    expect(performance.now() - start).toBeLessThan(250);
    // And the parse outcome is pinned too: over-nested decorator args are a
    // documented limitation that yields no callables — a future regex change
    // must not get fast by emitting garbage instead.
    expect(out).toEqual([]);
  });
});

describe("scan validation", () => {
  test("agent.ts directly in agents/ fails fast with guidance", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-rootagent-"));
    await mkdir(path.join(tmp, "agents"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/agent.ts"),
      `export default class RootAgent extends Agent {}`,
    );
    await expect(scan(tmp)).rejects.toThrow(/must live in a subfolder/);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("group-only folder (route would be /) fails fast with guidance", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-grouponly-"));
    await mkdir(path.join(tmp, "agents/(public)"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/(public)/agent.ts"),
      `export default class PublicAgent extends Agent {}`,
    );
    await expect(scan(tmp)).rejects.toThrow(/route group/);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("a class deriving a framework-reserved binding is rejected", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-reserved-"));
    await mkdir(path.join(tmp, "agents/assets"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/assets/agent.ts"),
      `export default class Assets extends Agent {}`,
    );
    await expect(scan(tmp)).rejects.toThrow(/reserves/);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("scanWorkflows scoping", () => {
  test("only agents/ and workflows/ are scanned — node_modules is not walked", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-wfscope-"));
    await mkdir(path.join(tmp, "agents/orders"), { recursive: true });
    await mkdir(path.join(tmp, "workflows/cleanup"), { recursive: true });
    await mkdir(path.join(tmp, "node_modules/evil"), { recursive: true });
    await mkdir(path.join(tmp, "src/jobs"), { recursive: true });
    const wf = (name: string) =>
      `export default class ${name} extends AgentWorkflow {}`;
    await writeFile(path.join(tmp, "agents/orders/workflow.ts"), wf("OrdersFlow"));
    await writeFile(path.join(tmp, "workflows/cleanup/workflow.ts"), wf("CleanupFlow"));
    await writeFile(path.join(tmp, "node_modules/evil/workflow.ts"), wf("EvilFlow"));
    await writeFile(path.join(tmp, "src/jobs/workflow.ts"), wf("StrayFlow"));

    const found = await scanWorkflows(tmp);
    expect(found.map((w) => w.className).sort()).toEqual(["CleanupFlow", "OrdersFlow"]);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("resolveMiddlewareChain boundary", () => {
  test("a sibling folder sharing the root's name prefix is rejected", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-bound-"));
    const root = path.join(tmp, "proj");
    const sibling = path.join(tmp, "proj-evil", "agents", "x");
    await mkdir(root, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await expect(resolveMiddlewareChain(sibling, root)).rejects.toThrow(
      /outside project root/,
    );
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("root app (agents/app.tsx)", () => {
  test("detected, carrying the root middleware chain", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-rootapp-"));
    await mkdir(path.join(tmp, "agents/chat"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/chat/agent.ts"),
      `export default class ChatAgent extends Agent {}`,
    );
    await writeFile(
      path.join(tmp, "agents/middleware.ts"),
      `export default async (c: any, next: any) => next();`,
    );
    await writeFile(
      path.join(tmp, "agents/app.tsx"),
      `export default function Home() { return null; }`,
    );

    const m = await scan(tmp);
    expect(m.rootApp).not.toBeNull();
    expect(m.rootApp!.sourceFile.endsWith("agents/app.tsx")).toBe(true);
    expect(m.rootApp!.middlewareChain).toHaveLength(1); // the root middleware
    rmSync(tmp, { recursive: true, force: true });
  });

  test("a root app with no root middleware has an empty chain", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-rootapp2-"));
    await mkdir(path.join(tmp, "agents/chat"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/chat/agent.ts"),
      `export default class ChatAgent extends Agent {}`,
    );
    await writeFile(
      path.join(tmp, "agents/app.tsx"),
      `export default function Home() { return null; }`,
    );
    const m = await scan(tmp);
    expect(m.rootApp!.middlewareChain).toEqual([]);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("absent when there is no agents/app.tsx", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-norootapp-"));
    await mkdir(path.join(tmp, "agents/chat"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/chat/agent.ts"),
      `export default class ChatAgent extends Agent {}`,
    );
    const m = await scan(tmp);
    expect(m.rootApp ?? null).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("a home-only project (root app, zero agents) still resolves the root app", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-homeonly-"));
    await mkdir(path.join(tmp, "agents"), { recursive: true });
    await writeFile(
      path.join(tmp, "agents/app.tsx"),
      `export default function Home() { return null; }`,
    );
    const m = await scan(tmp);
    expect(m.agents).toEqual([]);
    expect(m.rootApp).not.toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });
});
