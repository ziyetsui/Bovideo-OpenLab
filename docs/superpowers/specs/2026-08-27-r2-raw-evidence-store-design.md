# R2 Raw Evidence Store Design

**Status:** approved by the user’s 2026-08-27 R2 implementation request

## Goal

Allow managed Payload import and Twitter241 collection commands to persist private, content-addressed raw evidence in the project’s private Cloudflare R2 bucket rather than an ephemeral Render filesystem.

## Constraints

- R2 is private: no custom domain, r2.dev, public URL, or direct client access is added.
- A credential is restricted to Object Read, Write, and List for the one raw-evidence bucket. It expires annually.
- The existing ObjectRef validation, hash verification, principal policy, and Payload receipt-bound write contract remain authoritative.
- R2 credentials are read only from `RAW_EVIDENCE_R2_*` environment variables and are never returned, logged, stored in Payload, or committed.
- Local and first-party fixture tests continue using `LocalObjectStore`; `dev:local` remains disposable.
- Existing verified production data is not recollected merely to test this adapter.

## Architecture

Introduce a narrow `ObjectIngressStore` interface for the operations required by snapshot import and Payload’s trusted ingress hook. `LocalObjectStore` satisfies that interface without behaviour change. `R2ObjectStore` uses an injected S3-compatible client to put raw bytes under the existing immutable content-addressed key, with private server-side storage only.

R2 receipts are process-local, opaque, and bound to the exact ObjectRef, actor, correlation id, and purpose. This is sufficient for the single managed import process because the Payload hook consumes a receipt in that process. A process failure may leave an unreferenced, content-addressed R2 object; a retry verifies/writes the same deterministic key before attempting the same idempotent Payload facts. It cannot produce a public object reference or bypass the collection hook.

`resolveR2ObjectStoreFromEnvironment` fails closed unless endpoint, region, bucket, access key id, and secret access key are all present. The endpoint must be the standard HTTPS Cloudflare account R2 endpoint, and the region must be `auto`; it never falls back from R2 to a Render filesystem. Every R2 put uses `If-None-Match: *`. A pre-existing deterministic key is read back and must match byte-for-byte before a retry may proceed.

## Required environment variables

| Variable | Meaning |
| --- | --- |
| `RAW_EVIDENCE_R2_ENDPOINT` | S3-compatible R2 endpoint |
| `RAW_EVIDENCE_R2_REGION` | R2 signing region (`auto`) |
| `RAW_EVIDENCE_R2_BUCKET` | private raw-evidence bucket |
| `RAW_EVIDENCE_R2_ACCESS_KEY_ID` | restricted S3 access key |
| `RAW_EVIDENCE_R2_SECRET_ACCESS_KEY` | restricted S3 secret key |

Managed commands select R2 only when all five are present; otherwise they preserve the established local-store configuration requirement. Supplying both configurations is rejected so an operator cannot unknowingly write evidence to the wrong persistence plane.

## Verification

- Unit tests prove a permitted raw-evidence object is validated and written using the immutable key with conditional create, and with no ACL/public URL options.
- Tests prove wrong hash, unauthorized principal, non-raw field, missing R2 configuration, untrusted endpoint, receipt actor/correlation mismatches, and receipt replay fail.
- Existing managed write-plane tests prove migrations precede imports and schema push remains disabled.
- Typecheck and focused source/import tests must pass before deployment.

## Non-goals

- This change does not make third-party media public, change Payload Media storage, add an R2 public endpoint, or create a scheduler.
- It does not claim to implement the LocalObjectStore’s filesystem crash journal remotely; deterministic immutable R2 keys plus idempotent importer retries are the operational recovery boundary for raw evidence ingestion.
