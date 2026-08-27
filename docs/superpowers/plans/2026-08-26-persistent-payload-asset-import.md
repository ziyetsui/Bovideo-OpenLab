# Persistent Payload Asset Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Payload's localhost write plane and import the user's verified asset snapshots idempotently.

**Architecture:** A persistent EmbeddedPostgres wrapper owns a gitignored local cluster, private raw evidence store, explicit migration ledger, and a child command lifecycle. Snapshot CLI adapters validate every file before calling the existing immutable Payload collections; production/managed PostgreSQL uses the exact same importer with explicit environment configuration.

**Tech Stack:** Node.js 24.19.0, TypeScript 5.7, Payload 3.88, PostgreSQL, embedded-postgres 18.4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-26-persistent-payload-asset-import-design.md`

## Global Constraints

- `pnpm dev:local` remains ephemeral and is not repurposed.
- Persistent paths never set `PAYLOAD_DB_PUSH=true`.
- Runtime credentials and evidence bytes remain gitignored and owner-readable only.
- Public `media` accepts only approved first-party/licensed files; external X data stays private evidence.
- PageProjections are created only by the existing controlled projector/release flow.

---

## File map

- Create `scripts/run-persistent-postgres.ts`: durable local cluster supervisor and migration-before-child lifecycle.
- Create `scripts/persistent-payload-migrate.ts`: additive migration-ledger executor usable by the supervisor.
- Modify `scripts/import-higgsfield-snapshot.ts`: explicit `--snapshot`, `--dry-run`, format detection, and proper Payload cleanup.
- Modify `src/imports/higgsfield-snapshot.ts`: add legacy snapshot normalization while preserving the canonical format's validation/idempotency contract.
- Modify `package.json`, `.gitignore`, and `README.md`: durable commands and operator runbook.
- Create `tests/runtime/persistent-payload-runtime.int.spec.ts` and `tests/imports/higgsfield-snapshot-cli.spec.ts`: durable lifecycle and format/argument contracts.

### Task 1: Write runtime and CLI failure contracts

**Files:** create `tests/runtime/persistent-payload-runtime.int.spec.ts`; create `tests/imports/higgsfield-snapshot-cli.spec.ts`.

**Interfaces:** `runPersistentPostgres({ rootDir, commandArguments, migrate })` produces a stable `DATABASE_URL`; `parseSnapshotImportArgs(argv)` produces `{ snapshotDir, dryRun }`.

- [ ] Write a unit test that creates a temporary runtime root, invokes the configuration initializer twice, and expects exactly one generated credential document with mode `0600`, a stable port, and no `PAYLOAD_DB_PUSH` environment value.
- [ ] Write a CLI parser test for `--snapshot /tmp/snapshot --dry-run`, for defaulting `ASSET_SNAPSHOT_DIR`, and for rejecting a missing snapshot or an unknown flag.
- [ ] Run the two focused tests and confirm they fail because the runtime/CLI interfaces do not yet exist.

### Task 2: Implement the durable local PostgreSQL supervisor

**Files:** create `scripts/run-persistent-postgres.ts`; create `scripts/persistent-payload-migrate.ts`; modify `.gitignore`, `package.json`.

**Interfaces:** the supervisor receives `--migrate -- <entrypoint> [args]`, exports `ensurePersistentRuntime`, and injects `DATABASE_URL`, `PAYLOAD_SECRET`, `RAW_EVIDENCE_STORE_DIR`, and `RAW_EVIDENCE_SIGNER_SECRET` into its child.

- [ ] Implement secure directory/config initialization using `mkdir(..., { mode: 0o700 })`, exclusive creation of `.payload-local/runtime.json` with `0o600`, and random database/object/Payload secrets.
- [ ] Start `EmbeddedPostgres` with the persisted directory and a loopback-only PostgreSQL flag; install idempotent SIGINT/SIGTERM forwarding and always call `stop()` without removing the directory.
- [ ] Implement an explicit, additive migration executor by replaying `PHASE1_MIGRATION_PLAN` only when its migration ledger entry is absent; close Payload and its pool in a `finally` block.
- [ ] Add `dev:persistent` and a generic `payload:local:run` command. Add `.payload-local/` to `.gitignore`.
- [ ] Run runtime unit tests, TypeScript, lint, and `git diff --check`; commit the supervisor.

### Task 3: Make snapshot import a supported command and add legacy adapter

**Files:** modify `scripts/import-higgsfield-snapshot.ts`; modify `src/imports/higgsfield-snapshot.ts`; modify `package.json`; tests from Task 1.

**Interfaces:** `pnpm payload:import -- --snapshot <dir> [--dry-run]` operates against explicit managed DB env; `pnpm payload:local:import -- --snapshot <dir> [--dry-run]` wraps it in the durable local profile.

- [ ] Implement strict CLI parsing and `payload.destroy()` / pool cleanup after an apply.
- [ ] Detect canonical Twitter241 (`normalized_posts.jsonl` plus `raw_posts.jsonl`) and legacy public-search (`records.jsonl` plus `raw_hydration.jsonl`) manifests before any write; reject all other folders.
- [ ] Convert legacy records into the same validated Source/PromptArtifact/private MediaEvidence import facts, preserving a legacy-specific source version and workflow idempotency key.
- [ ] Add package commands and README examples for dry-run, local apply, managed-Postgres apply, idempotent rerun, backup location, and the remaining projection pipeline gap.
- [ ] Run focused importer tests, TypeScript, lint, and `git diff --check`; commit the CLI/adapters.

### Task 4: Perform the authorized asset import and prove persistence

**Files:** generated gitignored `.payload-local/`; update the spec/runbook only if actual counts materially differ.

**Interfaces:** `payload:local:import` returns JSON with manifest hash and created/skipped facts; direct Payload count queries verify collections.

- [ ] Run a dry run against both canonical and legacy snapshots; stop if either manifest or record validation fails.
- [ ] Apply the canonical snapshot, then apply the legacy snapshot; capture the JSON result.
- [ ] Re-run the canonical import and assert all created counts are zero and skipped counts match the initial facts.
- [ ] Start a new durable command/process and count `sources`, `prompt-artifacts`, `media-evidence`, and `workflow-runs`; confirm the first-run counts survive.
- [ ] Start `dev:persistent`, verify `/readyz` and `/admin`, then record that public page data awaits the independent PageProjection/release implementation.

### Task 5: Independent phase review and handoff

**Files:** relevant code/docs above; `.gba/0003_bo-pseo-platform/docs/` handoff note.

- [ ] Run `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run test:phase3:t10`, focused runtime/import suites, and `git diff --check`.
- [ ] Ask an independent reviewer to inspect persistence safety, migration handling, data-rights boundaries, idempotency, and accidental changes to the ephemeral profile; address validated findings.
- [ ] Record verification commands, imported manifest hashes/counts, local data path, and explicit remaining PageProjection handoff in a phase handoff note.

## Self-review

- Spec coverage: Tasks 1–2 cover durable runtime and migration safety; Task 3 covers automation-compatible ingestion and both input formats; Task 4 covers real import/persistence; Task 5 covers review and handoff.
- Placeholder scan: no implementation step leaves a behavior unnamed; unsupported formats, paths, secrets, migration execution, and verification have explicit owners.
- Type consistency: the runtime exports `ensurePersistentRuntime` / `runPersistentPostgres`; the import parser exports `parseSnapshotImportArgs`; callers consume those names unchanged.
