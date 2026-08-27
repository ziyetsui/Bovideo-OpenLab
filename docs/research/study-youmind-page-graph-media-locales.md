# Study: YouMind prompt graph, media, and locale delivery

Status: Done · Date: 2026-08-27 · Decision owner: pSEO platform

## Question

Which observable YouMind patterns should Bovideo adopt to turn the four existing
wireframe families into one clickable page graph, carry evidence-backed images from
Payload into cards, and make all 16 locale controls useful without fabricating
translated prompt text?

## Scope and source boundary

This study reviews the public YouMind prompt surfaces and the public
`YouMind-OpenLab/ai-image-prompts-skill` export implementation. The OpenLab repository
is a CMS consumer and data-export reference; it is **not** represented here as the
private YouMind website source code.

The code reference is pinned as a Git submodule at
[`vendors/youmind-ai-image-prompts-skill`](../../vendors/youmind-ai-image-prompts-skill)
commit `3ae931854e48a0ca019c86d21d47dedd41efc798`.

## Findings

### 1. The public product is a route graph, not four isolated templates

The current [prompt hub](https://youmind.com/zh-CN/prompts) exposes medium routes,
model routes, taxonomy routes, and prompt-detail routes from one page. The
[image gallery](https://youmind.com/zh-CN/prompts/image) repeats the model shelves and
each prompt card links to a detail. The model surface, for example
[GPT Image 2 prompts](https://youmind.com/zh-CN/gpt-image-2-prompts), renders media cards
and complete-prompt links. A detail such as the
[Seedance video prompt](https://youmind.com/zh-CN/video-prompts/seoul-summer-documentary-vlog-9794)
is therefore reachable by semantic edges rather than by typing its URL.

The transferable pattern is:

```text
Hub --produces--> Medium gallery --generated_with--> Model entity
                                          |
                                          +--contains--> Prompt detail
Prompt detail --related--> parent gallery / model / sibling prompt
```

The route exists independently of whether it is indexable. `noindex` is a search
policy, not a reason to render a destination as inert text.

### 2. Media is part of the card contract

The OpenLab exporter selects `sourceMedia`, uploaded `media`, and video thumbnails
from the CMS. `processPromptImages()` prefers CMS-managed media and falls back to
source media or a video thumbnail. `transformToOutputPrompt()` rejects a prompt when
it has no media, then emits a stable `{ id, content, title, description, sourceMedia,
needReferenceImages }` object. See
[`scripts/generate-references.ts`](../../vendors/youmind-ai-image-prompts-skill/scripts/generate-references.ts).

The production lesson is not to copy YouMind URLs. Bovideo must materialize an
allow-listed media projection beside each prompt card. For this noindex preview,
reviewed X evidence may use attributed `twimg.com` delivery. An indexable/public
projection still requires first-party or redistribution-licensed media on the
approved public CDN.

### 3. Layout and data change at different rates

The exporter paginates the CMS, selects explicit fields, assigns prompts to dynamic
categories, and writes a manifest containing category slug, file, and count. Its
consumer reads that manifest instead of hardcoding category inventory. A scheduled
GitHub Action refreshes the export twice daily. See
[`generate-references.yml`](../../vendors/youmind-ai-image-prompts-skill/.github/workflows/generate-references.yml)
and [`references/manifest.json`](../../vendors/youmind-ai-image-prompts-skill/references/manifest.json).

Bovideo should therefore keep the four layouts fixed while PageProjection supplies
the variable page title, counts, nodes, edges, cards, prompt text, media and related
routes. The frontend must not infer those relationships from prose.

### 4. Locale chrome and prompt language are separate concerns

YouMind uses a locale URL segment (`/zh-CN/...`). The OpenLab skill explicitly answers
in the user's language while retaining English prompt content for generation. This is
a useful no-fabrication boundary: navigation, headings, descriptions and action labels
can be localized; the original prompt remains byte-preserved unless an approved
LocaleVariant exists.

An unavailable translation must not turn a language control into a broken link.
Bovideo can deterministically overlay localized chrome on the active English
projection, rewrite only the locale segment of internal routes, disclose source
fallback, and remain noindex. An exact published locale projection takes precedence
when it later exists.

### 5. Local root causes are contract failures

The current Bovideo implementation has four direct causes:

- `ProjectedPromptCard` carries neither prompt text nor media.
- the link validator only permits page links when the target is indexable, so a real
  noindex detail URL is mislabeled as `filter_state` and rendered as inert text;
- the projector emits an empty navigation projection and empty output shelves;
- the publisher materializes only one requested locale, while the shell advertises
  all 16, so locale targets are unbound and return 404.

The old active release also contains only four empty projections even though its
headline count says 1043. That is a release-content mismatch, not a CSS problem.

## Decision

Adopt a single materialized presentation contract:

1. A prompt card carries original prompt text, up to four sanitized media items, a
   real detail-page edge, and reviewed taxonomy tags.
2. Hub output nodes link to Gallery; Gallery model nodes link to Entity; Entity cards
   link to Detail; shell/footer navigation contains the same bound destinations.
3. `target_indexability` is independent from `link_policy`: a reviewed noindex page is
   still clickable.
4. Exact locale projections win. Otherwise a deterministic 16-locale presentation
   overlay localizes chrome and rewrites internal locale segments while preserving the
   English prompt and showing source fallback.
5. A full release persists projections with bounded concurrency and a fresh Payload
   request carrier for every Local API transaction. Snapshot creation and active
   pointer advancement happen only after all projections and bindings succeed.

The implementation contract is
[`10-design.md`](../../.gba/0005_page-graph-media-locales/specs/10-design.md).

## Evidence ledger

| Evidence | Used for |
| --- | --- |
| [YouMind prompt hub](https://youmind.com/zh-CN/prompts) | Hub IA, medium/model/detail edges, locale route form |
| [YouMind image gallery](https://youmind.com/zh-CN/prompts/image) | Gallery shelves, model and prompt destinations |
| [YouMind GPT Image 2 page](https://youmind.com/zh-CN/gpt-image-2-prompts) | Media-first entity cards and detail actions |
| [YouMind OpenLab](https://github.com/YouMind-OpenLab) | Public repository inventory and source boundary |
| [Pinned exporter](https://github.com/YouMind-OpenLab/ai-image-prompts-skill/tree/3ae931854e48a0ca019c86d21d47dedd41efc798) | CMS selection, media fallback, dynamic manifest, language behavior |
