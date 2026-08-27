# Phase 3 UI and local runtime remediation design

> **Superseded in part:** The local Payload/PostgreSQL runtime remediation in this
> document remains valid. Its fixture-only frontend data boundary, generic page
> composition, and non-goal of changing Payload collections are superseded by
> `phase3-contract-driven-pseo-projection-redesign.md`.

**Status:** implemented and verified on 2026-08-26
**Owner:** `.gba/0003_bo-pseo-platform`
**Scope:** Hub, Gallery, Entity and Detail frontend families plus the local Payload/PostgreSQL development entrypoint

## 1. Problem statement

The Phase 3 routes satisfy the data-envelope, provenance and route-contract tests, but the rendered frontend does not satisfy the supplied presentation contracts. The current view layer exposes largely uncomposed HTML on top of the Payload starter stylesheet. It therefore lacks the required design tokens, Bauhaus visual language, responsive composition and page-family hierarchy.

The observed Payload Admin failure is a separate runtime-startup issue. `pnpm dev` was launched with a PostgreSQL URL for `127.0.0.1:5432` while no database process was listening. Payload then failed during request initialization with `ECONNREFUSED`. The repository already contains `scripts/run-with-postgres.ts`; starting Next through that wrapper makes both `/readyz` and `/admin` return HTTP 200.

This remediation must correct both surfaces without weakening the page contracts, provenance rules, rights gates, noindex behavior or backend schema.

## 2. Sources of truth and precedence

When source artifacts appear visually different, apply this precedence instead of copying any one artifact literally:

1. **Data and safety:** existing `PageEnvelope`, detail schema, locale, provenance, publication and permission contracts.
2. **Information architecture:** the contracts and HTML references under `/Users/a1/Documents/wiki/30-39 Product and Web Builds/bo/docs/wireframes/`.
3. **Visual language:** `/Users/a1/Documents/wiki/30-39 Product and Web Builds/bo/specs/images/0008-bo-pseo-ui.md`.
4. **Fixture content:** existing approved local fixtures; fixtures may not be expanded with invented facts merely to fill a visual module.

The wireframes define hierarchy, grouping, section order and density. They are not the final style reference. The UI specification defines tokens, typography, geometry, borders, shadows, color and interaction character.

## 3. Goals

- Render all four page families as intentional, responsive product pages rather than engineering dumps.
- Use one shared Bauhaus token system and one set of composable presentation primitives.
- Preserve server rendering, semantic HTML, keyboard access, noindex metadata and evidence/provenance states.
- Represent missing evidence honestly with a designed unavailable state instead of hidden content or generated filler.
- Provide one discoverable command that starts Next, Payload and an ephemeral local PostgreSQL instance for development.
- Add automated contract and browser verification that detects a return to starter/default styling or broken composition.

## 4. Non-goals

- No changes to Payload collections, migrations, public publication gates or indexing policy.
- No production database provisioning or replacement for the externally managed `DATABASE_URL` path.
- No client-side search backend, generation workflow or enabled product action without an approved contract.
- No invented images, creators, statistics, FAQs or prompt claims.
- No literal port of the static wireframe HTML or its placeholder data.

## 5. Visual system

### 5.1 Tokens

The frontend owns a documented CSS custom-property layer with these normative color values:

- canvas: `#F0F0F0`
- ink: `#121212`
- red: `#D02020`
- blue: `#1040C0`
- yellow: `#F0C020`

The system must also define semantic aliases for surface, text, action, status and focus; a constrained spacing scale; type scale; `2px` and `4px` ink borders; and hard offset shadows of `4px`, `6px` and `8px`. Corners are square except for elements that are deliberately full circles or pills. Intermediate decorative radii are prohibited.

Outfit weights 400, 500, 700 and 900 are loaded as build-stable local package assets. Generic system fonts are fallbacks, not the intended result. Display headings are uppercase where the source language permits and use the responsive `4xl` through `8xl` range described by the UI specification.

### 5.2 Shared primitives

The presentation layer is composed from focused primitives rather than page-specific copies:

- site header, locale switcher and internal-preview strip
- geometric brand mark and non-content decorative shapes
- poster hero and section heading
- search/action field
- stat block, axis tile and taxonomy rail
- prompt/evidence card
- provenance badge and unavailable/stale panel
- method note, related-link band and final CTA

Decorative geometry is CSS or accessible-hidden SVG. It cannot replace semantic text or introduce an image dependency. Controls use mechanical hover/press movement and a visible keyboard focus state. Motion respects `prefers-reduced-motion`.

## 6. Page-family composition

### 6.1 Shared shell

Every family receives the same responsive header, breadcrumb treatment, locale control and noindex status strip. The current sixteen-item locale bullet list becomes a compact control that remains fully operable without JavaScript. The shell exposes the H1 exactly once and retains skip navigation, canonical metadata and structured data.

### 6.2 Hub

The Hub follows the L1 wireframe hierarchy:

1. poster hero, inventory truth and search
2. browse-by-output axes
3. featured/high-value prompts
4. model, use-case, style, technique and creator discovery shelves
5. residual inventory or explicit empty state
6. methodology and evidence modules
7. related routes and final CTA

Available fixture fields drive counts and links. Missing taxonomy evidence is shown as unavailable; it is not synthesized from labels.

### 6.3 Gallery

The Gallery follows the medium L1 projection:

1. medium-specific hero, stats, search and current filter summary
2. subject, output and style axes
3. featured prompt-card grid
4. model shelves and subject band
5. finite residual inventory
6. definition/methodology, related routes and pagination

Pagination retains real `rel="prev"` and `rel="next"` links. Mixed or unresolved media remains rejected by the existing projection contract.

### 6.4 Entity

The Entity follows the L2 model projection:

1. entity hero, qualification state and generation-shaped disabled input
2. recent/top snapshot
3. all qualified prompt inventory with facets
4. variable-bearing prompt band when evidence exists
5. creators
6. about/FAQ evidence modules
7. self-audit qualification facts
8. related routes and final CTA

Qualification failures remain visible and must never be styled as publication approval.

### 6.5 Detail

The Detail view keeps the exact schema order and renders ten visually distinct modules:

1. Identity
2. Outcome
3. Prompt
4. Inputs
5. Parameters
6. Examples
7. Workflow
8. Variations
9. Source + Signals
10. Actions

The original prompt remains verbatim and the default copy target. Each module displays one of `explicit`, `inferred`, `unavailable` or `candidate`; stale state remains visually and textually distinct. Unsupported examples or product actions use designed unavailable states. The copy control may become interactive, but generation/run actions remain disabled until separately approved.

## 7. Component and data boundary

The existing schemas and projection functions remain the domain boundary. Page-family composers consume a parsed `PageEnvelope` and derive view-only labels, groupings and presentation states without mutating it. Shared cards consume existing link/module/question values; they do not query Payload directly.

The current `PageShell` remains responsible for page-wide metadata-adjacent semantics but delegates visual composition to the shared shell primitives. `PageRouteView` delegates by discriminated `page_type` to Hub, Gallery and Entity composers. Detail continues to use its typed ten-question tuple through a dedicated Detail composer.

This boundary keeps visual work independent of Payload and lets fixtures, future Payload reads and snapshot releases render through the same components.

## 8. Local backend runtime

Add a package script named `dev:local` that invokes the existing `scripts/run-with-postgres.ts` wrapper around the Next development server. It starts an isolated PostgreSQL instance, supplies `DATABASE_URL`, enables the existing Payload development push behavior and cleans up on exit.

`pnpm dev` retains its current meaning: use an externally managed database supplied through environment configuration. Documentation must state that `dev:local` is ephemeral and not suitable for retaining editorial data between restarts.

Successful local startup requires:

- `/healthz` returns HTTP 200.
- `/readyz` returns HTTP 200 with `database: "postgres"` and `status: "ready"`.
- unauthenticated `/admin` returns HTTP 200 and presents the Payload login flow.
- shutdown stops the child server and embedded PostgreSQL cleanly.

## 9. Accessibility and responsive behavior

- Semantic landmarks, headings and link/button elements remain native.
- All controls have programmatic names and visible focus indicators.
- Text/background combinations meet WCAG AA contrast.
- Decorative shapes are excluded from the accessibility tree.
- At 375px, pages have no unintended horizontal overflow and card/axis layouts collapse to one column.
- At 768px and 1440px, compositions use deliberate two-, three- or four-column grids according to content density.
- Content remains usable when JavaScript is unavailable; only copy enhancement may depend on client code.

## 10. Verification and acceptance

The remediation is complete only when all of the following are true:

- Token tests assert the five normative colors, approved border widths, hard shadows and no intermediate card radius.
- Component tests cover complete, partial, stale and unavailable states without generated filler.
- Route tests continue to pass for all locales and four families.
- Browser checks capture Hub, Gallery, Entity and Detail at 375px and 1440px and show no horizontal overflow.
- Screenshots demonstrate the wireframe section hierarchy and the `0008` Bauhaus visual system; the Payload starter black page is absent.
- Keyboard navigation reaches skip link, header controls, search, cards, pagination and actions in reading order.
- `pnpm dev:local` passes the three HTTP checks in Section 8.
- Typecheck, lint, unit/integration tests and production build pass.
- A phase-level independent review has no unresolved valid findings.

## 11. Delivery strategy

Implementation is split into independently verifiable slices: runtime entrypoint, token/foundation layer, shared primitives, family composers, Detail modules, and cross-family browser verification. Shared files use a single writer. Parallel agents may investigate fixtures, test matrices and perform read-only review, but must not edit the same presentation files concurrently.
