// Migration lockfile — lives at <root>/.ayjnt/migrations.json, committed.
//
// The lockfile is the source of truth for what is in production. On every
// build we diff the current manifest against it; if anything has changed,
// we stage a new migration entry.
//
// Rename detection hinges on `agentId` being stable. If the same agentId
// appears with a different className, it's a rename (no storage loss). If
// an agentId is gone, it's a deletion (storage destroyed). If it's new,
// it's an addition.
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
 */
export async function readLockfile(root: string): Promise<MigrationLockfile> {
  const filePath = path.join(root, LOCKFILE_PATH);
  if (!existsSync(filePath)) {
    return structuredClone(EMPTY_LOCKFILE);
  }
  const text = await Bun.file(filePath).text();
  const parsed = JSON.parse(text) as MigrationLockfile;
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported lockfile version ${parsed.version} at ${filePath}. This ayjnt build expects version 1.`,
    );
  }
  return parsed;
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
 * nextEntry is non-null exactly when something changed.
 */
export function diffMigrations(
  lockfile: MigrationLockfile,
  manifest: Manifest,
): MigrationDiff {
  const manifestById = new Map(manifest.agents.map((a) => [a.agentId, a]));

  const added: MigrationDiff["added"] = [];
  const renamed: MigrationDiff["renamed"] = [];
  const deleted: MigrationDiff["deleted"] = [];

  for (const agent of manifest.agents) {
    const prior = lockfile.classes[agent.agentId];
    if (!prior) {
      added.push(agent);
    } else if (prior.className !== agent.className) {
      renamed.push({
        from: prior.className,
        to: agent.className,
        agentId: agent.agentId,
      });
    }
  }

  for (const [agentId, prior] of Object.entries(lockfile.classes)) {
    if (!manifestById.has(agentId)) {
      deleted.push({ agentId, className: prior.className });
    }
  }

  if (added.length === 0 && renamed.length === 0 && deleted.length === 0) {
    return { added, renamed, deleted, nextEntry: null };
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

  return { added, renamed, deleted, nextEntry: entry };
}

/**
 * Apply a diff to a lockfile, returning a new lockfile. Pure fn, no I/O.
 * Returns the original lockfile (by reference) if there's no pending entry.
 */
export function applyDiff(
  lockfile: MigrationLockfile,
  diff: MigrationDiff,
): MigrationLockfile {
  if (!diff.nextEntry) return lockfile;

  const classes = { ...lockfile.classes };
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
  if (!diff.nextEntry) return "No pending migrations.";
  const lines: string[] = [
    `Pending migration: ${diff.nextEntry.tag} (${diff.nextEntry.timestamp})`,
  ];
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
  if (diff.deleted.length) {
    lines.push("  - deleted (storage will be destroyed):");
    for (const d of diff.deleted) {
      lines.push(`      ${d.className} (agentId: ${d.agentId})`);
    }
  }
  return lines.join("\n");
}
