# pSEO Bauhaus UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Hub, Gallery, Entity and Detail as responsive Bauhaus pages whose composition follows the wireframes while all content remains sourced from the existing page contracts.

**Architecture:** Preserve `PageEnvelope`, detail schemas, fixtures, route projection and noindex behavior. Add a server-rendered presentation layer of pure adapters, shared primitives and family composers; use a single CSS token owner and one minimal client island for copying the original prompt.

**Tech Stack:** Next.js 16.3.0, React 19.2.6, TypeScript 5.7.3, CSS custom properties, `@fontsource-variable/outfit` 5.3.0, Vitest 4, React DOM server rendering, Playwright 1.58, Axe.

**Spec:** `.gba/0003_bo-pseo-platform/specs/phase3-ui-runtime-remediation-design.md`

## Global Constraints

- Data/safety contracts outrank wireframe IA; wireframe IA outranks visual styling; `0008-bo-pseo-ui.md` owns the visual language.
- Do not modify `src/page/schema.ts`, `src/detail/schema.ts`, `src/page/fixtures.ts` or `src/detail/local-fixture.ts`.
- Do not invent taxonomy counts, creators, variables, FAQs, media or prompt facts; show a designed unavailable state.
- Preserve the exported signatures of `PageShell`, `PageRouteView` and `DetailPageView`.
- Preserve one H1, JSON-LD, noindex metadata, locale links, skip link, `data-provenance`, `data-module-state`, gallery `rel` links and `data-page-action`.
- Detail keeps the exact ten-question tuple order and byte-exact original prompt.
- Canvas `#F0F0F0`, ink `#121212`, red `#D02020`, blue `#1040C0`, yellow `#F0C020` are normative.
- Surfaces use only square (`0`) or full-circle/pill (`9999px`) corners, `2px`/`4px` ink borders and unblurred `4px`/`6px`/`8px` hard shadows.
- Primary content, locale navigation and pagination remain server-rendered without JavaScript.

---

## File map

- Rewrite `src/app/(frontend)/styles.css`: sole token/global/responsive style owner.
- Modify `src/app/(frontend)/layout.tsx`: import the pinned local Outfit variable font.
- Create `src/page/presentation/model.ts`: pure `PageEnvelope` presentation adapters.
- Create `src/page/presentation/primitives.tsx`: shared poster, card, axis, status, related and CTA primitives.
- Create `src/page/presentation/shared-shell.tsx`: brand, locale control and preview strip.
- Modify `src/page/shell.tsx`: preserve semantics/API while composing the shared shell.
- Create `src/page/presentation/hub.tsx`, `gallery.tsx`, `entity.tsx`: family composers.
- Refactor `src/page/route-view.tsx`: discriminated dispatch only.
- Create `src/detail/copy-prompt-button.tsx`: client-only clipboard enhancement.
- Create `src/detail/detail-composer.tsx`: typed ten-module React composition.
- Modify `src/detail/render.tsx`: delegate React rendering while preserving raw HTML exports.
- Simplify the seven `src/app/(frontend)/[locale]/prompts/**/page.tsx` routes by removing disposable intro paragraphs only.
- Add focused tests under `tests/phase3/ui/`; extend Detail, shell and browser tests.
- Modify `playwright.phase3.config.ts`: use `dev:local` from the runtime plan on an isolated port.

### Task 1: Lock the Bauhaus token foundation

**Files:**

- Create: `tests/phase3/ui/tokens.contract.spec.ts`
- Modify: `src/app/(frontend)/layout.tsx`
- Rewrite: `src/app/(frontend)/styles.css`

**Interfaces:**

- Produces CSS custom properties `--color-canvas`, `--color-ink`, `--color-red`, `--color-blue`, `--color-yellow`, `--border-thin`, `--border-heavy`, `--shadow-4`, `--shadow-6`, `--shadow-8`, `--radius-square`, `--radius-round`.

- [ ] **Step 1: Write the failing token contract**

```ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Bauhaus presentation tokens', () => {
  it('pins the approved colors, geometry and local Outfit font', async () => {
    const [css, layout] = await Promise.all([
      readFile('src/app/(frontend)/styles.css', 'utf8'),
      readFile('src/app/(frontend)/layout.tsx', 'utf8'),
    ])
    for (const value of ['#F0F0F0', '#121212', '#D02020', '#1040C0', '#F0C020']) expect(css).toContain(value)
    for (const token of ['--border-thin: 2px', '--border-heavy: 4px', '--shadow-4: 4px 4px 0', '--shadow-6: 6px 6px 0', '--shadow-8: 8px 8px 0', '--radius-square: 0', '--radius-round: 9999px']) expect(css).toContain(token)
    expect(layout).toContain("@fontsource-variable/outfit/wght.css")
    expect(css).toContain('prefers-reduced-motion: reduce')
    const radii = [...css.matchAll(/border-radius:\s*([^;]+)/g)].map((match) => match[1]!.trim())
    expect(radii.every((value) => ['0', '9999px', 'var(--radius-square)', 'var(--radius-round)'].includes(value))).toBe(true)
    expect(css).not.toContain('linear-gradient')
  })
})
```

- [ ] **Step 2: Verify the current starter stylesheet fails**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/ui/tokens.contract.spec.ts
```

Expected: failure on the first missing normative token.

- [ ] **Step 3: Import the pinned local variable font**

Add before `./styles.css` in the frontend layout:

```ts
import '@fontsource-variable/outfit/wght.css'
import './styles.css'
```

- [ ] **Step 4: Replace starter CSS with the token and base layer**

Define the exact token surface and base behavior:

```css
:root {
  --color-canvas: #F0F0F0;
  --color-ink: #121212;
  --color-red: #D02020;
  --color-blue: #1040C0;
  --color-yellow: #F0C020;
  --color-surface: #FFFFFF;
  --color-focus: var(--color-blue);
  --border-thin: 2px;
  --border-heavy: 4px;
  --shadow-4: 4px 4px 0 var(--color-ink);
  --shadow-6: 6px 6px 0 var(--color-ink);
  --shadow-8: 8px 8px 0 var(--color-ink);
  --radius-square: 0;
  --radius-round: 9999px;
}

html { background: var(--color-canvas); color: var(--color-ink); }
body { margin: 0; font-family: 'Outfit Variable', Outfit, system-ui, sans-serif; }
:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; } }
```

Add the responsive layout classes required by later primitives without page-family content rules.

- [ ] **Step 5: Run the focused checks and commit**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/ui/tokens.contract.spec.ts
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
git add 'src/app/(frontend)/layout.tsx' 'src/app/(frontend)/styles.css' tests/phase3/ui/tokens.contract.spec.ts
git commit -m "feat: establish Bauhaus UI tokens"
```

### Task 2: Build the shared shell and primitives

**Files:**

- Create: `src/page/presentation/model.ts`
- Create: `src/page/presentation/primitives.tsx`
- Create: `src/page/presentation/shared-shell.tsx`
- Modify: `src/page/shell.tsx`
- Modify: `tests/phase3/page/shell.contract.spec.tsx`

**Interfaces:**

- `itemLinks(page: PageEnvelope): PageEnvelope['links']`
- `relatedLinks(page: PageEnvelope): PageEnvelope['links']`
- `EvidenceTone = 'available' | 'unavailable' | 'stale' | 'candidate'`
- `PromptCard({ link, ordinal }: { link: PageEnvelope['links'][number]; ordinal: number })`
- `PageShell({ page, children }: { page: PageEnvelope; children: ReactNode })`

- [ ] **Step 1: Extend the shell contract with stable UI hooks**

Add assertions after server-rendering `PageShell`:

```ts
expect(html).toContain('data-ui="site-header"')
expect(html).toContain('data-ui="brand-mark"')
expect(html).toContain('aria-hidden="true"')
expect(html).toContain('data-ui="preview-strip"')
expect(html).toContain('data-ui="locale-control"')
expect((html.match(/<h1\b/g) ?? []).length).toBe(1)
expect(APPLICATION_LOCALES.every((locale) => html.includes(`lang="${locale}"`))).toBe(true)
```

- [ ] **Step 2: Run the shell test and verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/page/shell.contract.spec.tsx
```

Expected: missing `data-ui` hooks.

- [ ] **Step 3: Implement pure presentation adapters**

```ts
import type { PageEnvelope } from '@/page/schema'

export type PageLink = PageEnvelope['links'][number]
export type EvidenceTone = 'available' | 'unavailable' | 'stale' | 'candidate'
export const itemLinks = (page: PageEnvelope): PageLink[] => page.links.filter((link) => link.relation === 'item' && link.indexable)
export const relatedLinks = (page: PageEnvelope): PageLink[] => page.links.filter((link) => link.relation === 'related' || link.relation === 'facet')
export const evidenceTone = (state: PageEnvelope['modules'][number]['state']): EvidenceTone => state === 'available' ? 'available' : state
```

- [ ] **Step 4: Implement the reusable server primitives**

Export `BrandMark`, `SectionHeading`, `PosterHero`, `StatBlock`, `SearchActionField`, `AxisRail`, `PromptCard`, `EvidenceBadge`, `UnavailablePanel`, `MethodNote`, `RelatedLinkBand` and `FinalCta`. Every primitive must expose its semantic hook, for example:

```tsx
export const PromptCard = ({ link, ordinal }: Readonly<{ link: PageLink; ordinal: number }>) => (
  <article className="prompt-card" data-ui="prompt-card">
    <p className="prompt-card__ordinal" aria-hidden="true">{String(ordinal).padStart(2, '0')}</p>
    <h3><a href={link.href}>{link.label}</a></h3>
    <p className="status-chip">Approved evidence route</p>
  </article>
)

export const UnavailablePanel = ({ title, reason }: Readonly<{ title: string; reason: string }>) => (
  <section className="state-panel" data-ui="state-panel" data-module-state="unavailable">
    <h3>{title}</h3><p role="status">{reason}</p>
  </section>
)
```

- [ ] **Step 5: Compose the shared header without changing the public shell API**

Implement `SiteHeader`, `LocaleControl` and `PreviewStatusStrip`; keep all sixteen native links. Refactor `PageShell` so it still owns JSON-LD, the skip link, one H1 and `<main id="page-content">`, while using those components.

- [ ] **Step 6: Pass existing and new shell tests, then commit**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/page/shell.contract.spec.tsx tests/phase3/page/quality.contract.spec.tsx
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
git add src/page/presentation src/page/shell.tsx tests/phase3/page/shell.contract.spec.tsx
git commit -m "feat: compose the shared pSEO shell"
```

### Task 3: Implement the Hub composer

**Files:**

- Create: `tests/phase3/ui/hub.contract.spec.tsx`
- Create: `src/page/presentation/hub.tsx`
- Modify: `src/page/route-view.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/page.tsx`

**Interfaces:**

- `HubComposer({ page }: { page: HubPage }): ReactNode`
- `PageRouteView({ page, children? })` retains its existing signature; `children` becomes optional legacy intro content, not the composition owner.

- [ ] **Step 1: Write complete/partial/stale Hub contracts**

```tsx
const html = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.hub.complete} />)
const order = ['hub-hero', 'hub-axes', 'hub-featured', 'hub-shelves', 'hub-residual', 'hub-method', 'hub-related', 'hub-cta']
const positions = order.map((id) => html.indexOf(`data-section="${id}"`))
expect(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]!))).toBe(true)
expect(html).toContain('24 qualified inventory items')
expect((html.match(/data-ui="prompt-card"/g) ?? []).length).toBe(24)
expect(html).toContain('data-generated-filler-count="0"')

const partial = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.hub.partial} />)
expect(partial).toContain('data-module-state="unavailable"')
expect(partial).not.toContain('href="undefined"')
```

- [ ] **Step 2: Verify the contract fails on the paragraph/list implementation**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/ui/hub.contract.spec.tsx
```

- [ ] **Step 3: Implement the ordered Hub sections**

Create `HubComposer` with the exact eight `data-section` values above. Render real item links through `PromptCard`; render output/model/use-case/style/technique/creator shelves as `UnavailablePanel` when no matching evidence exists. Preserve `data-hub-search`, `data-inventory-count`, `data-featured-modules`, `data-browse-shelves` and `data-snapshot-date` hooks.

- [ ] **Step 4: Dispatch Hub and remove its disposable route paragraph**

In `PageRouteView`, dispatch `page.page_type === 'hub'` to `<HubComposer page={page} />`. Change the Hub route to `<PageRouteView page={page!} />`; keep all route lookup, metadata and static params unchanged.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/ui/hub.contract.spec.tsx tests/phase3/page/projections.contract.spec.ts
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
git add src/page/presentation/hub.tsx src/page/route-view.tsx 'src/app/(frontend)/[locale]/prompts/page.tsx' tests/phase3/ui/hub.contract.spec.tsx
git commit -m "feat: rebuild the pSEO Hub composition"
```

### Task 4: Implement the Gallery composer

**Files:**

- Create: `tests/phase3/ui/gallery.contract.spec.tsx`
- Create: `src/page/presentation/gallery.tsx`
- Modify: `src/page/route-view.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/image/page.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/video/page.tsx`

**Interfaces:**

- `GalleryComposer({ page }: { page: GalleryPage }): ReactNode`
- Pagination continues to expose native anchors with `rel="previous"`/`rel="next"` values already used by the route contract (`rel="prev"` is retained for existing tests).

- [ ] **Step 1: Write Gallery composition and pagination tests**

Assert ordered `gallery-hero`, `gallery-axes`, `gallery-featured`, `gallery-models`, `gallery-subject`, `gallery-residual`, `gallery-method`, `gallery-related`, `gallery-pagination`; exact `image`/`video` labels; item count equals `page.links` item slice; and page 1/page 2 `rel` anchors remain exact.

```tsx
expect(html).toContain('data-gallery-filter')
expect(html).toContain('Showing image results · page 1 of 2')
expect(html).toContain('rel="next" href="/en/prompts/image?page=2"')
expect(html).not.toContain('href="undefined"')
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/ui/gallery.contract.spec.tsx
```

- [ ] **Step 3: Implement Gallery sections from existing fields only**

Use `page.media_type`, `page.total_items`, `page.page`, `page.page_size`, `page.filter_state`, item links and pagination. Unsupported taxonomy/model/subject sections render designed unavailable states. Preserve `data-browse-axes`, `data-gallery-filter` and `data-residual-inventory`.

- [ ] **Step 4: Dispatch Gallery and simplify both medium routes**

Add Gallery dispatch to `PageRouteView`; change Image and Video route returns to `<PageRouteView page={page!} />`. Do not change `projectGalleryPage`, pagination validation or item slicing.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/ui/gallery.contract.spec.tsx tests/phase3/page/projections.contract.spec.ts
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
git add src/page/presentation/gallery.tsx src/page/route-view.tsx 'src/app/(frontend)/[locale]/prompts/image/page.tsx' 'src/app/(frontend)/[locale]/prompts/video/page.tsx' tests/phase3/ui/gallery.contract.spec.tsx
git commit -m "feat: rebuild pSEO Gallery composition"
```

### Task 5: Implement the Entity composer

**Files:**

- Create: `tests/phase3/ui/entity.contract.spec.tsx`
- Create: `src/page/presentation/entity.tsx`
- Modify: `src/page/route-view.tsx`
- Modify: the model, use-case and style entity route files under `src/app/(frontend)/[locale]/prompts/`

**Interfaces:**

- `EntityComposer({ page }: { page: EntityPage }): ReactNode`
- `projectEntityPage` remains the sole qualification authority.

- [ ] **Step 1: Write qualified and rejected Entity contracts**

```tsx
const qualified = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.entity.complete} />)
expect(qualified).toContain('data-entity-qualification')
expect(qualified).toContain('Qualified entity')
expect(qualified).toContain('data-section="entity-self-audit"')
expect(qualified).toContain('all_gates_passed')

const rejected = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.entity.partial} />)
expect(rejected).toContain('Entity not qualified for publication')
expect(rejected).toContain('insufficient_usable_items')
expect(rejected).toContain('data-module-state="unavailable"')
```

Also assert the ordered hero, recent, inventory, variables, creators, about, self-audit, related and CTA sections.

- [ ] **Step 2: Verify the test fails**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/ui/entity.contract.spec.tsx
```

- [ ] **Step 3: Implement Entity composition**

Render the disabled generation-shaped field with a visible reason, real inventory links, qualification counts/reason codes and evidence modules. Variables, creator identities and FAQs must be unavailable panels unless the envelope supplies evidence; never infer names from route slugs.

- [ ] **Step 4: Dispatch Entity and simplify all three entity routes**

Retain each route's `entity_kind`, `entity_slug`, lookup and metadata logic; remove only the disposable child paragraph.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/ui/entity.contract.spec.tsx tests/phase3/page/projections.contract.spec.ts
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
git add src/page/presentation/entity.tsx src/page/route-view.tsx 'src/app/(frontend)/[locale]/prompts/models/[entitySlug]/page.tsx' 'src/app/(frontend)/[locale]/prompts/use-cases/[entitySlug]/page.tsx' 'src/app/(frontend)/[locale]/prompts/styles/[entitySlug]/page.tsx' tests/phase3/ui/entity.contract.spec.tsx
git commit -m "feat: rebuild pSEO Entity composition"
```

### Task 6: Implement the ten-module Detail composer

**Files:**

- Create: `src/detail/copy-prompt-button.tsx`
- Create: `src/detail/detail-composer.tsx`
- Modify: `src/detail/render.tsx`
- Modify: `tests/phase3/detail/production.contract.spec.tsx`

**Interfaces:**

- `CopyPromptButton({ text }: { text: string }): ReactNode`
- `DetailComposer({ page, includeHeading? }: { page: DetailPageData; includeHeading?: boolean }): ReactNode`
- Existing `renderDetailHtml`, `renderDetailDocument` and `DetailPageView` exports remain source-compatible.

- [ ] **Step 1: Strengthen the Detail production contract**

Add an order helper and assertions:

```ts
const positions = DETAIL_QUESTION_ORDER.map((id) => html.indexOf(`id="question-${id}"`))
expect(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]!))).toBe(true)
expect(html).toContain(page.questions.find((question) => question.id === 'prompt')!.content.originalText)
expect(html).toContain('data-ui="detail-module"')
expect(html).toContain('data-action="copy-prompt"')
expect(html).not.toContain('data-action="run-prompt"')
```

Render partial/stale fixtures and assert visible unavailable/candidate status and unchanged `generatedFillerCount=0`.

- [ ] **Step 2: Verify the new visual contract fails**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/detail/production.contract.spec.tsx
```

- [ ] **Step 3: Add the clipboard client island**

```tsx
'use client'

import { useState } from 'react'

export const CopyPromptButton = ({ text }: Readonly<{ text: string }>) => {
  const [status, setStatus] = useState('Copy original prompt')
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setStatus('Copied original prompt')
  }
  return <button type="button" data-action="copy-prompt" onClick={copy}>{status}</button>
}
```

- [ ] **Step 4: Implement Detail modules with the typed union**

Move only the React view into `detail-composer.tsx`. Iterate `page.questions` in tuple order, preserve IDs and state/provenance attributes, and switch exhaustively on `question.id`. Use `CopyPromptButton` only for the prompt question. Unavailable and stale questions render a `role="status"` panel before any content.

- [ ] **Step 5: Delegate `DetailPageView` and preserve the raw renderer**

Keep raw HTML escaping and Phase 2 document behavior in `render.tsx`; replace its React-only implementation with `<DetailComposer page={page} includeHeading={...} />` inside the existing `PageShell` boundary.

- [ ] **Step 6: Verify Phase 2 and Phase 3 Detail behavior, then commit**

```bash
pnpm exec vitest run --config vitest.phase2.config.mts tests/phase2/detail/render.int.spec.ts tests/phase2/detail/schema.contract.spec.ts
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/detail/production.contract.spec.tsx
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
git add src/detail/copy-prompt-button.tsx src/detail/detail-composer.tsx src/detail/render.tsx tests/phase3/detail/production.contract.spec.tsx
git commit -m "feat: compose the ten-module Detail page"
```

### Task 7: Add cross-family responsive, accessibility and visual acceptance

**Files:**

- Modify: `tests/phase3/page/runtime.e2e.spec.tsx`
- Modify: `playwright.phase3.config.ts`
- Update: `tests/phase3/page/runtime.e2e.spec.tsx-snapshots/*.png`
- Modify: `package.json` only if the runtime-plan writer has not already added `test:phase3:visual`.

**Interfaces:**

- Consumes: `pnpm dev:local` from the runtime plan.
- Produces: twelve approved canonical screenshots: four families at 375px, 768px and 1440px.

- [ ] **Step 1: Point Phase 3 Playwright at an isolated embedded runtime**

Use base URL `http://127.0.0.1:3418` and:

```ts
webServer: {
  command: 'cross-env HOSTNAME=127.0.0.1 PORT=3418 pnpm dev:local',
  url: 'http://127.0.0.1:3418/readyz',
  reuseExistingServer: false,
  timeout: 120_000,
}
```

- [ ] **Step 2: Define canonical routes and three normative viewports**

```ts
const canonicalRoutes = {
  hub: '/en/prompts',
  gallery: '/en/prompts/image',
  entity: '/en/prompts/models/example-model',
  detail: '/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001',
} as const
const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const
```

- [ ] **Step 3: Add deterministic browser assertions**

For every route and viewport, assert HTTP 200, one H1, noindex, no overflow, zero serious/critical Axe violations, computed canvas color `rgb(240, 240, 240)`, Outfit in `font-family`, and stable family section order. Assert grid columns are one at 375px, at least two at 768px and at least three where marked `data-responsive-grid="prompts"` at 1440px.

- [ ] **Step 4: Add keyboard and no-JavaScript journeys**

Verify focus order begins at `.skip-link`, reaches locale/search/card/pagination/copy controls, and every focused control has a non-zero outline width. Create a context with `javaScriptEnabled: false`; verify H1, native locale links, item links and gallery pagination still exist.

- [ ] **Step 5: Run browser tests before accepting baselines**

```bash
pnpm exec playwright test --config playwright.phase3.config.ts
```

Expected: deterministic assertions pass; screenshot comparisons fail because the previous black starter baselines are obsolete.

- [ ] **Step 6: Regenerate and visually inspect all twelve screenshots**

```bash
pnpm exec playwright test --config playwright.phase3.config.ts --update-snapshots
pnpm exec playwright test --config playwright.phase3.config.ts
```

Inspect every PNG for wireframe hierarchy, Bauhaus token use, legible unavailable states, no clipping and no black starter page before staging them.

- [ ] **Step 7: Run the complete Phase 3 and production gates**

```bash
pnpm run test:phase3
pnpm run test:local-runtime
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 8: Commit the browser acceptance and handoff evidence**

```bash
git add playwright.phase3.config.ts package.json tests/phase3/page/runtime.e2e.spec.tsx tests/phase3/page/runtime.e2e.spec.tsx-snapshots
git commit -m "test: approve responsive pSEO UI baselines"
```

### Task 8: Phase-level review and handoff

**Files:**

- Create: `.gba/0003_bo-pseo-platform/docs/phase3-ui-runtime-remediation-handoff.md`

**Interfaces:**

- Produces: phase evidence listing commits, changed surfaces, exact commands/results, screenshot set, review findings and open risks.

- [ ] **Step 1: Run the final clean-worktree verification set**

```bash
pnpm run test:phase3
pnpm run test:local-runtime
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
git diff --check
```

- [ ] **Step 2: Perform one independent phase review**

The reviewer reads the approved design and both implementation plans, inspects the diff, runs the focused contract/browser/runtime tests, and reports findings by severity. Fix every valid in-scope finding and rerun the affected checks.

- [ ] **Step 3: Record exact evidence**

The handoff document must contain:

```markdown
## Scope delivered
## Commits and files changed
## Verification commands and observed results
## Browser baselines: four families × 375/768/1440
## Runtime proof: healthz, readyz, Admin, shutdown
## Independent review findings and resolutions
## Remaining open items
```

Use `None` under remaining open items only when verification and review found none; do not leave an unresolved marker.

- [ ] **Step 4: Validate and commit the handoff**

```bash
git diff --check
git add .gba/0003_bo-pseo-platform/docs/phase3-ui-runtime-remediation-handoff.md
git commit -m "docs: hand off pSEO UI remediation"
git status --short
```

Expected: final status is clean.
