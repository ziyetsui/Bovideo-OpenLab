# Phase 3 — Contract-driven pSEO projection redesign

**Status:** Design approved in conversation; pending written-spec review

**Date:** 2026-08-26

**Owner:** `.gba/0003_bo-pseo-platform`

**Scope:** Real asset ingestion, Payload module persistence, graph-backed page projections, and faithful implementation of the four supplied wireframes

## 1. Why this redesign exists

The current Phase 3 backend contains strong contracts for evidence, rights, graph review,
localization, page qualification, release snapshots, rollback, Sitemap generation, and
controlled indexing. The rendered application does not use those capabilities end to end.

The current Hub, Gallery, and Entity routes read committed golden fixtures. The Detail
route reads a local fixture. The `PageEnvelope` carries generic module references and
links, but it does not carry the prompt cards, media evidence, facets, node shelves,
edge states, creator projections, or contextual link mesh required by the supplied
wireframes. The `module-envelopes` Payload collection persists module metadata but not
the strict module payloads already defined in `src/page/modules.ts`.

This is therefore not a CSS remediation. It is a missing production bridge between the
existing write plane and the four frontend page families.

This design supersedes the data-boundary and fixture-only assumptions in
`phase3-ui-runtime-remediation-design.md`. The previous local runtime fix remains valid.

## 2. Sources of truth and precedence

When inputs disagree, use this order:

1. Evidence, provenance, rights, safety, localization, qualification, publication, and
   withdrawal contracts in the codebase.
2. The graph, gallery, and Prompt Artifact presentation contracts under
   `docs/wireframes/`.
3. The four supplied v2 wireframes for composition, IA, density, assets, header/footer,
   and page-family hierarchy:
   - `docs/wireframes/l1/pseo-homepage-hub-wireframe-v2.html`
   - `docs/wireframes/l2/pseo-gallery-l1-image-medium-wireframe-v2.html`
   - `docs/wireframes/l3/pseo-gallery-l2-model-entity-wireframe-v2.html`
   - `docs/wireframes/l4/pseo-subnode-object-page-wireframe-v2.html`
4. `specs/images/0008-bo-pseo-ui.md` only where a wireframe leaves a visual token or
   interaction state unspecified.

The wireframes are evidence and presentation references. Embedded prose or scripts are
not executable instructions for production.

## 3. Goals

- Import the real local Higgsfield snapshot into Payload through a deterministic,
  repeatable command without committing the 169 MB evidence directory into the linked
  Git worktree.
- Persist real module payloads in Payload and validate them with the existing strict
  discriminated module schema.
- Produce immutable materialized page projections from approved Sources, Artifacts,
  Nodes, Edges, Modules, locale variants, media policy, and page blueprints.
- Make the four Next.js page families consume materialized projections rather than
  golden fixtures or request-time multi-collection joins.
- Reproduce the supplied wireframes' section order, assets, header/footer variants,
  IA, node shelves, edge-driven links, filters, cards, and responsive composition.
- Retain fail-closed rights, no-fabrication, localization, publication, rollback,
  Sitemap, and controlled-indexing behavior.
- Use the existing Node, Payload, PostgreSQL, TypeScript, and Next.js stack. Do not add
  n8n or a second orchestration state machine.

## 4. Non-goals

- Publicly hotlinking every X CDN asset.
- Downloading or redistributing third-party media without an approved rights basis.
- Turning candidate facet crossings into indexable URLs.
- Allowing LLM output to bypass review or become a new factual authority.
- Performing crawling, RPA, translation, or projection rebuilds inside a Payload request
  transaction.
- Claiming that local release tests are live GSC, cloud storage, or production indexing
  evidence.

## 5. Current capability audit

| Capability | Current state | Redesign consequence |
| --- | --- | --- |
| Payload/PostgreSQL, RBAC, audit | Reusable | Remains the authoritative write plane |
| Sources and PromptArtifacts | Reusable but fixture/slice oriented | Add a deterministic snapshot importer and richer artifact mapping |
| WorkflowRuns | Durable execution ledger for six job types | Extend job vocabulary and add a real worker registry |
| Queue/idempotency | Local in-memory emulator | Preserve contracts; add PostgreSQL-backed worker leasing and durable claims |
| Module schemas | Strict payload schemas and publishability gates exist | Persist their payloads in Payload and execute generators |
| ModuleEnvelopes collection | Metadata only | Add payload, slot, dependency, quality, and visibility fields |
| Nodes/Edges | Evidence and review machinery exists | Complete node types and relation vocabulary required by the graph contract |
| Localization | Protected spans, QA, review, stale fanout exist | Run against approved modules/projections; publish locales independently |
| PageEnvelope/projectors | Generic counts, module refs, and links | Add blueprint slots and render-ready projection payloads |
| Next routes | Golden/local fixtures | Replace with a projection repository |
| Publication/Sitemap/rollback | Strong deterministic local implementation | Feed it materialized projections and retain existing gates |
| Controlled indexing | Local cohort logic exists | Retain; connect only after release qualification |

## 6. Chosen architecture: hybrid materialized projection

```text
Local snapshot / UGC / RPA / crawler / first-party knowledge base
                              │
                        Source adapters
                              ▼
              Sources + MediaEvidence (private evidence)
                              │
             PromptArtifacts + TaxonomyNodes + Edges
                              │
                       Module generators
                              ▼
               ModuleEnvelopes (content + policy)
                              │
                  PageBlueprint + PageRecords
                              ▼
                 immutable PageProjections
                         ┌────┴────┐
                    draft preview  activated release snapshot
                         │          │
                    Payload preview public Next.js read plane
```

Payload is the editorial and workflow authority. `PageProjection` is the sole rendering
contract. Draft previews may resolve the latest draft projection; public routes resolve
only the projection referenced by the active immutable publication snapshot.

Frontend routes must not rebuild graph queries or assemble arbitrary Payload rows on
every request. Projection generation performs the joins once, validates the result, and
records dependency hashes so only affected pages rebuild.

## 7. Asset strategy

The chosen strategy is a split preview/public policy.

### 7.1 Evidence import

The importer reads an explicit `ASSET_SNAPSHOT_DIR` containing:

- the immutable source manifest;
- normalized prompt/source records;
- raw evidence object references;
- derived media references;
- source URLs, author handles, observed metrics, and snapshot coverage.

It verifies manifest hashes before writes. It is restart-safe and idempotent by source
identity plus content hash. The repository keeps only a compact licensed/golden test
slice; it does not duplicate the 169 MB snapshot inside the worktree.

### 7.2 MediaEvidence

Add a private `media-evidence` collection for remote media references. It records source,
tweet/media identity, type, dimensions, duration, remote thumbnail/video reference,
observed time, rights state, sensitive-content state, and content hash. Its URLs are not
part of the public export allow-list.

Internal noindex preview may resolve an active X CDN reference with attribution,
`loading="lazy"`, and `referrerpolicy="no-referrer"`. Failure renders an explicit media
unavailable state.

### 7.3 Public media

The existing `media` collection remains the public-media authority. A media object may
enter it only after it has `first_party` or `redistribution_licensed` rights and has been
copied into the approved public object namespace. Public projection generation drops
all other media references and falls back to text, metrics, and the original source link.

Rights revocation withdraws the media, dependent modules, page projections, release
records, cache entries, and Sitemap entries through the existing fanout policy.

## 8. Payload model changes

### 8.1 Existing collections retained

- `sources`: immutable source revisions and private raw evidence references.
- `prompt-artifacts`: byte-exact Prompt text, variables, outcome, inputs, parameters,
  examples, signals, source, models, taxonomy, and variation relationships.
- `taxonomy-nodes`: stable graph identities and promotion state.
- `edges`: evidence-backed relations and review state.
- `locale-variants`: independently reviewed localized content.
- `page-records`: page identity, intent, qualification, and index state.
- `publication-snapshots` and active pointers: immutable release activation and rollback.
- `workflow-runs`: durable worker execution ledger.

### 8.2 Graph vocabulary

The canonical relation vocabulary must cover:

- `generated_with`
- `used_for`
- `produces`
- `has_style`
- `uses_technique`
- `depicts`
- `targets_audience`
- `created_by`
- `sourced_from`
- `variation_of`
- `member_of`
- `compared_with`
- `requires_input`

Legacy aliases such as `authored_by` or `belongs_to` need an explicit migration mapping;
they must not remain ambiguous parallel relations.

### 8.3 ModuleEnvelopes

Extend `module-envelopes` with:

- `payload`: the module-specific strict payload;
- `slot_key` and `position`;
- `dependency_refs` and `dependency_hash`;
- `quality_result` and `risk_classes`;
- `visibility`: `internal_preview | public_candidate | public`;
- `renderer_version`;
- optional `stale_reason`.

A `beforeChange` hook reconstructs the canonical module object and parses it with
`pageModuleSchema`. Invalid payloads never enter Payload. The collection remains one
module authority; separate per-type content collections are not introduced.

### 8.4 PageBlueprints

Add versioned page-blueprint definitions in code with an optional read-only Payload
mirror for inspection. Each ordered slot defines:

```text
slot_key
renderer
source_mode: content_envelope | graph_query | page_metadata
allowed_module_types
min_items / max_items
empty_behavior
indexing_requirement
query_version
```

Blueprints are code-reviewed contracts. Editors select approved content and review
results; they do not arbitrarily mutate production renderer names or graph queries.

### 8.5 PageProjections

Add an immutable `page-projections` collection/read model with:

- page, locale, family, blueprint version, renderer version;
- source/module/graph dependency hashes;
- complete render-ready `PageEnvelope` payload;
- navigation projection version;
- validation report reference;
- state: `draft | validated | released | superseded | withdrawn`;
- content, link, schema, and media hashes;
- created time and generator WorkflowRun reference.

No projection is edited in place. A changed dependency creates a new version.

## 9. Automated module system

Page H2 sections use two kinds of automation.

### 9.1 Evidence-bearing content modules

| Module | Inputs | Automation | Required gates |
| --- | --- | --- | --- |
| Case | Authorized UGC, licensed creator cases, first-party cases | Normalize, deduplicate, associate Prompt/model/outcome/workflow/media | UGC authorization, media rights, safety; Money Page review |
| Tutorial | RPA execution record and screenshots | Execute selector/action/assertion steps, redact PII, record application version | All steps passed, screenshot/UI authorization, freshness |
| Prompt | Local snapshot, licensed feeds, purchased content | Byte-exact import, hash, dedupe, variable extraction, taxonomy/edge candidates | No LLM rewrite; redistribution rights for public text |
| Comparison | Competitor official pages plus first-party knowledge base | Extract two-sided facts, retain citations, use AI only for cited synthesis | Price expiry <=7 days, feature expiry <=30 days, factual human review |
| FAQ | GSC queries, onsite search, support data, approved demand evidence | Cluster questions and synthesize answers only from approved source refs | Demand source and sample count; Money/legal/AI text review |

Supporting modules remain `examples`, `provenance`, and `action`. Product actions stay
disabled unless an approved action URL and product contract exist.

### 9.2 Deterministic projection modules

The following are generated from approved graph/page data without LLM writing:

- `facet_axis`
- `prompt_shelf`
- `node_shelf`
- `creator_shelf`
- `link_mesh`
- `source_panel`
- `data_notes`

These live in the render projection, not as invented editorial ModuleEnvelopes. Each one
records its query version and graph dependency refs.

## 10. Four page blueprints

### 10.1 Hub `/prompts`

The Hub reproduces the L1 v2 composition:

1. H1, inventory truth, snapshot stats, search, and facet chips.
2. Featured Prompt.
3. Trending/time-window Prompt shelf.
4. Create by task.
5. Camera & Motion as a first-class axis.
6. Browse by model.
7. Browse by style.
8. Curated collections.
9. Creators.
10. Terminal CTA.
11. Multi-axis footer plus snapshot/data notes.

### 10.2 Gallery `/prompts/image`

The Gallery reproduces the L2 v2 composition:

1. Medium H1, inventory stats, search, and filter summary.
2. Use-case, style, and subject facets.
3. Featured Prompt rail.
4. Model tiles and model-specific shelves.
5. Strongest subject band.
6. Other medium/residual states.
7. Related link mesh.
8. CTA and footer.

Facet state is page-local and noindex. Only qualified entity nodes receive links.

### 10.3 Entity `/prompts/models/{slug}`

The Entity page reproduces the L3 v2 composition:

1. Entity H1, inventory/creator/time facts, and generation-shaped input.
2. Recent/top snapshot.
3. All Prompt inventory with entity-scoped facets.
4. Explicit-variable Prompt shelf.
5. Creators.
6. About plus FAQ evidence.
7. Related surfaces.
8. CTA and footer.

The generation-shaped input remains disabled unless an approved Action module exists.

### 10.4 Detail `/prompts/{slug}-{id}`

The Detail page reproduces the L4 v2 composition:

1. Breadcrumb, H1, outcome, creator/source identity, and source media group.
2. Byte-exact Prompt, variables, copy action, inputs, and parameters.
3. Workflow steps.
4. Variable substitution controls.
5. Same-series variations.
6. Source and observed interaction signals.
7. Related models, uses, creators, and Prompts.
8. Minimal detail footer.

The domain payload retains the ten-question Detail contract. The visual projection may
compose adjacent questions into the wireframe sections, but it must not invent missing
answers or alter the byte-exact Prompt.

## 11. Navigation, nodes, and edges

Every projected navigation item records `node_ref`, `edge_ref`, `evidence_state`,
`promotion_state`, `target_page_id`, and `link_policy`.

- Candidate node/edge: label or filter state only.
- Reviewed node: may participate in aggregation; not automatically in Sitemap.
- Qualified node with a valid PageRecord: internal link allowed.
- Stale, blocked, retired, or withdrawn dependency: excluded from new projections.
- Real graph slice without a page: grey/dead text, never a fabricated URL.
- Each Prompt card tag evaluates linkability independently.

Add an immutable locale/version-specific `NavigationProjection` derived from the same
qualified graph and route manifest. It drives the appropriate Hub, Gallery/Entity, and
Detail header/footer variants plus contextual link meshes. Header and footer links are
therefore version-consistent with the body and Sitemap.

## 12. Native workflow orchestration

n8n is not used. Payload hooks, scheduled triggers, and explicit CLI commands create
idempotent WorkflowRuns. A TypeScript worker registry executes them outside request
transactions.

```text
01 ingest_snapshot
02 normalize_sources + extract_media
03 extract_nodes_edges
04 graph_review
05 generate_modules
06 module_qa + risk_review
07 translate_locales
08 project_pages
09 validate_projection
10 build_release_snapshot
11 activate + cache_convergence
12 sitemap_submit + gsc_observe
```

Extend the current job vocabulary to cover at least:

- `ingest`
- `browser`
- `extract_graph`
- `generate_module`
- `project_page`
- `translate`
- `validate_release`
- `publish`
- `export`
- `observe_search`
- `withdraw`

The current LocalQueue and InMemoryIdempotencyStore remain deterministic test doubles.
Production/local-persistent execution uses PostgreSQL-backed leasing and durable claims
associated with WorkflowRuns. A crash or process restart must not lose queued work or
duplicate committed effects.

Payload hooks only enqueue commands. Scheduled triggers only enqueue freshness, RPA,
competitor, and search-observation work. Workers perform bounded writes through Payload
APIs and existing hooks/audit policy.

## 13. Staleness and incremental rebuilds

- New Source revision stales dependent locale variants, modules, edges, and projections.
- Node/Edge approval rebuilds only projections depending on that graph slice.
- Module approval rebuilds its owning pages/locales.
- Blueprint/renderer change rebuilds the affected family.
- Rights/safety/deletion change uses an emergency withdraw path.
- Dependency hashes prevent unchanged pages from receiving false `lastmod` updates.

## 14. Review policy

Deterministic counts, facets, qualified links, and approved-source provenance can pass
automated validation. Human review is mandatory for:

- Money Pages and every published Money Page locale;
- UGC authorization;
- Comparison/price facts;
- Tutorials containing third-party UI screenshots;
- LLM-written or LLM-summarized factual body content;
- Prompt/media rights changes;
- first qualification of a node/edge or first public release of a page.

AI output always enters `candidate`. It cannot self-approve or publish.

## 15. Localization

- Protected Prompt text, variables, identifiers, URLs, and evidence tokens remain
  byte-exact.
- Locale variants generate, QA, review, and publish independently; all sixteen locales
  do not need to launch together.
- No English fallback is emitted as a fake localized page.
- Hreflang includes only actually published reciprocal locale siblings.
- Money Page locale variants require explicit human approval.

## 16. Publication, Sitemap, and Google Search Console

Only a validated projection that passes rights, safety, canonical, robots, locale,
media, information-gain, link, schema, and hard qualification gates enters a release
candidate.

Activation atomically moves the active pointer to an immutable release snapshot. Failed
activation restores the previous verified version. Query/filter URLs never enter a
Sitemap. Sitemap shards remain locale x family, at most 10,000 URLs each, and update
`lastmod` only when content/link/schema dependency hashes change.

Ordinary pSEO pages must not use Google's Indexing API. That API is limited to
`JobPosting` and livestream `BroadcastEvent` pages. The production integration uses the
Search Console Sitemaps API to submit Sitemap URLs and uses URL Inspection only for
sampled diagnosis. Sitemap submission is a discovery hint, not an indexing guarantee.

Official references:

- <https://developers.google.com/search/apis/indexing-api/v3/using-api>
- <https://developers.google.com/webmaster-tools/v1/sitemaps/submit>
- <https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap>

## 17. Observation and improvement loop

Search Console and operational measurements are imported and segmented by locale,
family, blueprint version, module version, and graph/query owner.

- D+7/D+14: technical exclusion, orphan, availability, rights, and severe-incident checks.
- D+28: discovery/indexing and query-owner conflict diagnosis.
- D+60: expand/freeze decision.
- D+90: expand, improve, hold, merge-noindex, or withdraw by locale x family segment.

Underperforming pages are diagnosed at module, graph edge, locale, and query-owner
levels. The system updates a deficient module or merges/withdraws an overlapping page;
it does not blindly rewrite every page.

## 18. Verification contract

### 18.1 Import and CMS

- One command imports the real snapshot into a fresh local Payload/PostgreSQL instance.
- Re-running it produces no duplicate Sources, Artifacts, media evidence, or jobs.
- Manifest/hash mismatch fails before CMS mutation.
- Strict module payloads round-trip through Payload without unmapped fields.

### 18.2 Projection and frontend

- A Payload edit or approved graph/module transition produces a new draft projection.
- The four families render only from projections; fixture imports are absent from runtime
  route files.
- Header, footer, assets, facets, node/edge states, cards, and link meshes come from the
  same projection version.
- Each Blueprint has exactly one H1 and its required ordered H2 slots.
- No invented Prompt, author, metric, media, FAQ, capability, or URL enters output.
- Candidate/verified/qualified/stale/withdrawn states remain visibly and behaviorally
  distinct.

### 18.3 Browser and visual

- Hub, Gallery, Entity, and Detail match their supplied v2 composition contracts.
- Screenshots pass at 375 px, 768 px, and 1440 px.
- No unintended horizontal overflow.
- Keyboard, focus, copy, search/filter, pagination, and unavailable states work.
- JavaScript-disabled HTML retains primary SEO content and crawlable finite navigation.

### 18.4 Release and operations

- Qualification, release, rollback, rights withdrawal, cache convergence, Sitemap diff,
  and orphan/link audits are repeatable.
- Remote X media never leaks into public snapshots without approved public-media rights.
- Public export poison tests continue to block private, raw, secret, metadata-only body,
  and unauthorized media fields.
- Search Console submission remains `NOT_RUN_REMOTE` until credentials and a verified
  property exist.

## 19. Key decisions

1. Use hybrid materialized projections, not live request-time CMS assembly.
2. Keep Node/Payload/PostgreSQL orchestration; do not add n8n.
3. Use the four v2 wireframes as composition and IA contracts.
4. Treat media evidence and public media as separate rights domains.
5. Persist strict content-module payloads; generate structural projection modules
   deterministically.
6. Candidate nodes/edges never imply a URL.
7. Preview and public output use different media resolvers but the same projection
   contract.
8. Publish locale variants independently.
9. Submit Sitemaps through Search Console; do not misuse the Indexing API.
10. Keep golden fixtures as tests only, never as runtime content.

## 20. Completion definition

This redesign is complete only when a fresh local environment can ingest the real
snapshot, persist and review graph/module records, generate all four versioned page
projections, render the supplied wireframe compositions from those projections, and
exercise validation, activation, rollback, rights withdrawal, and Sitemap generation
without fixture-backed runtime content or invented facts.
