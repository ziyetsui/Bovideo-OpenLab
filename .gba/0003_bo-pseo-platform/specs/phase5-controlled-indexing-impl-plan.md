# Phase 5 — Controlled indexing and growth-loop contract

This local implementation binds Phase 5 to `specs/0010-bo-pseo-platform-implementation.md` §9 and `specs/0009-bo-pseo-platform-acceptance.md` §§17.2–18.3. It is executable cohort-control logic, not live Google Search Console or production indexing evidence.

## Scope and safety boundary

- Phase 4 PASS is a hard prerequisite.
- A cohort is finite, versioned, and bounded to 100–500 URLs unless the qualified inventory is smaller.
- The manifest requires at least 20 English URLs and at least 10 URLs for each included non-English locale; locales are never added merely to reach 16.
- Every record carries URL, family, locale, demand evidence, publish version, and inclusion date. Duplicate URLs, non-canonical routes, unqualified records, and rights-blocked records fail closed.
- Activation and Sitemap/GSC submission are represented as local `NOT_RUN_REMOTE` operations. No network client, production credential, or indexable route is activated by this phase.
- D+7/D+14 surveillance, D+28 diagnosis, D+60 expansion/freeze, and D+90 portfolio decisions are deterministic schemas with threshold evaluation; missing data never becomes a PASS.

## Data flow

```text
Phase 4 release evidence
          │
          ▼
qualified candidates ──► bounded cohort manifest ──► local activation record
          │                         │                         │
          └─────────────────────────┴──────────────► NOT_RUN_REMOTE submission
                                                            │
                                                            ▼
          D+7/D+14 surveillance ──► D+28 diagnosis ──► D+60 gate ──► D+90 portfolio
```

## Task matrix

| Task | Deliverable | Local proof |
| --- | --- | --- |
| P5-T01 | deterministic cohort manifest + constraints | size/locale/qualification/rights/property tests |
| P5-T02 | versioned local activation and submission record | phase gate + explicit `NOT_RUN_REMOTE` |
| P5-T03/04 | surveillance and D+28 diagnosis | missing data fails closed; severe incident freezes |
| P5-T05 | D+60 expansion/freeze evaluator | all thresholds and per-cohort segmentation |
| P5-T06 | D+90 locale × family portfolio decision | expand/improve/hold/merge-noindex/withdraw |

Phase 5 local PASS means the state machine, manifest, thresholds, and evidence are deterministic and fail closed. It does not mean URLs are indexed, discovered, submitted, or production-ready.
