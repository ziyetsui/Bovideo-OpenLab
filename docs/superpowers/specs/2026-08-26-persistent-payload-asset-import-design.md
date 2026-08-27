# Persistent Payload Asset Import Design

**Status:** approved by the user's direct implementation request
**Date:** 2026-08-26
**Evidence:** [Payload ingress study](../../research/study-payload-media-page-projection-ingress.md)

## Goal

Make Payload's local database durable across localhost restarts and provide a repeatable, hash-verified import path from the user's local assets into the Payload write plane. The same importer must work against an operator-supplied PostgreSQL URL so future API-key automation can write without a manual Admin workflow.

## Non-goals

- Do not make X/third-party images or videos public `Media`; their rights are unknown and they remain private `MediaEvidence`.
- Do not manufacture `PageProjection` documents directly from an asset folder. The existing module, graph, review, projector, and release path remains the authority for pages.
- Do not change production deployment configuration or enable schema push on any persistent database.

## Inputs and data ownership

`/Users/a1/Documents/wiki/30-39 Product and Web Builds/bo/assets` currently contains three relevant directories:

| Directory | Treatment |
| --- | --- |
| `higgsfield-x-prompts-2026-08-20-twitter241` | Canonical verified snapshot: import Sources, draft PromptArtifacts, private MediaEvidence, and WorkflowRun. |
| `higgsfield-x-prompts-2026-08-20` | Legacy public-search snapshot: import its source records through a format adapter, preserving distinct provenance with a computed observed-input fingerprint because its manifest has no published file hashes. |
| `higgsfield-x-prompts-2026-08-20-twitter241-derived` | Derived media index of the canonical snapshot: validate as an optional fixture only; do not write a duplicate evidence corpus. |

The importer retains every regular file in each accepted snapshot (manifest,
raw pages/posts, normalized records, CSV exports, ledger, and README) in the
private local object store. Large files are content-addressed in bounded chunks
and a private reconstruction index is stored in `workflow-runs.input_ref`.
It never exposes a remote media URL as a public asset.

## Local durable runtime

`pnpm dev:local` deliberately remains disposable. A new local persistent profile uses a gitignored `.payload-local/` directory with mode 0700:

```text
.payload-local/
  runtime.json          # generated secrets and fixed loopback port; 0600
  postgres/             # EmbeddedPostgres cluster, persistent: true
  raw-evidence/         # private LocalObjectStore bytes and control state
```

The runtime creates cryptographically random secrets only once. It binds PostgreSQL to loopback on a fixed documented port. A wrapped command first probes for an authenticated running instance and reuses it (so an import can run while localhost is serving); otherwise it starts the cluster. It serializes migrations with a PostgreSQL advisory lock and invokes Payload's transaction-backed migration API (never `PAYLOAD_DB_PUSH`). A wrapper that owns the process awaits graceful PostgreSQL shutdown and only escalates to `SIGKILL` on timeout. A subsequent command receives the same connection URL, Payload secret, and object-store signer material.

## Commands

- `pnpm dev:persistent` starts the durable local database, migrates it, then starts Next/Payload Admin at loopback.
- `pnpm payload:local:import -- --snapshot <absolute-path>` starts the same database, migrates it, and imports a verified snapshot.
- `pnpm payload:local:import -- --snapshot <absolute-path> --dry-run` verifies every manifest hash and record without writing.
- `DATABASE_URL=... PAYLOAD_SECRET=... RAW_EVIDENCE_STORE_DIR=... RAW_EVIDENCE_SIGNER_SECRET=... pnpm payload:managed:import:assets -- --assets-root ...` uses a long-lived managed PostgreSQL database. It first applies the reviewed migration ledger with `PAYLOAD_DB_PUSH` forced off, then imports the fully classified assets root.
- `pnpm payload:migrate` applies that same reviewed ledger without writing source facts. `pnpm payload:managed:collect:twitter241` uses the migration gate before a credential-file collector can import its verified snapshot.

Each apply invocation prints the manifest hash and created/skipped counts. Re-running an unchanged snapshot must create zero duplicate facts.

## Acceptance criteria

1. Starting and stopping `dev:persistent` leaves the database and evidence directory intact, while `dev:local` remains ephemeral.
2. A fresh durable database receives every reviewed migration through the explicit migration ledger and has `PAYLOAD_DB_PUSH` unset/false.
3. Applying a snapshot creates Sources, PromptArtifacts, private MediaEvidence, a terminal WorkflowRun, and a private content-addressed reconstruction index for every snapshot input; a repeat apply only skips facts.
4. Counts remain present after the process is stopped and restarted.
5. The script accepts only the two known snapshot formats, rejects malformed manifests before writes, and gives the user an explicit unsupported-format error for unrelated directories.
6. The terminal report states that PageProjection/active-publication work is still a separate, unfinished pipeline stage rather than falsely claiming imported source data is already rendered on public pSEO routes.
7. Managed import/collector commands reject missing managed credentials before migration and never permit schema push; a migration failure performs zero importer writes.
