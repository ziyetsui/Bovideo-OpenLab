# Page graph, media, and locales PRD

Status: Approved by direct user instruction · Date: 2026-08-27

## Problem

The live pSEO preview reports 1043 prompts but renders empty shelves. Its Hub,
Gallery, Entity and Detail layouts do not form a clickable hierarchy, prompt cards do
not carry media, and 15 advertised locale links lead to missing routes.

## User outcome

A visitor can start at the Hub, follow a real medium edge into Gallery, follow a model
edge into Entity, open a prompt Detail, see its evidence-backed image/video preview,
copy the byte-preserved prompt, and switch the same surface among all 16 supported
locale routes without a 404.

## Goals

- Keep the supplied four fixed layouts and fill their slots from Payload projections.
- Make every displayed page destination a real accessible link, including noindex
  destinations.
- Carry safe media and original prompt text in the renderer-ready card projection.
- Make all 16 locale controls functional and visibly localized without inventing
  translated prompt text.
- Publish the complete imported corpus in a bounded, transaction-safe batch and move
  the active pointer only after complete binding.

## Non-goals

- Declaring these noindex engineering previews ready for search indexing.
- Redistributing third-party media from a public CDN without rights evidence.
- Treating machine-generated translation as reviewed LocaleVariant content.
- Creating taxonomy pages from unreviewed prompt prose.
- Replacing Payload or adding n8n.

## Success criteria

1. A browser test completes Hub → Gallery → Entity → Detail using visible links.
2. Every projected card with eligible media renders at least one image, video or video
   thumbnail; ineligible media has an explicit unavailable state.
3. Each of the 16 language targets returns 200 for the same active Hub/Gallery/Entity/
   Detail identity; chrome changes language and the source prompt remains unchanged.
4. A 1043-artifact release creates and binds every generated route, leaves the previous
   active pointer untouched on partial failure, and completes through the Supabase
   pooler within 15 minutes at the configured bounded concurrency.
5. Payload, frontend, focused browser, typecheck, build and independent review gates
   pass before activation.

## Authorities

- Base platform contract:
  [`phase3-contract-driven-pseo-projection-redesign.md`](../../0003_bo-pseo-platform/specs/phase3-contract-driven-pseo-projection-redesign.md)
- Runtime remediation:
  [`phase3-ui-runtime-remediation-design.md`](../../0003_bo-pseo-platform/specs/phase3-ui-runtime-remediation-design.md)
- Prior-art evidence:
  [`study-youmind-page-graph-media-locales.md`](../../../docs/research/study-youmind-page-graph-media-locales.md)
- This feature's normative design: [`10-design.md`](./10-design.md)
