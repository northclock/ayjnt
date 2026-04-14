import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  classNameToBinding,
  defaultAgentId,
  folderToRoute,
  parseAgentSource,
  resolveMiddlewareChain,
  scan,
} from "./scan.ts";

describe("parseAgentSource", () => {
  test("extracts class name from simple default export", () => {
    expect(
      parseAgentSource(`export default class ChatAgent extends Agent {}`),
    ).toEqual({ className: "ChatAgent", agentId: null });
  });

  test("extracts class name with generic parameters", () => {
    expect(
      parseAgentSource(
        `export default class ChatAgent extends Agent<Env, ChatState> {}`,
      ),
    ).toEqual({ className: "ChatAgent", agentId: null });
  });

  test("extracts agentId override when present", () => {
    const src = `
      export const agentId = "chat_v1";
      export default class ChatAgent extends Agent<Env> {}
    `;
    expect(parseAgentSource(src)).toEqual({
      className: "ChatAgent",
      agentId: "chat_v1",
    });
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
      `export default class ChatAgent extends Agent<Env, ChatState> {}`,
    );
    await writeFile(
      path.join(tmp, "agents/chat/app.tsx"),
      `export default function Chat() { return null; }`,
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

    const admin = byRoute.get("/admin/users");
    expect(admin).toBeDefined();
    expect(admin!.className).toBe("AdminUsersAgent");
    expect(admin!.agentId).toBe("admin_users_v1"); // explicit override wins
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
    rmSync(empty, { recursive: true, force: true });
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
