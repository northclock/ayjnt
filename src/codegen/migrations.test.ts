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
    middlewareChain: [],
    ...overrides,
  };
}

function manifestOf(agents: AgentEntry[]): Manifest {
  return { root: "/fake", agents };
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
    const noDiff = { added: [], renamed: [], deleted: [], nextEntry: null };
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
