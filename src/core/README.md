# `src/core/` — shared types

One file: [`types.ts`](./types.ts). The single contract between stages.

Every piece of data that flows from one stage of the pipeline to another — `Manifest`, `AgentEntry`, `MigrationLockfile`, `MigrationEntry`, `MigratedClass`, `MigrationDiff` — is defined here and nowhere else.

## Why a shared types module

The codegen pipeline is a chain of pure functions:

```
scan → diff → apply → emit
```

Each stage has well-defined inputs and outputs. Keeping those types in one place prevents:

- circular imports (stages import types, not each other)
- drift (one place to update when a type evolves)
- implicit contracts (the type file IS the contract)

## What belongs here

- Data shapes passed between pipeline stages
- Types persisted to disk (lockfile format, manifest format)
- Structural types that must stay in sync across files

## What doesn't

- Runtime types for user code — those live in [`../runtime/`](../runtime/)
- CLI-internal types (argv shape, etc.) — co-locate with the consuming file in [`../cli/`](../cli/)
- Internal helper types used by a single module — keep them in that module

## Stability

The `MigrationLockfile` shape is serialized to `.ayjnt/migrations.json` and committed to user repos. Changes to it require a version bump (the `version: 1` field) and a migration path. Treat it as a public interface.

Other types can evolve freely.
