# Page graph, media projection, and locale delivery design

Status: Approved by direct user instruction · Date: 2026-08-27

## 1. Architecture

```text
Sources ─┬─ PromptArtifacts ── reviewed TaxonomyNodes / Edges
         └─ MediaEvidence ──── preview/public delivery policy
                              |
                              v
                     PageProjection builder
       fixed family layout + cards + media + node/page edges
                              |
                bounded concurrent Payload writes
                              |
          PublicationProjection bindings + immutable snapshot
                              |
                    ActivePublicationPointer
                              |
            exact locale projection? ── yes ──> render
                       |
                       no
                       v
       deterministic locale chrome overlay on bound English bytes
```

Payload remains the write authority. The frontend reads exactly one bound immutable
projection and never joins Source, Artifact, Media or graph collections at request
time. Locale fallback transforms only already-bound renderer bytes.

### 1.1 Reviewed taxonomy ingress

Entity pages are not inferred from prompt prose or folder names at projection time.
An operator-supplied reviewed taxonomy manifest is a separate, auditable write-plane
input. Each assignment declares one reviewed/qualified taxonomy identity, the exact
source-version hashes it covers, and the expected artifact cardinality. The publisher
must reject a count mismatch before linking anything.

For an accepted manifest the write plane:

1. stages every manifest node as `candidate`, making it non-consumable by the
   projector;
2. links every targeted PromptArtifact through `model_refs` or `taxonomy_refs` while
   preserving existing relationships;
3. takes a PostgreSQL `FOR UPDATE` lock on the artifact parent and then its existing
   relationship rows in the same Payload adapter transaction, then re-reads and
   merges its relationships before an ID-scoped Local API update whose collection
   hook atomically claims and increments the persisted revision;
4. verifies the full expected relationship set;
5. promotes all manifest nodes and appends their immutable review audit events in one
   final transaction;
6. re-reads populated Payload relationships before building projections.

The accepted review event records the Payload service actor, `review_id`,
`reviewed_at`, manifest hash and review evidence references. The TaxonomyNode carries
relationships to the covered Source evidence and shares the deterministic review
correlation ID with its mutation audit events.

The review manifest is evidence, not page content. A missing manifest leaves taxonomy
empty; it must never trigger a fabricated Entity route.

## 2. Page graph contract

### 2.1 Required hops

| From | Edge | To | Render |
| --- | --- | --- | --- |
| Hub output node | `produces` | `/[locale]/prompts/image` or `/video` | page link |
| Gallery model node | `generated_with` | `/[locale]/prompts/models/[slug]` | page link |
| Hub/Gallery/Entity prompt card | `contains` | `/[locale]/prompts/[slug]-[stable-id]` | title + Detail link |
| Detail related item | `related` | bound parent/entity/sibling route | page link |

Every page link has `render_target=page` and a non-null `href`. Its
`target_indexability` may be `indexable` **or** `noindex`. Only `none` is forbidden.
Candidate facets remain `filter_state` or `dead_text` and never masquerade as a page.

### 2.2 Navigation projection

Every projection carries the same release-version navigation set:

- Hub;
- each non-empty medium Gallery;
- reviewed/qualified model Entity destinations included on that page;
- related parent destinations appropriate to the family.

`edge_ref` is stable and non-null for generated page edges. Header, footer, shelves,
breadcrumbs and cards consume these projected edges; components do not invent URLs.

## 3. Prompt card projection

```ts
type ProjectedPromptCard = {
  prompt_ref: RelationRef
  title: string
  summary: string | null
  prompt_text: string                 // original, byte-preserved
  prompt_language: ApplicationLocale | string
  media: ProjectedMedia[]             // maximum 4, deterministic order
  tags: ProjectedNodeItem[]
  evidence_state: 'candidate' | 'reviewed' | 'qualified'
  link_policy: 'link'
  href: string
  render_target: 'page'
  target_indexability: 'noindex' | 'indexable'
}
```

Old projection bytes remain readable by treating the new card fields as optional at
the persistence schema boundary. New projector output must supply them.

## 4. Media mapping and policy

### 4.1 Selection

The publisher resolves MediaEvidence by the Payload `sources.id` relationship, sorts
by media type/provider ID, de-duplicates identical URLs, and takes at most four.

An item is renderer-eligible only when one of these policies passes:

| Projection | Required facts |
| --- | --- |
| noindex X preview | provider `x`; sensitivity `allowed`; visibility `internal_preview`; delivery `x_cdn`; `preview_noindex=true`; attribution URL present; twimg URL |
| public/indexable | visibility `public`; delivery `approved_public_cdn`; rights `first_party` or `redistribution_licensed`; no twimg URL |

Private evidence is never silently exposed. The release command may explicitly promote
safe X rows to `internal_preview` for this engineering environment. Promotion writes
`delivery_target=x_cdn`, source attribution and an audit event; blocked/restricted rows
remain private.

For `sensitive_content_state=unknown`, the reviewed allowlist is type-aware: an image
requires its rendered `remote_url` to be reviewed and may omit `thumbnail_url`; a video
requires both its rendered video URL and poster URL to be reviewed. If an image does
carry a separate thumbnail, that thumbnail must also be reviewed. This avoids treating
the normal absence of a redundant image thumbnail as a reason to suppress the image.

### 4.2 Rendering

- Image: lazy `<img>`, intrinsic dimensions when known, `referrerPolicy=no-referrer`
  for preview delivery.
- Video: lazy/no-preload `<video>` with thumbnail as `poster` when available.
- Multiple media: fixed card gallery, first item primary, remaining items exposed in
  deterministic source order.
- Missing or rejected media: explicit unavailable block; never a broken placeholder
  URL.

Detail `examples.mediaRefs` carries the projected media evidence IDs, and the Detail
hero renders the same media projection as its prompt card.

## 5. Locale contract

### 5.1 Precedence

1. Exact active locale projection whose LocaleVariant is published.
2. Deterministic presentation overlay of the active English projection.
3. 404 only when the English page identity itself is not bound.

The overlay:

- rewrites only the leading locale segment of internal routes, breadcrumbs, page links,
  navigation and pagination;
- localizes route chrome, family titles/descriptions, navigation and disclosure text
  from a versioned 16-locale dictionary; exact reviewed LocaleVariants own deeper
  module-copy translation;
- keeps `prompt_text`, source URLs, model names and evidence IDs unchanged;
- marks the page `translation_state=source_fallback` and remains noindex;
- derives new projection/content/link hashes so the transformed bytes validate.

An exact published locale projection uses `translation_state=translated`. English uses
`source`.

### 5.2 UI requirements

The locale control renders human language names, not only codes. Every advertised
locale is a real anchor. The selected locale has `aria-current=page`. The page wrapper
has `lang` and a visible fallback disclosure when content metadata remains English.

## 6. Publication transaction and batching

`publishLocalPseoProjections` uses a default concurrency of 8 (configurable 1–16).

Projection/workflow rows are written in bounded batches of 25. Binding rows use
batches of 50. Preview promotion uses batches of 50. Every batch opens a Payload
PostgreSQL transaction when the configured adapter exposes transaction methods.
Reviewed taxonomy links also use batches of 50 and complete before projection input
is read. The parent-plus-relationship lock protocol is required because Payload 3.88
bulk `where` updates resolve IDs before the final adapter write. A PromptArtifact
collection hook atomically claims `WHERE id AND revision`, increments revision, and
forces every supported relationship-only Local/API update through the parent row.
Stale requests fail with a revision conflict after waiting instead of overwriting
new relationships, and all writers share Payload's parent-then-relationships order.
Existing relationship changes serialize on their row locks; new inserts serialize
through the parent foreign-key lock. Direct database relationship writes are outside
the supported CMS contract. If any link batch fails, all involved nodes remain
`candidate`; earlier
committed relationship batches therefore cannot leak a partial Entity into a later
release. Their accepted review evidence becomes an auditable CMS fact only in the
final all-node promotion transaction. A later page-release failure does not revoke
that completed CMS fact, but the incomplete page release still cannot become active.

For every projection inside a batch:

1. create a fresh opaque publication request with the shared correlation ID;
2. create workflow run;
3. create immutable page projection;
4. terminalize that workflow before the lane is complete.

Different batches may run concurrently. No two concurrent Local API calls share a
mutable Payload request object; requests in one batch carry the same transaction ID
but remain separate carrier objects. Bindings also use fresh request carriers.

The snapshot and pointer are strictly sequential after all projections and bindings
and commit together in one final transaction. On any projection/binding failure, no
snapshot is created and the active pointer is not changed. Earlier committed
append-only batches remain audit evidence and cannot become live; a later retry uses
a new version.

## 7. Fixed layout slot mapping

| Family | Fixed slots fed by projection |
| --- | --- |
| Hub | hero/stats/search; outputs; featured/trending; use cases; models; styles; techniques; related/navigation |
| Gallery | hero/stats/search; three facet rails; featured cards; model entity nodes; subject/residual/related; pagination |
| Entity | hero/stats; top/all cards; facets/variables/creators/evidence/FAQ/related |
| Detail | identity/outcome/prompt/inputs/parameters/examples/workflow/variations/source/actions; related edges |

Empty evidence renders an honest unavailable state. It does not collapse the layout or
introduce generated filler.

## 8. Verification gates

- Projection schema and mapping unit tests.
- Transaction-isolation and failed-activation tests.
- React tests for card media, noindex page links and 16-locale chrome.
- Route integration test for locale overlay and stable prompt bytes.
- Browser click path Hub → Gallery → Entity → Detail plus a locale switch.
- Full 1043-artifact publication reconciliation: generated projection count equals
  workflow success count equals binding count; active pointer references that version.
- Active release reconciliation must contain at least one bound Entity route whenever
  its reviewed taxonomy manifest targeted a non-empty artifact set.
- Typecheck, lint where configured, production build, `git diff --check`, and an
  independent phase review.

## 9. Security and rollback

- Never log prompt bodies, media URLs, DB credentials or Payload secrets.
- Existing released projection bytes remain backward-readable during deployment.
- Deploy reader/schema compatibility before activating the new projection version.
- Rollback is the existing pointer transition to `previous_verified_version`; media
  preview promotion is separately auditable and does not make an old version reference
  the media.
