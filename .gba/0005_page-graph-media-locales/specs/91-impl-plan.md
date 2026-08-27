# Page graph, media, and locales implementation plan

Status: In progress · Date: 2026-08-27

**Goal:** Ship one complete active release whose four page families are connected,
media-backed, and usable through all 16 locale routes.

**Spec:** [00-prd.md](./00-prd.md), [10-design.md](./10-design.md),
[99-key-decisions.md](./99-key-decisions.md).

## Phase 1 — Contract tests

- [x] Add RED tests proving noindex page edges are clickable.
- [x] Add RED tests for projected prompt text and eligible media.
- [x] Add RED tests for Hub → Gallery → Entity → Detail destinations.
- [x] Add RED tests for exact/fallback locale resolution and immutable prompt text.
- [x] Add RED tests proving concurrent publisher calls never share a request carrier
  and pointer activation is last.

## Phase 2 — Projection and frontend

- [x] Extend backward-compatible projection card/media fields.
- [x] Join eligible MediaEvidence to artifacts and implement explicit preview promotion.
- [x] Materialize navigation/output/model/detail edges.
- [x] Render card media, copy action and noindex page links.
- [x] Add the versioned 16-locale UI bundle and deterministic bound-projection overlay.

## Phase 3 — Publisher

- [x] Implement bounded concurrency with a fresh request per Payload Local API call.
- [x] Keep projection workflow ordering within each lane.
- [x] Bind only after every projection succeeds; snapshot/pointer remain last.
- [x] Add counts/duration to the release result without logging sensitive bytes.
- [x] Use bounded Payload transactions for promotion/projection/binding batches and
  one final snapshot-plus-pointer activation transaction.

## Phase 4 — Release and verification

- [x] Run focused tests, typecheck, lint and build.
- [ ] Deploy backward-compatible reader/schema changes.
- [ ] Promote eligible preview media, generate the complete corpus, reconcile counts,
  and activate the new version.
- [ ] Browser-test the four-hop path, visible media and all 16 locale Hub routes.
- [ ] Run independent phase review, resolve findings, commit and push.

## Exit condition

The work is incomplete until the live active version contains all generated bindings,
the four-hop path and locale switch work in a browser, eligible cards show media, and
the verification evidence is recorded in `../docs/`.
