# R2 Raw Evidence Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make managed Payload raw-evidence imports durable in private Cloudflare R2.

**Architecture:** Extract the ingress methods required by import and Payload hooks behind a small interface. Keep the existing local implementation for tests and local use; add a policy-enforcing R2 implementation using an S3-compatible client and opaque process-local ingress receipts.

**Tech Stack:** Node.js 24.19.0, TypeScript 5.7, Payload 3.88, Cloudflare R2 S3 API, AWS SDK v3, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-27-r2-raw-evidence-store-design.md`

## Global Constraints

- Only private raw-evidence objects are written to R2; no public URLs or ACLs are emitted.
- Hash, size, MIME, ObjectRef, and `decideObjectAccess` validation run before every write.
- R2 credentials use only `RAW_EVIDENCE_R2_*` environment variables and never enter source, logs, or Payload rows.
- Managed commands never enable `PAYLOAD_DB_PUSH` and reject ambiguous local-plus-R2 store configuration.
- No existing production data collection is used as an adapter test.

---

## File map

- Create `src/storage/object-ingress-store.ts`: shared ingress interface and opaque receipt types.
- Create `src/storage/r2-object-store.ts`: private R2 write/resolution adapter and environment resolver.
- Modify `src/storage/payload-object-authority.ts`: depend on the ingress interface, not a filesystem implementation.
- Modify `src/imports/higgsfield-snapshot.ts`, `src/imports/assets-root.ts`, `src/source-adapters/twitter241.ts`: accept the shared store interface.
- Modify `scripts/import-assets-root.ts`, `scripts/import-higgsfield-snapshot.ts`, `scripts/managed-payload.ts`: select exactly one store configuration.
- Modify `package.json` and `pnpm-lock.yaml`: direct AWS SDK dependency.
- Create `tests/phase3/import/r2-object-store.contract.spec.ts`: R2 policy, receipt, and configuration contracts.

### Task 1: Define the ingress abstraction

**Files:** Create `src/storage/object-ingress-store.ts`; modify `src/storage/payload-object-authority.ts`; Test `tests/phase3/import/r2-object-store.contract.spec.ts`.

**Interfaces:** `ObjectIngressStore` exposes `write`, `putForIngress`, and `resolveIngressReceipt`; `ObjectIngressReceipt` has only `receipt_id`; `ObjectIngressField` is `'raw_ref' | 'object_ref'`.

- [x] Write and observe a failing test importing `R2ObjectStore` and asserting its receipt cannot resolve for a different actor or correlation id.
- [x] Define the shared structural interface, then change Payload authority to accept it without changing LocalObjectStore behaviour.

### Task 2: Implement the private R2 writer

**Files:** Create `src/storage/r2-object-store.ts`; modify `package.json`, `pnpm-lock.yaml`; Test `tests/phase3/import/r2-object-store.contract.spec.ts`.

**Interfaces:** `new R2ObjectStore({ bucket, client })`; `resolveR2ObjectStoreFromEnvironment(environment)`; the injected client exposes `putObject({ Bucket, Key, Body, ContentType, ContentLength })`.

- [x] Add an immutable raw-key write test and denied-principal test; both must reach no external R2 transport.
- [x] Add the AWS SDK dependency and implement validation through `objectRefSchema`, `validateObjectUpload`, and `decideObjectAccess({ channel: 'internal' })`; issue random opaque receipts only after successful object writes.
- [x] Re-run focused tests and `pnpm exec tsc --noEmit`.

### Task 3: Wire managed import selection

**Files:** Modify `scripts/import-assets-root.ts`, `scripts/import-higgsfield-snapshot.ts`, `scripts/managed-payload.ts`; Test `tests/phase3/import/managed-payload-write-plane.contract.spec.ts` and `tests/phase3/import/r2-object-store.contract.spec.ts`.

**Interfaces:** `resolveRawEvidenceStoreFromEnvironment(environment)` returns exactly LocalObjectStore or R2ObjectStore, never both.

- [x] Write and observe a failing command test for complete R2 configuration; add incomplete-R2 and local-plus-R2 rejection coverage.
- [x] Use the resolver in each import command and update managed environment requirements to permit one complete configuration only.
- [x] Re-run focused tests and TypeScript.

### Task 4: Document and verify the production boundary

**Files:** Modify `README.md` and `docs/runbooks/r2-policy.md`; Test commands below.

- [x] Document the exact private R2 variable names, annual credential rotation, local fallback, and the prohibition on public buckets/URLs.
- [ ] Run the focused importer contract set, typecheck, phase-1 source tests, diff check, and lint; separately record pre-existing lint findings if unchanged.
- [ ] Commit the code and documentation only after verification, then deploy the reviewed commit and run one bounded non-collection R2 smoke write.

## Self-review

- Spec coverage: Task 1 preserves trusted ingress semantics; Task 2 supplies policy-checked private R2 writes; Task 3 controls runtime selection; Task 4 documents and verifies operations.
- Placeholder scan: all required paths, test commands, interfaces, and error cases are named.
- Type consistency: all consumers receive `ObjectIngressStore`; only R2 credentials are consumed by the R2 resolver.
