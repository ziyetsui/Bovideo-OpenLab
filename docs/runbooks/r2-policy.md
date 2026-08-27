# R2 object-policy boundary (local P1-T04)

This runbook records the local-only emulator contract for P1-T04. It does not configure, call, or prove Cloudflare R2. Production Phase 0 remains NO-GO.

## Local boundary

`LocalObjectStore` is a private filesystem adapter used only with synthetic or first-party fixtures. Its root is service-owned (untrusted principals must not be able to mutate it), namespace directories are created privately, and every operation rejects a symlinked root, namespace, ancestor, final object, or state file. Writes use a private temporary file, `fsync`, and an atomic no-replace hard-link publish; an existing object is re-read and must match byte-for-byte. It exposes no URL or filesystem-path response shape. It is not an R2 implementation, a Cloudflare binding, or evidence of remote IAM.

The four canonical `ObjectRef` namespaces map to these bucket classes:

| Namespace | Bucket class | Visibility | Allowed local principals |
| --- | --- | --- | --- |
| `raw-evidence` | `private_raw` | private | ingest service read/write/list/delete; no direct access |
| `review-media` | `private_review` | private | reviewer/legal/admin in scoped internal paths; no direct access |
| `published-snapshots` | `worker_snapshot` | Worker-only | publish service; public Worker reads only its active version |
| `public-media` | `worker_public` | Worker mediated | publish service writes; public Worker reads only active, eligible media |

The policy is deny-by-default. Anonymous/direct bucket access is denied for every namespace. The local test covers 100 synthetic restricted raw keys; this is a policy proof only, not a remote R2 IAM proof.

## Object and upload invariants

An `ObjectRef` has a fixed namespace/bucket-class pairing, normalized relative POSIX key, versioned SHA-256 content hash, version, byte size, MIME type, rights state, and deletion state. Raw-evidence keys are immutable content-addressed `sha256/<first-two-hex>/<full-hex>` paths. Traversal, encoded traversal, backslashes, controls, ambiguous separators, direct URLs, and malformed hashes are rejected.

Uploads verify declared and streamed size before parsing, computed SHA-256, MIME allow-list, namespace MIME-to-suffix rules (raw evidence remains suffixless/content-addressed), and required magic bytes. Public-media has bounded, non-recursive structural profiles: PNG verifies every CRC and accepts exactly one first `IHDR`, a valid color/bit-depth combination, optional pre-IDAT `PLTE`, contiguous non-empty `IDAT`, and terminal `IEND`; JPEG requires parsed quantization/Huffman tables, a frame whose table selectors exist, one bounded scan with entropy bytes, and terminal EOI; GIF requires a logical screen, a color table, non-empty image LZW sub-block data, and terminal trailer; WebP accepts a primary-first `VP8 `/`VP8L` RIFF profile with a key-frame tag, minimum frame payload, declared dimensions, and exact padding. MP4 accepts only the narrow exact-terminal `ftyp` → `moov` → non-empty `mdat` profile with an approved brand, version-0 `mvhd`, and exactly one version-0 video track: nonzero `tkhd`/`mdhd` dimensions, timescale and duration; `hdlr=vide`; a single `avc1` visual sample description with an exact-terminal AVCDecoderConfigurationRecord (`configurationVersion=1`, legal length-size reserved bits, and bounded non-empty SPS type 7 plus PPS type 8 NAL units); one positive `stts` timing entry; one ordered `stsc` chunk mapping; one `stsz` sample size; and one `stco`/`co64` offset whose mapped sample lies wholly inside `mdat`. Counts, lengths, offsets, NAL units, and mapped byte totals are bounded before they are used; zero entries, duplicate/conflicting critical boxes, unsupported sample descriptions, overflow, dangling offsets, malformed AVC configuration, and sample bytes beyond `mdat` are rejected. Every profile consumes the complete input and rejects malformed/truncated/oversized lengths, duplicate or out-of-order grammar elements, unsafe zero or 64-bit box sizes, and trailing dual-format payloads. This is a bounded admission parser, not a complete image/video decoder: the locally generated MP4 fixture proves this container mapping only and still requires downstream decode/semantic validation before use. Active HTML trailer bytes are rejected by terminal framing, while embedded ZIP and PE container markers are denied without text-decoding arbitrary binary input. Raw evidence is capped at 25 MiB; review, snapshot, and media objects are capped at 50 MiB. Public media additionally requires exactly `first_party` or `redistribution_licensed` rights and `active` deletion state. A current lifecycle lookup denies revoked or removed objects before every read, head, list, capability issue, and capability consumption in every namespace.

## Public projections and signed reads

Restricted ObjectRefs are persistence-only values. `assertNoRestrictedObjectRefs` rejects them in public response, artifact, or queue-like serializations. `toPublicObjectReference` strips object keys and all restricted metadata; it accepts only eligible active `public-media` references.

Private reads can use a short-lived signed-read capability object, never a URL. A capability binds namespace, key, hash, version, read action, principal, correlation id, UTC issue/expiry times, nonce, and HMAC signature. TTL is greater than zero and at most five minutes. Verification rejects modified signatures, expiry, wrong principal, wrong correlation/ref/action, and nonce replay. Consumers must record the capability use through their normal audit path; this local adapter does not claim a Cloudflare signed URL or a production audit sink.

## Deletion and production deferrals

`delete` requires policy authorization, persists the lifecycle-unavailable ref plus an idempotency-keyed local deletion outbox before touching the object, then removes the local object and invokes the injected private deletion-ledger callback. Its event carries the immutable deletion idempotency key/request correlation, full removed `ObjectRef`, namespace, content hash, and reason so receivers can deduplicate at-least-once retries. The callback is never invoked while the root lock is held; a durable delivery claim is heartbeated while it runs, then acknowledged only if its same claim remains current. A process crash stops that heartbeat and recovery retries the same immutable event key. Internal mutations are serialized by an OS-held SQLite `BEGIN IMMEDIATE` transaction in a separate root-lock journal (no expiring/stolen lock); the durable control journal records filesystem intents before mutation and reconciles an already-persisted deletion phase after restart. Pending/failed callbacks are retained across adapter restart. Production withdrawal must remove revoked/deleted objects from public allow-lists and fan out to the storage/deletion ledger.

The following remain `deferred-to-P0`: real bucket IAM and `r2.dev` denial, remote 100-key sampling, SSE configuration, custom-domain/Worker enforcement, real audit delivery, retention/archive lifecycle, and any public Cloudflare object-store behavior.
