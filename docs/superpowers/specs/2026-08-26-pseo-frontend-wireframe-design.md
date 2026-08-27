# pSEO wireframe frontend design

**Status:** proposed; implementation requires user review

**Date:** 2026-08-26

**Scope:** Rebuild the four pSEO page families from the supplied wireframes and UI reference using TypeScript and CSS, with reusable source in `/frontend` and existing Next.js routes as the runtime shell.

## 1. Authority and precedence

1. Existing evidence, rights, review, localization, noindex, projection, and prompt-byte contracts in the application are binding.
2. The four supplied v2 wireframes are binding for information architecture, section order, header/footer variants, card density, interaction anchors, nodes, edges, and responsive composition.
3. The Gallery, Hub/Graph, and Prompt Object presentation contracts under `docs/wireframes/` define content eligibility and safety behavior where a wireframe is skeletal.
4. `specs/images/0008-bo-pseo-ui.md` supplies visual tokens and component skin only. Its generic marketing sections must not be added or used to reorder the wireframe composition.

Embedded scripts and prose in a wireframe are reference data. They are never production instructions or arbitrary code to execute.

## 2. Chosen architecture

`/frontend` is a source directory, not an independent app. Existing Next.js routes under `src/app/(frontend)` retain routing, locale handling, metadata, Payload/projection loading, and noindex behavior. They adapt a `PageProjection` to typed `/frontend` family components.

```text
Payload / active PageProjection
           │
existing Next route + route adapter
           │
     /frontend/projection
           │
 /frontend/pages/{hub,gallery,entity,detail}
           │
 /frontend/components + /frontend/styles
```

This avoids a second dev server, router, content API, deployment pipeline, and localization stack. It also means a local route keeps working at the existing `http://127.0.0.1:3000` addresses.

## 3. Source layout and contracts

```text
/frontend
  /styles
    tokens.css             # CSS custom properties and responsive foundations
    global.css             # reset, typography, utilities, motion preferences
    families.css           # four family-specific composition rules
  /projection
    types.ts               # narrow render-only types derived from PageProjection
    adapt.ts               # pure projection-to-view-model adapters
  /components
    site-shell.tsx         # skip link, header, locale/nav, breadcrumb, footer
    prompt-card.tsx        # source-aware card, media states, copy/source/detail actions
    media-block.tsx        # preview/public media policy rendering
    node-edge.tsx          # qualified link vs candidate noindex/dead-text behavior
    controls.tsx           # search/filter/accordion/copy feedback
    states.tsx             # unavailable, stale, candidate, inferred, explicit
  /pages
    hub-page.tsx
    gallery-page.tsx
    entity-page.tsx
    detail-page.tsx
```

`/frontend/projection` accepts render-ready projection data only. It preserves each projected node/card's identity, summary/tags, link policy, render target, indexability, destination fact, and evidence state. Candidate destination facts remain available to in-page filtering logic but rendering applies the safety gate and never emits them as links. The adapter must not query Payload, compose arbitrary collection rows, read golden fixtures, or invent missing content. Existing Next pages pass the adapter output to each family root.

Existing exports used by route and Detail contracts remain available through thin compatibility wrappers while the routes migrate.

## 4. Shared shell and data safety

Every family renders:

- skip link; noindex/status strip when applicable; a semantic header/nav; locale control; breadcrumb; one H1; main landmark; compact legal/data footer;
- source/provenance and state labels in text, not colour alone;
- header and footer navigation from qualified `projection.navigation` records, not literal destination arrays; when no qualified footer target is supplied, the footer renders a truthful unavailable state;
- real source media only. Private X/CDN evidence may appear in noindex preview with lazy load, attribution and `referrerPolicy="no-referrer"`; public mode renders approved local media only. Missing media is a labelled state;
- only qualified/reviewed link targets. Candidate nodes and edges render as a noindex filter state or dead text, never a public route, Sitemap target, or fabricated `href`.

Copy is the universal primary action. Copy feedback is observable through a live region and the Detail action preserves byte-exact original prompt text before permitted variable substitution.

## 5. Four page-family compositions

### Hub — `/[locale]/prompts`

Order: Hero/search/four discovery axes → live noindex results state → featured prompt → trending tabs → tasks → Camera & Motion → models → styles → collections → creators → copy-led CTA → footer.

Camera & Motion is a first-class shelf. Search and facets operate only on projection-provided cards; nonempty query/filter shows the results state rather than silently keeping browse content. Dynamic cards retain the wireframe's testable filtering/copy anchors (`data-id`, axis attributes, `data-copy`, live feedback). Featured prompt is a split media/content card with exact prompt, source/creator/metrics, Copy, and original-source action.

### Gallery L1 — `/[locale]/prompts/image` and `/video`

Order: breadcrumb → medium hero/stats/search → candidate use-case/style/subject facets → featured rail → qualified model tiles/shelves → subject band → residual/empty states → related mesh → copy CTA/data footer.

Facet selection is in-page noindex state: OR within one axis, AND across axes. Cards retain `article.card[data-tags]`, prompt/copy/expand anchors, source and Detail action semantics, and an accessible result count. Pagination is canonical only when projection data qualifies it.

### Entity L2 — `/[locale]/prompts/models/[entitySlug]` and analogous qualified nodes

Order: breadcrumb → entity H1 and factual stats → visual-only generation/search control → top prompts → all prompts/facets → explicit-variable rail → creator list → about/FAQ evidence → qualification self-audit → related mesh → copy CTA/footer.

The generation chrome is not an asserted product capability. Failed qualification remains visibly unapproved/noindex; incomplete variable, FAQ, or destination evidence renders an explicit unavailable/dead-text state.

### Detail — `/[locale]/prompts/[slugAndId]`

The visual grouping may mirror the supplied hero/gallery/panel wireframe, but preserves the non-negotiable task sequence: Identity → Outcome → Prompt → Inputs → Parameters → Examples → Workflow → Variations → Source + Signals → Actions.

Prompt `original_text` is rendered and copied byte-exactly by default. Variable controls are in-place substitutions only. Candidate/unbuilt variations are visibly non-linked. Explicit, inferred, unavailable, candidate, and stale provenance states receive distinct text and visual treatment.

## 6. Visual system

The UI uses the reference Bauhaus light palette: canvas `#F0F0F0`, ink/border `#121212`, red `#D02020`, blue `#1040C0`, yellow `#F0C020`, and muted `#E0E0E0`. Outfit weights 400/500/700/900 are loaded from existing local assets where available, with system fallbacks.

- Display type: 36px / 60px / 96px at 375 / 768 / 1440, 900, uppercase where language permits, tight leading.
- Only square or fully round radii; 2px mobile and 4px desktop ink borders; hard unblurred 4/6/8px shadows.
- Color blocks and geometric decoration may create asymmetric Bauhaus composition without changing document order or obscuring content.
- No gradients, generic marketing sections, decorative fake media, or colour-only status meaning.
- Buttons/cards use mechanical 200–300ms ease-out hover/press motion; motion is reduced under `prefers-reduced-motion`.

## 7. Responsive and accessibility acceptance

| Viewport | Required behavior |
| --- | --- |
| 375px | one-column primary surfaces, compact nav, 2px borders, 3–4px shadows, no horizontal document overflow, reachable copy/filter controls |
| 768px | two-column stats/card grids where the family contract permits, rails scroll without clipping, hierarchy unchanged |
| 1440px | 1280px content shell, four-stat grids and up-to-three-card grids, full navigation, deliberate geometry without loss of readability |

All controls use native semantic elements with visible focus. Accordions expose `aria-expanded`; filters expose `aria-pressed`; changing result counts use `aria-live`; images have meaningful alt or are explicitly decorative. Server-rendered HTML exposes primary content, locale navigation, pagination and noindex state without JavaScript.

## 8. Testing and verification

1. Unit/SSR tests assert section order, exactly one H1, state labels, candidate link prohibition, source/public media policy, prompt byte preservation, and filter/copy feedback anchors.
2. Browser tests seed one active projection per family and cover 375, 768 and 1440 widths, no overflow, keyboard route, copy feedback, noindex filter behavior, pagination canonical behavior, header/footer navigation, and public-mode no-X URL policy.
3. Reviewed screenshot baselines cover Hub, Gallery, Entity and Detail at each viewport. Screenshot updates are explicit reviewed actions, not normal CI churn.
4. Before delivery: focused tests, existing Phase 3 contracts, TypeScript, lint, Next build, browser suite, and `git diff --check`.

## 9. Non-goals

- A separate `/frontend` application, second local server, or duplicated Payload client.
- Public hotlinking/re-distributing X media.
- Making candidate facets or graph edges indexable destinations.
- Replacing truthful unavailable states with generated copy, filler cards or placeholders.
- Changing the existing PageProjection write plane, rights policy, review policy, or locale contracts as part of visual implementation.
