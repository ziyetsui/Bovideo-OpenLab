# Persistent Payload Asset Import Handoff

Date: 2026-08-26
Spec: `docs/superpowers/specs/2026-08-26-persistent-payload-asset-import-design.md`

## Delivered

- Added durable localhost commands: `pnpm dev:persistent`,
  `pnpm payload:local:import`, `pnpm payload:local:run`, and
  `pnpm payload:import` for an externally managed PostgreSQL URL.
- The durable local profile stores only gitignored local state in
  `.payload-local/`: embedded PostgreSQL, private raw evidence, and
  owner-private generated runtime credentials.
- Applied reviewed migrations, including the additive
  `x_public_search` source-provider enum value.
- Imported the user-supplied canonical Twitter241 snapshot and the historical
  public-search snapshot. Every regular snapshot input (including raw pages,
  raw posts, exports, manifest, README, and ledgers) is held as chunked,
  content-addressed private raw evidence; each current import run points to a
  private reconstruction index. Third-party media remains private
  `media-evidence`, not public Payload `media`.
- The persistent wrapper authenticates and reuses a running local cluster, so
  `dev:persistent` and `payload:local:import` can coexist. It uses a
  PostgreSQL advisory lock plus Payload's transaction-backed migration API,
  and it waits for PostgreSQL shutdown before clearing the process handle.
- Corrected two real Payload boundary issues found by the import:
  `MediaEvidence` now ignores server-managed timestamps before strict schema
  parsing; reused X media receives a source-qualified observation ID instead
  of overwriting or rejecting a distinct source occurrence.
- Added `payload:local:import:assets` for the complete approved assets root.
  It classifies the root before any write, imports canonical then historical
  snapshots, archives the deterministic derived media index as private raw
  evidence, records that archive in `workflow-runs`, and explicitly ignores
  `.DS_Store`.
- Added `payload:local:collect:twitter241`: a RapidAPI credential-file flow
  that requires mode `0600` or stricter, materializes a verified snapshot
  before calling the normal importer, and never prints or persists the key.
  Its Twitter241 collector is now versioned in
  `scripts/fetch_higgsfield_twitter241.py`, so the automation does not depend
  on an untracked file elsewhere on this Mac.
- Added private `source-observations` and a semantic Source key.  Cross-provider
  copies of the same X status now share one canonical Source; their distinct raw
  provider observations remain queryable privately rather than creating
  duplicate prompts, media facts, or future page inputs.
- Added managed write-plane commands: `pnpm payload:migrate`,
  `pnpm payload:managed:import:assets`, and
  `pnpm payload:managed:collect:twitter241`. They require explicit managed
  database/Payload/private-evidence credentials, force schema push off, apply
  the reviewed migration ledger, and only then invoke the importer or
  collector. A missing credential or rejected migration performs no write.

## Verified persistent facts

| Collection | Count |
| --- | ---: |
| `sources` | 5,565 |
| `prompt-artifacts` | 1,005 |
| `media-evidence` | 5,442 |
| `source-observations` | 5,569, all private provenance |
| `workflow-runs` | 4, all `succeeded` (including derived evidence archive) |

Canonical manifest: `sha256:v1:0ddadea23a8dcee6d91269d0ded4086502be6035f87c57598194674f2b640f1b`.
Current historical full-input fingerprint:
`sha256:v1:28a62c01cae178c6c610c0197fd599bc3286e4b21c34b0582be433f4f806e85c`.
The historical source did not publish output hashes; this is a computed
fingerprint of every regular file in the local snapshot, not a
publisher-provided integrity assertion. One earlier compact-import workflow
run with fingerprint `sha256:v1:54acbc146d2a1a59e383cab515a759a11955952f90c12df360bbc55b1bd5aa34`
is intentionally retained as immutable history; the current run is the one
linked to the complete private evidence index.

Canonical idempotency replay created zero rows and skipped 5,564 Sources,
1,005 PromptArtifacts, and 5,441 MediaEvidence.

## Runtime verification

- `GET /healthz` → `{"status":"ok"}`
- `GET /readyz` → `{"database":"postgres","status":"ready"}`
- `GET /admin/collections/sources?depth=1&limit=10` → HTTP 200
- Focused import/runtime/Payload collection contracts passed (34 tests),
  including evidence-index retention, source-version upgrade, local-server
  reuse, and shutdown escalation behavior.
- `pnpm run lint`, `pnpm exec tsc --noEmit`, and `git diff --check` passed.

## Operator entry points

```bash
pnpm dev:persistent
pnpm payload:local:import -- --snapshot /absolute/path/to/snapshot --dry-run
pnpm payload:local:import -- --snapshot /absolute/path/to/snapshot
pnpm payload:local:import:assets -- --assets-root /absolute/path/to/assets
TWITTER241_CREDENTIAL_FILE=/private/twitter241.env pnpm payload:local:collect:twitter241
```

For an online permanent PostgreSQL database, use `pnpm payload:import` with
explicit `DATABASE_URL`, `PAYLOAD_SECRET`, `RAW_EVIDENCE_STORE_DIR`, and
`RAW_EVIDENCE_SIGNER_SECRET`. Prefer `pnpm payload:managed:import:assets` so
the same invocation first migrates and then imports the complete assets root.
No cloud provider account/connection string was present locally, so the
implemented localhost store is durable on this Mac; the managed write-plane
is ready when one is supplied.

## Remaining publication boundary

This delivers the Payload source/evidence write plane. Imported records do not
yet populate public pSEO routes: module generation/review, graph elevation,
immutable PageProjection materialization, and active-publication binding remain
the separate Phase 3 projection/release work documented in the linked spec.
