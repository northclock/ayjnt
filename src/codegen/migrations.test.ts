import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type {
  AgentEntry,
  Manifest,
  MigrationLockfile,
} from "../core/types.ts";
import {
  EMPTY_LOCKFILE,
  applyDiff,
  diffMigrations,
  nextTag,
  readLockfile,
  writeLockfile,
} from "./migrations.ts";

function agent(overrides: Partial<AgentEntry>): AgentEntry {
  return {
    agentId: "chat",
    className: "ChatAgent",
    baseClass: "Agent",
    folderPath: "chat",
    routePath: "/chat",
    binding: "CHAT_AGENT",
    sourceFile: "/fake/agents/chat/agent.ts",
    hasApp: false,
    hasDocs: false,
    callables: [],
    hasOnEmail: false,
    isVoice: false,
    middlewareChain: [],
    ...overrides,
  };
}

function manifestOf(agents: AgentEntry[]): Manifest {
  return {
    root: "/fake",
    agents,
    workflows: [],
    features: { browser: false, email: false, emailResolverFile: null, voice: false },
  };
}

describe("nextTag", () => {
  test("empty lockfile → v1", () => {
    expect(nextTag(EMPTY_LOCKFILE)).toBe("v1");
  });

  test("increments past max", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [
        { tag: "v1", timestamp: "x" },
        { tag: "v3", timestamp: "x" }, // sparse ok
      ],
      classes: {},
    };
    expect(nextTag(lf)).toBe("v4");
  });

  test("ignores non-vN tags", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [
        { tag: "initial", timestamp: "x" },
        { tag: "v2", timestamp: "x" },
      ],
      classes: {},
    };
    expect(nextTag(lf)).toBe("v3");
  });
});

describe("diffMigrations", () => {
  test("first build from empty lockfile → all added", () => {
    const manifest = manifestOf([
      agent({ agentId: "chat", className: "ChatAgent" }),
      agent({ agentId: "admin_users", className: "AdminUsersAgent" }),
    ]);
    const diff = diffMigrations(EMPTY_LOCKFILE, manifest);
    expect(diff.added).toHaveLength(2);
    expect(diff.renamed).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.nextEntry?.tag).toBe("v1");
    expect(diff.nextEntry?.new_sqlite_classes).toEqual([
      "ChatAgent",
      "AdminUsersAgent",
    ]);
  });

  test("unchanged manifest → no pending entry", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [
        {
          tag: "v1",
          timestamp: "2026-01-01T00:00:00Z",
          new_sqlite_classes: ["ChatAgent"],
        },
      ],
      classes: {
        chat: { agentId: "chat", className: "ChatAgent", firstTag: "v1" },
      },
    };
    const manifest = manifestOf([agent({})]);
    const diff = diffMigrations(lf, manifest);
    expect(diff.nextEntry).toBeNull();
  });

  test("rename: same agentId, different className", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [
        {
          tag: "v1",
          timestamp: "x",
          new_sqlite_classes: ["OldName"],
        },
      ],
      classes: {
        chat: { agentId: "chat", className: "OldName", firstTag: "v1" },
      },
    };
    const manifest = manifestOf([agent({ className: "NewName" })]);
    const diff = diffMigrations(lf, manifest);
    expect(diff.renamed).toEqual([
      { from: "OldName", to: "NewName", agentId: "chat" },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.nextEntry?.renamed_classes).toEqual([
      { from: "OldName", to: "NewName" },
    ]);
    expect(diff.nextEntry?.new_sqlite_classes).toBeUndefined();
  });

  test("delete: agentId in lockfile missing from manifest", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [
        { tag: "v1", timestamp: "x", new_sqlite_classes: ["ChatAgent"] },
      ],
      classes: {
        chat: { agentId: "chat", className: "ChatAgent", firstTag: "v1" },
      },
    };
    const manifest = manifestOf([]); // no agents
    const diff = diffMigrations(lf, manifest);
    expect(diff.deleted).toEqual([{ agentId: "chat", className: "ChatAgent" }]);
    expect(diff.nextEntry?.deleted_classes).toEqual(["ChatAgent"]);
  });

  test("combined: add + rename + delete in one migration", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [
        {
          tag: "v1",
          timestamp: "x",
          new_sqlite_classes: ["ChatAgent", "OldAgent", "DoomedAgent"],
        },
      ],
      classes: {
        chat: { agentId: "chat", className: "ChatAgent", firstTag: "v1" },
        old_one: { agentId: "old_one", className: "OldAgent", firstTag: "v1" },
        doomed: {
          agentId: "doomed",
          className: "DoomedAgent",
          firstTag: "v1",
        },
      },
    };
    const manifest = manifestOf([
      agent({ agentId: "chat", className: "ChatAgent", routePath: "/chat" }),
      agent({
        agentId: "old_one",
        className: "RenamedAgent",
        routePath: "/old-one",
      }),
      agent({
        agentId: "new_one",
        className: "BrandNewAgent",
        routePath: "/new-one",
        binding: "BRAND_NEW_AGENT",
      }),
    ]);
    const diff = diffMigrations(lf, manifest);
    expect(diff.added.map((a) => a.className)).toEqual(["BrandNewAgent"]);
    expect(diff.renamed).toEqual([
      { from: "OldAgent", to: "RenamedAgent", agentId: "old_one" },
    ]);
    expect(diff.deleted).toEqual([
      { agentId: "doomed", className: "DoomedAgent" },
    ]);
    expect(diff.nextEntry?.tag).toBe("v2");
  });
});

describe("applyDiff", () => {
  test("no-op when no pending entry", () => {
    const noDiff = { added: [], renamed: [], deleted: [], moved: [], nextEntry: null };
    expect(applyDiff(EMPTY_LOCKFILE, noDiff)).toBe(EMPTY_LOCKFILE);
  });

  test("add: inserts into classes with firstTag", () => {
    const manifest = manifestOf([agent({})]);
    const diff = diffMigrations(EMPTY_LOCKFILE, manifest);
    const result = applyDiff(EMPTY_LOCKFILE, diff);
    expect(result.classes["chat"]).toEqual({
      agentId: "chat",
      className: "ChatAgent",
      firstTag: "v1",
    });
    expect(result.migrations).toHaveLength(1);
  });

  test("rename: updates className, preserves firstTag", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [{ tag: "v1", timestamp: "x" }],
      classes: {
        chat: { agentId: "chat", className: "OldName", firstTag: "v1" },
      },
    };
    const manifest = manifestOf([agent({ className: "NewName" })]);
    const diff = diffMigrations(lf, manifest);
    const result = applyDiff(lf, diff);
    expect(result.classes["chat"]).toEqual({
      agentId: "chat",
      className: "NewName",
      firstTag: "v1", // preserved
    });
  });

  test("delete: removes from classes", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [{ tag: "v1", timestamp: "x" }],
      classes: {
        chat: { agentId: "chat", className: "ChatAgent", firstTag: "v1" },
      },
    };
    const manifest = manifestOf([]);
    const diff = diffMigrations(lf, manifest);
    const result = applyDiff(lf, diff);
    expect(result.classes["chat"]).toBeUndefined();
  });

  test("append-only: preserves past migrations", () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [
        { tag: "v1", timestamp: "x", new_sqlite_classes: ["Foo"] },
      ],
      classes: {
        foo: { agentId: "foo", className: "Foo", firstTag: "v1" },
      },
    };
    const manifest = manifestOf([
      agent({ agentId: "foo", className: "Foo", routePath: "/foo" }),
      agent({
        agentId: "bar",
        className: "Bar",
        routePath: "/bar",
        binding: "BAR",
      }),
    ]);
    const diff = diffMigrations(lf, manifest);
    const result = applyDiff(lf, diff);
    expect(result.migrations).toHaveLength(2);
    expect(result.migrations[0]!.tag).toBe("v1");
    expect(result.migrations[1]!.tag).toBe("v2");
  });
});

describe("read/write lockfile (I/O)", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-lock-"));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("read returns empty when file missing", async () => {
    const lf = await readLockfile(tmp);
    expect(lf).toEqual(EMPTY_LOCKFILE);
  });

  test("write + read round-trip", async () => {
    const lf: MigrationLockfile = {
      version: 1,
      migrations: [
        { tag: "v1", timestamp: "2026-04-14T00:00:00Z", new_sqlite_classes: ["A"] },
      ],
      classes: { a: { agentId: "a", className: "A", firstTag: "v1" } },
    };
    await writeLockfile(tmp, lf);
    const read = await readLockfile(tmp);
    expect(read).toEqual(lf);
  });

  test("rejects unsupported version", async () => {
    const badPath = path.join(tmp, ".ayjnt/migrations.json");
    await Bun.write(badPath, JSON.stringify({ version: 999 }));
    await expect(readLockfile(tmp)).rejects.toThrow(/version 999/);
  });
});

describe("folder moves (agentId changed, className unchanged)", () => {
  const lockAfterFirstBuild = (): typeof EMPTY_LOCKFILE => ({
    version: 1,
    migrations: [
      { tag: "v1", timestamp: "2026-01-01T00:00:00.000Z", new_sqlite_classes: ["ChatAgent"] },
    ],
    classes: {
      chat: { agentId: "chat", className: "ChatAgent", firstTag: "v1" },
    },
  });

  test("REGRESSION: renaming the folder must NOT emit delete+create of the same class", () => {
    // agents/chat → agents/support with no explicit agentId: the derived
    // agentId changes but the class doesn't. The old differ emitted
    // deleted_classes:["ChatAgent"] + new_sqlite_classes:["ChatAgent"] in
    // one entry — wrangler executes that as "destroy all storage and
    // recreate the class".
    const moved = agent({ agentId: "support", routePath: "/support", folderPath: "support" });
    const diff = diffMigrations(lockAfterFirstBuild(), manifestOf([moved]));

    expect(diff.nextEntry).toBeNull();
    expect(diff.added).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.moved).toEqual([
      { fromAgentId: "chat", toAgentId: "support", className: "ChatAgent" },
    ]);
  });

  test("applyDiff re-keys the lockfile entry and preserves firstTag", () => {
    const moved = agent({ agentId: "support", routePath: "/support", folderPath: "support" });
    const lock = lockAfterFirstBuild();
    const diff = diffMigrations(lock, manifestOf([moved]));
    const result = applyDiff(lock, diff);

    expect(result.classes["chat"]).toBeUndefined();
    expect(result.classes["support"]).toEqual({
      agentId: "support",
      className: "ChatAgent",
      firstTag: "v1",
    });
    // No new migration entry was appended.
    expect(result.migrations).toHaveLength(1);
  });

  test("a move combined with a genuine addition stages only the addition", () => {
    const movedChat = agent({ agentId: "support", routePath: "/support", folderPath: "support" });
    const brandNew = agent({
      agentId: "orders",
      className: "OrdersAgent",
      binding: "ORDERS_AGENT",
      routePath: "/orders",
      folderPath: "orders",
      sourceFile: "/fake/agents/orders/agent.ts",
    });
    const diff = diffMigrations(lockAfterFirstBuild(), manifestOf([movedChat, brandNew]));

    expect(diff.moved).toHaveLength(1);
    expect(diff.nextEntry?.new_sqlite_classes).toEqual(["OrdersAgent"]);
    expect(diff.nextEntry?.deleted_classes).toBeUndefined();
  });

  test("a genuine delete + unrelated add still stages both", () => {
    const brandNew = agent({
      agentId: "orders",
      className: "OrdersAgent",
      binding: "ORDERS_AGENT",
      routePath: "/orders",
      folderPath: "orders",
      sourceFile: "/fake/agents/orders/agent.ts",
    });
    const diff = diffMigrations(lockAfterFirstBuild(), manifestOf([brandNew]));
    expect(diff.moved).toEqual([]);
    expect(diff.nextEntry?.new_sqlite_classes).toEqual(["OrdersAgent"]);
    expect(diff.nextEntry?.deleted_classes).toEqual(["ChatAgent"]);
  });
});

describe("readLockfile validation", () => {
  test("corrupt JSON throws with the file path and git guidance", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-lock-"));
    const dir = path.join(tmp, ".ayjnt");
    await Bun.write(path.join(dir, "migrations.json"), "{ not json");
    await expect(readLockfile(tmp)).rejects.toThrow(/not valid JSON[\s\S]*git/);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("wrong shape throws with a specific reason", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-lock2-"));
    await Bun.write(
      path.join(tmp, ".ayjnt", "migrations.json"),
      JSON.stringify({ version: 1, migrations: "nope", classes: {} }),
    );
    await expect(readLockfile(tmp)).rejects.toThrow(/"migrations" must be an array/);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("unsupported version still throws", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-lock3-"));
    await Bun.write(
      path.join(tmp, ".ayjnt", "migrations.json"),
      JSON.stringify({ version: 2, migrations: [], classes: {} }),
    );
    await expect(readLockfile(tmp)).rejects.toThrow(/version 2/);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("class-name-first identity resolution (round-2 regressions)", () => {
  test("folder move + reoccupied folder: storage follows the class, newcomer is an addition", () => {
    // agents/chat (ChatAgent) moves to agents/support, and a brand-new
    // FreshAgent takes over agents/chat. The agentId-first rule emitted
    // renamed_classes [ChatAgent -> FreshAgent] — handing ChatAgent's
    // production storage to the newcomer.
    const lock = {
      version: 1 as const,
      migrations: [
        { tag: "v1", timestamp: "t", new_sqlite_classes: ["ChatAgent"] },
      ],
      classes: { chat: { agentId: "chat", className: "ChatAgent", firstTag: "v1" } },
    };
    const manifest = manifestOf([
      agent({ agentId: "support", routePath: "/support", folderPath: "support" }),
      agent({
        agentId: "chat",
        className: "FreshAgent",
        binding: "FRESH_AGENT",
        sourceFile: "/fake/agents/chat/agent.ts",
      }),
    ]);
    const diff = diffMigrations(lock, manifest);

    expect(diff.moved).toEqual([
      { fromAgentId: "chat", toAgentId: "support", className: "ChatAgent" },
    ]);
    expect(diff.renamed).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.nextEntry?.new_sqlite_classes).toEqual(["FreshAgent"]);

    const after = applyDiff(lock, diff);
    expect(after.classes["support"]?.className).toBe("ChatAgent");
    expect(after.classes["chat"]?.className).toBe("FreshAgent");
  });

  test("two-folder swap: pure moves, no migration entry, no rename cycle", () => {
    const lock = {
      version: 1 as const,
      migrations: [
        { tag: "v1", timestamp: "t", new_sqlite_classes: ["AAgent", "BAgent"] },
      ],
      classes: {
        x: { agentId: "x", className: "AAgent", firstTag: "v1" },
        y: { agentId: "y", className: "BAgent", firstTag: "v1" },
      },
    };
    const manifest = manifestOf([
      agent({ agentId: "y", className: "AAgent", binding: "A_AGENT", routePath: "/y", folderPath: "y", sourceFile: "/fake/agents/y/agent.ts" }),
      agent({ agentId: "x", className: "BAgent", binding: "B_AGENT", routePath: "/x", folderPath: "x", sourceFile: "/fake/agents/x/agent.ts" }),
    ]);
    const diff = diffMigrations(lock, manifest);

    expect(diff.nextEntry).toBeNull();
    expect(diff.renamed).toEqual([]);
    expect(diff.moved).toHaveLength(2);

    const after = applyDiff(lock, diff);
    expect(after.classes["y"]?.className).toBe("AAgent");
    expect(after.classes["x"]?.className).toBe("BAgent");
  });

  test("in-place class rename still produces renamed_classes", () => {
    const lock = {
      version: 1 as const,
      migrations: [
        { tag: "v1", timestamp: "t", new_sqlite_classes: ["ChatAgent"] },
      ],
      classes: { chat: { agentId: "chat", className: "ChatAgent", firstTag: "v1" } },
    };
    const diff = diffMigrations(
      lock,
      manifestOf([agent({ className: "SuperChatAgent", binding: "SUPER_CHAT_AGENT" })]),
    );
    expect(diff.renamed).toEqual([
      { from: "ChatAgent", to: "SuperChatAgent", agentId: "chat" },
    ]);
    expect(diff.moved).toEqual([]);
    expect(diff.nextEntry?.renamed_classes).toEqual([
      { from: "ChatAgent", to: "SuperChatAgent" },
    ]);
  });

  test("duplicate classNames in the lockfile are rejected at read time", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ayjnt-lockdup-"));
    await Bun.write(
      path.join(tmp, ".ayjnt", "migrations.json"),
      JSON.stringify({
        version: 1,
        migrations: [{ tag: "v1", timestamp: "t" }],
        classes: {
          a: { agentId: "a", className: "ChatAgent", firstTag: "v1" },
          b: { agentId: "b", className: "ChatAgent", firstTag: "v1" },
        },
      }),
    );
    await expect(readLockfile(tmp)).rejects.toThrow(/two agentIds/);
    rmSync(tmp, { recursive: true, force: true });
  });
});
