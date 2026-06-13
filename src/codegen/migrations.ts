// Migration lockfile — lives at <root>/.ayjnt/migrations.json, committed.
//
// The lockfile is the source of truth for what is in production. On every
// build we diff the current manifest against it; if anything has changed,
// we stage a new migration entry.
//
// Identity rules, in order:
//   - same agentId, same className     → unchanged
//   - same agentId, different className → RENAME (storage preserved,
//     `renamed_classes` migration)
//   - different agentId, same className → MOVE (the folder was renamed and
//     the default agentId moved with it; DO storage is keyed by class name,
//     so NO migration is emitted — only the lockfile key changes). Treating
//     this as delete+create would wipe every instance's storage, which is
//     exactly what wrangler does with `deleted_classes` + `new_sqlite_classes`
//     of the same class in one entry.
//   - agentId gone, className gone      → DELETION (storage destroyed)
//
// Contract: migrations array is APPEND-ONLY. Never rewrite past entries.

import * as path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type {
  Manifest,
  MigrationDiff,
  MigrationEntry,
  MigrationLockfile,
} from "../core/types.ts";

export const LOCKFILE_PATH = ".ayjnt/migrations.json";

export const EMPTY_LOCKFILE: MigrationLockfile = {
  version: 1,
  migrations: [],
  classes: {},
};

/**
 * Read the lockfile from <root>/.ayjnt/migrations.json. Returns an empty
 * lockfile (not null) if the file doesn't exist — makes first-run builds
 * work without special-casing.
 *
 * Throws with the file path and guidance when the file is corrupt: the
 * lockfile drives storage-destroying migrations, so guessing at a partial
 * parse is never the right move.
 */
export async function readLockfile(root: string): Promise<MigrationLockfile> {
  const filePath = path.join(root, LOCKFILE_PATH);
  if (!existsSync(filePath)) {
    return structuredClone(EMPTY_LOCKFILE);
  }
  const text = await Bun.file(filePath).text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${filePath} is not valid JSON (${(err as Error).message}). ` +
        `This file is the committed source of truth for production migrations — ` +
        `restore it from git (git checkout -- ${LOCKFILE_PATH}) rather than deleting it.`,
    );
  }
  assertLockfileShape(parsed, filePath);
  return parsed;
}

/** Structural validation — enough to catch a truncated or hand-mangled
 *  file before its contents feed a migration diff. */
function assertLockfileShape(
  parsed: unknown,
  filePath: string,
): asserts parsed is MigrationLockfile {
  const fail = (why: string): never => {
    throw new Error(
      `${filePath}: ${why}. This file is the committed source of truth for ` +
        `production migrations — restore it from git rather than editing by hand.`,
    );
  };
  if (typeof parsed !== "object" || parsed === null) {
    fail("expected a JSON object");
  }
  const lf = parsed as Record<string, unknown>;
  if (lf["version"] !== 1) {
    fail(
      `unsupported lockfile version ${JSON.stringify(lf["version"])} — this ayjnt build expects version 1`,
    );
  }
  if (!Array.isArray(lf["migrations"])) {
    fail(`"migrations" must be an array`);
  }
  for (const m of lf["migrations"] as unknown[]) {
    if (
      typeof m !== "object" ||
      m === null ||
      typeof (m as Record<string, unknown>)["tag"] !== "string"
    ) {
      fail(`every migration entry needs a string "tag"`);
    }
  }
  if (
    typeof lf["classes"] !== "object" ||
    lf["classes"] === null ||
    Array.isArray(lf["classes"])
  ) {
    fail(`"classes" must be an object keyed by agentId`);
  }
  // The move/rename matching below keys on className, so a duplicate
  // would make pairing ambiguous and could emit a storage-destroying
  // deletion for a class that's still live. Duplicates typically come
  // from a union-style merge-conflict resolution of two branches that
  // each added an agent with the same class name.
  const byClassName = new Map<string, string>();
  for (const [agentId, entry] of Object.entries(
    lf["classes"] as Record<string, unknown>,
  )) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>)["className"] !== "string"
    ) {
      fail(`classes["${agentId}"] needs a string "className"`);
    }
    const className = (entry as { className: string }).className;
    const prior = byClassName.get(className);
    if (prior) {
      fail(
        `class "${className}" appears under two agentIds ("${prior}" and "${agentId}") — ` +
          `likely a bad merge-conflict resolution; each class may appear once`,
      );
    }
    byClassName.set(className, agentId);
  }
}

/**
 * Write the lockfile back. Pretty-printed JSON for a git-friendly diff.
 * Called by `ayjnt build`; `ayjnt deploy` will refuse to run if a pending
 * diff would produce a new write that hasn't been committed.
 */
export async function writeLockfile(
  root: string,
  lockfile: MigrationLockfile,
): Promise<void> {
  const filePath = path.join(root, LOCKFILE_PATH);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  await Bun.write(filePath, JSON.stringify(lockfile, null, 2) + "\n");
}

/**
 * Compare lockfile with current manifest. Returns a MigrationDiff whose
 * nextEntry is non-null exactly when a wrangler migration is needed.
 * Folder moves (see `moved`) change the lockfile but not the migrations.
 */
export function diffMigrations(
  lockfile: MigrationLockfile,
  manifest: Manifest,
): MigrationDiff {
  // Identity resolution is CLASS-NAME-FIRST, because DO storage is keyed
  // by class name, not by our agentId bookkeeping. Class names are unique
  // within a manifest (scan's assertUnique) and within a valid lockfile
  // (assertLockfileShape + the defensive map below), so every match is
  // unambiguous. Matching agentId-first looked simpler but mangled two
  // realistic shapes: a folder move where the OLD folder is re-occupied by
  // a new agent (the old rule emitted a rename handing the moved class's
  // storage to the newcomer), and a two-folder swap (a rename cycle).
  const manifestByClass = new Map(manifest.agents.map((a) => [a.className, a]));
  const lockByClass = new Map<string, { agentId: string; className: string }>();
  for (const [agentId, entry] of Object.entries(lockfile.classes)) {
    if (lockByClass.has(entry.className)) {
      throw new Error(
        `migration lockfile lists class "${entry.className}" under two agentIds — ` +
          `cannot diff safely. Restore .ayjnt/migrations.json from git.`,
      );
    }
    lockByClass.set(entry.className, { agentId, className: entry.className });
  }

  const added: MigrationDiff["added"] = [];
  const renamed: MigrationDiff["renamed"] = [];
  const moved: MigrationDiff["moved"] = [];
  const consumedLockIds = new Set<string>();

  for (const agent of manifest.agents) {
    // Same class still tracked? Either unchanged or a folder move.
    const lockSameClass = lockByClass.get(agent.className);
    if (lockSameClass) {
      consumedLockIds.add(lockSameClass.agentId);
      if (lockSameClass.agentId !== agent.agentId) {
        moved.push({
          fromAgentId: lockSameClass.agentId,
          toAgentId: agent.agentId,
          className: agent.className,
        });
      }
      continue;
    }
    // New class at a tracked agentId whose OLD class has left the manifest
    // entirely → an in-place class rename (storage preserved by wrangler's
    // renamed_classes). If the old class still lives elsewhere, it's being
    // handled as a move above — this agent is then a genuine addition.
    const lockSameId = lockfile.classes[agent.agentId];
    if (lockSameId && !manifestByClass.has(lockSameId.className)) {
      consumedLockIds.add(agent.agentId);
      renamed.push({
        from: lockSameId.className,
        to: agent.className,
        agentId: agent.agentId,
      });
      continue;
    }
    added.push(agent);
  }

  const deleted: MigrationDiff["deleted"] = Object.entries(lockfile.classes)
    .filter(([agentId]) => !consumedLockIds.has(agentId))
    .map(([agentId, entry]) => ({ agentId, className: entry.className }));

  if (added.length === 0 && renamed.length === 0 && deleted.length === 0) {
    return { added, renamed, deleted, moved, nextEntry: null };
  }

  const entry: MigrationEntry = {
    tag: nextTag(lockfile),
    timestamp: new Date().toISOString(),
  };
  if (added.length) {
    entry.new_sqlite_classes = added.map((a) => a.className);
  }
  if (renamed.length) {
    entry.renamed_classes = renamed.map(({ from, to }) => ({ from, to }));
  }
  if (deleted.length) {
    entry.deleted_classes = deleted.map((d) => d.className);
  }

  return { added, renamed, deleted, moved, nextEntry: entry };
}

/** True when applying the diff would change the lockfile at all — a new
 *  migration entry OR a folder move's re-keyed bookkeeping. */
export function diffChangesLockfile(diff: MigrationDiff): boolean {
  return diff.nextEntry !== null || diff.moved.length > 0;
}

/**
 * Apply a diff to a lockfile, returning a new lockfile. Pure fn, no I/O.
 * Returns the original lockfile (by reference) if nothing changed.
 */
export function applyDiff(
  lockfile: MigrationLockfile,
  diff: MigrationDiff,
): MigrationLockfile {
  if (!diffChangesLockfile(diff)) return lockfile;

  const classes = { ...lockfile.classes };

  // Folder moves: re-key the entries, preserving their audit trail.
  // Two phases — all deletions, then all insertions — because moves can
  // target each other's old keys (a two-folder swap would otherwise
  // overwrite one entry and then delete it).
  const movedFirstTag = new Map(
    diff.moved.map((m) => [
      m.className,
      lockfile.classes[m.fromAgentId]?.firstTag ?? "v1",
    ]),
  );
  for (const m of diff.moved) {
    delete classes[m.fromAgentId];
  }
  for (const m of diff.moved) {
    classes[m.toAgentId] = {
      agentId: m.toAgentId,
      className: m.className,
      firstTag: movedFirstTag.get(m.className)!,
    };
  }

  if (!diff.nextEntry) {
    return { version: 1, migrations: [...lockfile.migrations], classes };
  }

  const tag = diff.nextEntry.tag;
  for (const agent of diff.added) {
    classes[agent.agentId] = {
      agentId: agent.agentId,
      className: agent.className,
      firstTag: tag,
    };
  }
  for (const r of diff.renamed) {
    const existing = classes[r.agentId];
    if (existing) {
      classes[r.agentId] = { ...existing, className: r.to };
    }
  }
  for (const d of diff.deleted) {
    delete classes[d.agentId];
  }

  return {
    version: 1,
    migrations: [...lockfile.migrations, diff.nextEntry],
    classes,
  };
}

/**
 * Next migration tag. Parses "v<N>" entries, returns v(max+1). If no
 * entries exist (or none parse), returns "v1".
 */
export function nextTag(lockfile: MigrationLockfile): string {
  let max = 0;
  for (const m of lockfile.migrations) {
    const match = m.tag.match(/^v(\d+)$/);
    if (match?.[1]) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `v${max + 1}`;
}

/**
 * Human-readable summary of a pending diff. Used by `ayjnt migrate` and
 * surfaced by `ayjnt build` when a new migration is staged.
 */
export function formatDiff(diff: MigrationDiff): string {
  if (!diffChangesLockfile(diff)) return "No pending migrations.";
  const lines: string[] = [];
  if (diff.nextEntry) {
    lines.push(
      `Pending migration: ${diff.nextEntry.tag} (${diff.nextEntry.timestamp})`,
    );
  }
  if (diff.added.length) {
    lines.push("  + added:");
    for (const a of diff.added) {
      lines.push(`      ${a.className} (agentId: ${a.agentId}) at ${a.routePath}`);
    }
  }
  if (diff.renamed.length) {
    lines.push("  ~ renamed:");
    for (const r of diff.renamed) {
      lines.push(`      ${r.from} -> ${r.to} (agentId: ${r.agentId})`);
    }
  }
  if (diff.moved.length) {
    lines.push("  = moved (folder renamed; storage preserved, no migration):");
    for (const m of diff.moved) {
      lines.push(
        `      ${m.className}: agentId ${m.fromAgentId} -> ${m.toAgentId}`,
      );
    }
  }
  if (diff.deleted.length) {
    lines.push("  - deleted (storage will be destroyed):");
    for (const d of diff.deleted) {
      lines.push(`      ${d.className} (agentId: ${d.agentId})`);
    }
  }
  return lines.join("\n");
}
