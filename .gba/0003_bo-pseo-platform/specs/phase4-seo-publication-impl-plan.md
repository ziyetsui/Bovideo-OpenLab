# Phase 4 — SEO publication and public mirror contract

This contract binds Phase 4 to `specs/0010-bo-pseo-platform-implementation.md` §8, `specs/0008-bo-pseo-platform-spec.md` §§11–12, §§15–18 and `specs/0009-bo-pseo-platform-acceptance.md` AC-QUAL-001–006, AC-SEO-001–018, AC-GH-001–016, AC-SEC-001–007 and AC-OPS-001–006.

Phase 4 is a local, deterministic release-candidate implementation. It must not claim live Google Search Console, GitHub organization, multi-region availability, or production credentials. Those external proofs remain explicit release blockers and are recorded as `NOT_RUN_REMOTE`.

## Dependency and data flow

```text
PageEnvelope + approved modules
          │
          ▼
Qualification + reason ledger ──► canonical route/redirect/410 validator
          │                                      │
          ▼                                      ▼
Versioned route manifest ───────────────► Sitemap shards + hreflang
          │                                      │
          ├────────► JSON-LD/link/orphan audit  │
          ▼                                      ▼
Rights/allow-list exporter ───────────► immutable release evidence bundle
          │                                      │
          └────────► revocation/tombstone/drill report
```

## Contracts

- Only `indexable` pages with all hard qualification gates, `index,follow`, self-canonical, approved locale, permitted rights, and required primary media enter a release manifest.
- Any failed hard gate emits a stable reason code and `not_generated`/`retired`; property tests cover at least 10,000 gate combinations.
- Route records are canonical 200, redirect 301/308, or terminal 410. Parameter/filter URLs never enter a Sitemap and must canonicalize to the clean route.
- Sitemap output is version-bound, deterministic, sharded by locale × family, ≤10,000 URLs/shard, with reciprocal hreflang. Unchanged content/link/schema hashes do not change `lastmod`.
- JSON-LD and internal-link audits consume the same route manifest; inventory orphans and non-canonical edges fail closed.
- Public export is explicit-field allow-list based. Full text/media requires `first_party` or `redistribution_licensed`; metadata-only records cannot leak prompt text, binary, private author data, or internal notes. Twenty poison fixtures must be blocked.
- Rights revocation applies to derived modules, page state, snapshot, and export state in one local executor; deletion/tombstone evidence records web/Sitemap and repository convergence targets.
- Release evidence records local PASS/FAIL and remote `NOT_RUN_REMOTE` separately; it never converts a local fixture into production proof.

## Task matrix and exit criteria

| Task | Deliverable | Proof |
| --- | --- | --- |
| P4-T01 | qualification engine + reason ledger | 10k property test; failed hard gates never indexable |
| P4-T02 | canonical/redirect/410 validator | clean, redirect, terminal and query cases |
| P4-T03 | versioned Sitemap/hreflang builder | deterministic shards, ≤10k, zero ineligible URLs |
| P4-T04 | JSON-LD/link/orphan release audit | schema, canonical and inventory graph checks |
| P4-T05/06 | public allow-list exporter + manifest | deterministic tree; 20/20 poison blocked; one-way metadata |
| P4-T07 | rights/deletion/tombstone executor | derived surfaces withdrawn atomically in local store |
| P4-T08 | ops/security release evidence | secret/PII/rights/rollback drill report |
| P4-T09 | release candidate bundle | all local P0/P1 PASS; remote blockers explicit |

Phase 4 is complete only when the local release bundle is deterministic, all local acceptance tests pass, and an independent Phase 4 review finds no unresolved in-scope P0/P1. Production indexing remains disabled until Phase 5 cohort activation.
