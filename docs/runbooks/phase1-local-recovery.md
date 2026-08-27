# Phase 1 local PostgreSQL recovery drill

This runbook is restricted to a synthetic disposable PostgreSQL cluster. It does not contact Neon, Render, Cloudflare, or any production service.

## Safety contract

- Use a generated `p1l-...` run id and exact loopback-only database names: `bo_p1_t03_<suffix>_source` and `bo_p1_t03_<suffix>_restore`.
- Set `PAYLOAD_DB_PUSH=false`. The reviewed migration under `src/migrations-postgres/` is the only schema writer.
- Supply a fresh 32-byte hexadecimal `PHASE1_BACKUP_KEY` through the environment. Do not record it, pass it on a command line, or reuse it outside the disposable drill.
- Store run output in a new `0700` local directory. Envelopes and manifests are written `0600`; the logical dump is AES-256-GCM encrypted and is never persisted in plaintext.
- Never run `payload migrate:down` to remove Phase 1 schema or data. Phase 1 migrations are additive: their `down` paths either preserve durable facts or refuse the operation, including persisted locale-risk facts that control review eligibility. Rollback eligibility is a verified restore to a fresh compatible target; a migration-ledger replay is safe only because its `up` path is idempotent.

## One-command local drill

With the repository Node runtime available on `PATH`:

```sh
pnpm run test:phase1:migrations
```

The dedicated harness starts an embedded loopback PostgreSQL cluster, runs the generated migration forward and a typed `already_applied` replay, intentionally stops a fixture batch at a durable checkpoint, resumes with batches no larger than 1,000 rows, writes an encrypted logical envelope, migrates a fresh target, restores, and compares the exact integrity manifest hash. It removes both cluster and output directories after the drill.

Payload 3.88's PostgreSQL adapter performs an initial pool health-check checkout without releasing that client. Every one-shot local CLI snapshots the adapter pool's retained clients, force-releases them, then awaits `pool.end()` after `payload.destroy()`. This is an intentionally isolated workaround for the local disposable harness; it uses no `process.exit()` shortcut and must be revisited when Payload changes its adapter lifecycle.

## Individual commands

These commands require a locally started disposable PostgreSQL target and explicitly supplied values. They are useful only while diagnosing the local harness.

```sh
export PHASE1_RUN_ID='p1l-01234567'
export PHASE1_DATABASE_IDENTITY='bo_p1_t03_01234567_source'
export DATABASE_URL='postgres://postgres:LOCAL_PASSWORD@127.0.0.1:5432/bo_p1_t03_01234567_source'
export PHASE1_OUTPUT_DIR='/private/tmp/bo-p1-t03-01234567'
export PHASE1_BACKUP_KEY='64-hex-characters-from-a-local-secret-injector'
export PAYLOAD_DB_PUSH=false

pnpm run phase1:migrate
pnpm run phase1:seed -- --batch-size 1000 --interrupt-after 1
pnpm run phase1:seed -- --batch-size 1000
pnpm run phase1:backup
```

The database checkpoint is authoritative and advances in the same transaction as each fixture batch. `seed-checkpoint.json` is only a post-commit mirror. A stale, ahead, behind, wrong-target, or torn mirror is rejected. If the mirror is lost after a committed batch, use `phase1:seed -- --batch-size 1000 --repair-checkpoint` once: it rehydrates only from the matching database checkpoint and writes `seed-checkpoint-repair.json` as a local audit marker. It never accepts file state in place of database state.

For a fresh `..._restore` target, set both `DATABASE_URL` and `PHASE1_DATABASE_IDENTITY` to that exact identity, run `phase1:migrate`, then `phase1:restore` with the same output directory and injected key.

## What the manifest proves

The manifest covers the Phase 1 schema version, per-collection counts, stable business identities, relation rows, content/object-reference facts, and a chained immutable audit digest. Restore validates envelope authentication and plaintext checksum before any insert, then recomputes the full manifest after restoration. A mutated relation, content fact, audit event, tag, ciphertext, or manifest field fails closed.

The fixture is intentionally reduced but state-complete: all 16 collections, all application locales, all declared rights/deletion/publication/locale/workflow/redirect states, redirects, high-risk denied audit outcome, relations, and T04 ObjectRef shapes are represented. It is not production-scale evidence.

## Operational limits and deferrals

This is a project-owned logical export/restore implementation, not `pg_dump`, provider PITR, scheduled backup, KMS, or provider-managed encryption. The local synthetic drill has no production RPO/RTO claim. Production RPO/RTO, PITR, KMS, retention enforcement, load/scale, Neon/Render migration and fresh-target restore evidence remain deferred to the appropriate remote/Phase 0 acceptance gates. In particular AC-P1V-PG-002 and AC-P1V-PG-005 are `NOT_RUN_REQUIRED_REMOTE`; AC-P0-002 through AC-P0-006 remain `DEFERRED_TO_P0`.
