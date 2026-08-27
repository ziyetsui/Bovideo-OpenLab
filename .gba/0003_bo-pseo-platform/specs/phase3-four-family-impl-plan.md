# Phase 3 — Four-family UI implementation contract

This focused phase contract binds implementation to `specs/0008-bo-pseo-platform-spec.md` §§8–9, §§12.4–12.5, §14.5 and `specs/0009-bo-pseo-platform-acceptance.md` §§8–9, AC-UI-001–007, AC-HUB-001–004, AC-GAL-001–003, AC-ENT-001–003, AC-DET-001–004, AC-MOD-001–051, AC-SEO-016–018 and AC-PERF-001–006.

## Scope and non-goals

Phase 3 implements four server-rendered page families—Hub, Gallery, Entity and Detail—and their content modules. Every route remains internal/noindex; production Sitemap submission, public canonical rollout, GitHub/OpenLab writes and controlled indexing remain Phase 4/5 work.

## Machine contracts

### Page schema

Each page projection is a strict discriminated schema:

```text
PageEnvelope {
  schema_version, page_id, route, locale, page_type,
  index_state, title, description, h1, canonical,
  breadcrumb[], provenance, modules[], links[],
  snapshot_version, content_hash
}
```

`page_type` is `hub | gallery | entity | detail`. `index_state` is the existing page state machine. Every page has exactly one H1, a non-empty locale-specific title/description, a graph-consistent breadcrumb, explicit provenance, and only canonical 200 links. Missing or stale inputs produce `unavailable`/`stale` module states; they never create filler facts or fake links.

### Module envelope

All factual modules use the existing `ModuleEnvelope` shape: non-empty source refs, rights state, generator/version, content hash, freshness, QA and review state. Module-specific payloads are strict and cover `case`, `tutorial`, `prompt`, `comparison`, `faq`, `examples`, `provenance` and `action`.

### Golden fixtures

Every page family has three committed fixtures:

1. `complete` — all required modules and valid canonical links;
2. `partial` — missing/blocked modules render honest unavailable states;
3. `stale` — withdrawn or stale child content is excluded or labeled stale.

The fixture matrix is deterministic across all 16 application locales and must prove the Payload-to-page-schema diff is empty.

## Task contracts

| Task | Contract | Required proof |
| --- | --- | --- |
| P3-T01 | Strict page schemas, module schemas and three fixtures per family | schema validation, fixture matrix, zero unmapped fields |
| P3-T02 | Shared SSR shell, metadata, breadcrumbs, provenance, CTA and locale switch | server HTML with one H1, noindex, keyboard-accessible CTA/locale behavior |
| P3-T03 | Hub projection with deterministic featured/diversity selection | only qualified links, inventory/snapshot date, deterministic repeatability |
| P3-T04 | Gallery projection with mutually exclusive media type, filters and crawlable pagination | `mixed`/`unresolved` route rejection and no-JS pagination |
| P3-T05 | Entity projection with qualification-gated empty states | each failed gate records a reason and remains noindex/not-generated |
| P3-T06 | Detail route with ten-question order, byte-exact copy and action/provenance states | explicit/inferred/unavailable/candidate rendering and copy contract |
| P3-T07 | Case/tutorial/prompt/comparison/FAQ modules | rights, freshness, selector/assertion, source and no-fabrication invariants |
| P3-T08 | JSON-LD and canonical internal-link graph | parseable schema matches visible content; orphan/link checks |
| P3-T09 | Accessibility, performance and visual regression harness | critical/serious WCAG violations 0; page-family budgets and desktop/mobile snapshots |
| P3-T10 | Seven-day internal noindex soak harness | availability, queue age, three publishes, rollback, daily 16-locale smoke |

## Rendering and safety invariants

- Primary SEO content is in initial server HTML and does not require hydration.
- Query/filter/sort state does not create indexable routes; all internal routes remain noindex until Phase 4 release approval.
- Canonical, robots, Sitemap eligibility and route state are derived from one page envelope; Phase 3 emits no production Sitemap entries.
- User-provided/source text is escaped as text, never interpolated as raw HTML.
- CTAs expose success/failure state; unavailable actions are disabled with a visible reason.
- A stale, revoked, blocked or unauthorized child cannot leak into a qualified page, snapshot or export.

## Phase 3 exit criteria

- All four page families pass schema/fixture and no-fabrication contracts.
- WCAG critical/serious automated violations are zero; required keyboard journeys pass.
- Primary content is present with JavaScript disabled; full qualified inventory is crawlable through finite pagination.
- Per-family TTFB/HTML/LCP/INP/CLS budgets are measured and pass or have an explicit reviewed exception.
- A committed soak harness records the seven-day criteria and remains noindex-only.
- A single independent Phase 3 review has no unresolved in-scope P0/P1 findings.

## Dependency gate

Phase 4 work is unlocked only after this phase's implementation, verification, soak evidence and independent review are complete. Phase 5 indexing is unlocked only after Phase 4 release acceptance and a finite qualified cohort manifest.
