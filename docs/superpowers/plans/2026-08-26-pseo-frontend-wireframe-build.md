# pSEO Wireframe Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four pSEO wireframe page families from reusable TypeScript and CSS modules in `/frontend`, rendered through the existing Next.js routes.

**Architecture:** `/frontend` supplies render-only projection adapters, shared semantic components, page family compositions, and CSS. Existing `src/app/(frontend)` routes retain locale, metadata, and route ownership, passing page/projection data through a thin adapter. Components must never query Payload or create links from candidate graph facts.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.7, CSS custom properties, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-pseo-frontend-wireframe-design.md`

## Global Constraints

- Wireframes govern IA/composition; `0008-bo-pseo-ui.md` supplies Bauhaus visual tokens only.
- New source belongs in `/frontend`; do not create a second app, router, server, or Payload client.
- Renderer accepts render-ready page/projection data only; no route may assemble arbitrary Payload rows or use golden fixtures as production input.
- Candidate nodes/edges render only as dead text or noindex filter state, never public links or Sitemap entries.
- Public media uses approved local media only; X/CDN evidence is preview-only, lazy-loaded, attributed, and `referrerPolicy="no-referrer"`.
- Exactly one H1 per page; Detail preserves byte-exact `original_text` and only substitutes approved variables at copy time.
- Preserve truthful `explicit`, `inferred`, `unavailable`, `candidate`, and `stale` states; no generated filler or visual placeholders.
- Responsive verification covers 375, 768, and 1440 widths with no horizontal document overflow.
- Keep `src/app/(payload)/admin/importMap.js` untouched.

---

## File map

- Create `/frontend/projection/types.ts` and `adapt.ts`: narrow page-family view models and pure adapters.
- Create `/frontend/styles/{tokens,global,families}.css`: Bauhaus foundations and family composition rules.
- Create `/frontend/components/{site-shell,prompt-card,media-block,node-edge,controls,states}.tsx`: shared UI/policy primitives.
- Create `/frontend/pages/{hub-page,gallery-page,entity-page,detail-page}.tsx`: four wireframe compositions.
- Modify `src/page/route-view.tsx`, `src/app/(frontend)/styles.css`, seven prompt routes, and Detail route adapter to render the new components.
- Create `tests/phase3/frontend/{adapters,shared,families}.spec.tsx` plus Playwright family and no-overflow tests.

## Task 1: Establish `/frontend` projection adapters and visual foundations

**Files:**
- Create: `frontend/projection/types.ts`, `frontend/projection/adapt.ts`
- Create: `frontend/styles/tokens.css`, `frontend/styles/global.css`
- Modify: `src/app/(frontend)/styles.css`
- Test: `tests/phase3/frontend/adapters.spec.ts`, `tests/phase3/frontend/tokens.spec.ts`

**Interfaces:**
- Produces `adaptHubPage(page)`, `adaptGalleryPage(page)`, `adaptEntityPage(page)`, and `adaptDetailPage(page)` returning read-only render models.
- Produces `frontendPageModelSchema`; render items preserve the complete projected node/card policy and provenance record. Candidate `href` values remain non-canonical filter facts and are never emitted as anchors by rendering components.

- [ ] **Step 1: Write failing adapter/token tests**

```tsx
it('rejects a candidate page model with an href', () => {
  expect(() => frontendPageModelSchema.parse({ family: 'hub', title: 'Hub', navigation: [], slots: [{ key: 'models', items: [{ state: 'candidate', link_policy: 'link', href: '/en/prompts/models/x' }] }] })).toThrow()
})

it('exposes the Bauhaus token contract', async () => {
  const css = await readFile('frontend/styles/tokens.css', 'utf8')
  for (const color of ['#F0F0F0', '#121212', '#D02020', '#1040C0', '#F0C020']) expect(css).toContain(color)
  expect(css).toContain('--border-major: 4px')
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/frontend/adapters.spec.ts tests/phase3/frontend/tokens.spec.ts`

Expected: module-not-found failures for `/frontend` modules.

- [ ] **Step 3: Implement narrow adapters and CSS foundations**

```ts
export const candidateItemSchema = z.object({
  state: z.literal('candidate'),
  link_policy: z.enum(['filter_state', 'dead_text']),
  href: z.null(),
}).strict()

export const adaptHubPage = (page: HubPage): FrontendHubModel => frontendHubModelSchema.parse({
  family: 'hub', title: page.title, navigation: page.links, slots: [],
})
```

Implement CSS tokens for canvas/ink/three primaries, Outfit fallbacks, only square/full radii, 2px/4px borders, hard shadows, focus ring, reduced-motion override, and responsive display scale.

- [ ] **Step 4: Verify GREEN**

Run the focused tests, then `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend src/app/'(frontend)'/styles.css tests/phase3/frontend
git commit -m "feat: add pSEO frontend foundations"
```

## Task 2: Build shared shell, card, policy and control primitives

**Files:**
- Create: `frontend/components/site-shell.tsx`, `prompt-card.tsx`, `media-block.tsx`, `node-edge.tsx`, `controls.tsx`, `states.tsx`
- Test: `tests/phase3/frontend/shared.spec.tsx`

**Interfaces:**
- Produces `FrontendSiteShell`, `PromptCard`, `MediaBlock`, `NodeEdge`, `CopyPromptButton`, `FacetControl`, and `StatePanel`.
- `MediaBlock({ media, mode })` supports `preview | public`; public never emits a remote X URL.

- [ ] **Step 1: Write failing shared-component tests**

```tsx
it('renders a candidate node as non-link dead text', () => {
  const html = renderToStaticMarkup(<NodeEdge item={{ label: 'Candidate', state: 'candidate', link_policy: 'dead_text', href: null }} />)
  expect(html).toContain('data-link-policy="dead_text"')
  expect(html).not.toContain('href=')
})

it('does not emit remote evidence media in public mode', () => {
  const html = renderToStaticMarkup(<MediaBlock mode="public" media={remoteXEvidence} />)
  expect(html).not.toContain('twimg.com')
  expect(html).toContain('Media unavailable')
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/frontend/shared.spec.tsx`

Expected: imports fail before components exist.

- [ ] **Step 3: Implement semantic primitives**

`FrontendSiteShell` renders skip link, header/nav from model navigation, locale control, breadcrumb, main, and a footer using only projection-qualified navigation (or an unavailable state). `PromptCard` keeps source/metrics/copy/detail anchors and a visible media-empty state. `CopyPromptButton` writes an `aria-live` result. `FacetControl` uses `aria-pressed` and never changes canonical route state.

- [ ] **Step 4: Verify GREEN**

Run focused shared tests and `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/components tests/phase3/frontend/shared.spec.tsx
git commit -m "feat: add pSEO shared frontend components"
```

## Task 3: Implement Hub, Gallery and Entity compositions

**Files:**
- Create: `frontend/pages/hub-page.tsx`, `gallery-page.tsx`, `entity-page.tsx`
- Modify: `frontend/styles/families.css`
- Test: `tests/phase3/frontend/families.spec.tsx`

**Interfaces:**
- Produces `HubPage`, `GalleryPage`, `EntityPage` consuming their corresponding frontend models.
- Each section has a stable `data-slot` matching wireframe IA.

- [ ] **Step 1: Write failing IA-order tests**

```tsx
it('keeps mandatory Hub Camera & Motion between task and model shelves', () => {
  const html = renderToStaticMarkup(<HubPage model={hubModel} />)
  expectInOrder(html, ['data-slot="tasks"', 'data-slot="camera_motion"', 'data-slot="models"', 'data-slot="footer"'])
})

it('renders entity qualification failure as visible noindex state', () => {
  const html = renderToStaticMarkup(<EntityPage model={unqualifiedEntity} />)
  expect(html).toContain('data-qualification="unqualified"')
  expect(html).toContain('Noindex')
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/frontend/families.spec.tsx`

- [ ] **Step 3: Implement three family compositions**

Hub order is hero/search/axes/results/featured/trending/tasks/camera-motion/models/styles/collections/creators/CTA/footer. Gallery uses medium hero/stats/search, noindex facets, featured, model shelves, subject band, residual state, related mesh, CTA/footer. Entity uses factual stats, visual-only generation chrome, prompt grids, variables, creators, evidence/FAQ, qualification audit, related mesh, CTA/footer. CSS implements 375/768/1440 grids and rails without document overflow.

- [ ] **Step 4: Verify GREEN**

Run focused tests, existing Phase 3 presentation contracts, and `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages frontend/styles/families.css tests/phase3/frontend/families.spec.tsx
git commit -m "feat: compose pSEO hub gallery and entity pages"
```

## Task 4: Implement byte-exact Detail composition and integrate Next routes

**Files:**
- Create: `frontend/pages/detail-page.tsx`
- Modify: `src/page/route-view.tsx`, `src/detail/detail-composer.tsx`, seven `src/app/(frontend)/[locale]/prompts/**/page.tsx` routes
- Test: `tests/phase3/frontend/detail.spec.tsx`, `tests/phase3/frontend/route-integration.spec.tsx`

**Interfaces:**
- `DetailPage({ model })` renders the ten-module task sequence and exports both visible and copy targets from the same byte-exact original text.
- Routes resolve active projection where available and pass an adapted model to `/frontend`; withdrawn/absent pages use `notFound()`.

- [ ] **Step 1: Write failing Detail and route tests**

```tsx
it('preserves original prompt bytes as the default copy target', () => {
  const html = renderToStaticMarkup(<DetailPage model={detailWithCountryVariable} />)
  expect(html).toContain('data-original-prompt="Use [COUNTRY] at dusk."')
  expect(html).toContain('data-copy-template="Use [COUNTRY] at dusk."')
})

it('does not leave a fixture import in a projection-backed route', async () => {
  const source = await readFile('src/app/(frontend)/[locale]/prompts/page.tsx', 'utf8')
  expect(source).not.toContain('P3_GOLDEN_LOCALE_FIXTURES')
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/frontend/detail.spec.tsx tests/phase3/frontend/route-integration.spec.tsx`

- [ ] **Step 3: Implement Detail and adapters**

Detail uses Identity, Outcome, Prompt, Inputs, Parameters, Examples, Workflow, Variations, Source+Signals, Actions in order. Candidate variations stay non-linked. Both copy controls substitute only approved variable tokens at interaction time. Route adapters read an active projection first; temporary preview fixtures are permitted only behind explicit development-only adapter injection and are rejected by the route integration test.

- [ ] **Step 4: Verify GREEN**

Run focused Detail/route tests, existing Detail contracts, and `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/detail-page.tsx src/page/route-view.tsx src/detail 'src/app/(frontend)' tests/phase3/frontend
git commit -m "feat: render pSEO routes with frontend projections"
```

## Task 5: Add responsive browser proof and delivery checks

**Files:**
- Create: `tests/phase3/frontend/four-families.e2e.spec.ts`, `tests/phase3/frontend/no-overflow.e2e.spec.ts`
- Modify: `playwright.phase3.config.ts`, `package.json`
- Update: reviewed snapshots under existing Phase 3 convention

**Interfaces:**
- `pnpm run test:phase3:frontend` runs the four-family browser suite through the existing PostgreSQL-backed Next command.

- [ ] **Step 1: Write failing browser acceptance**

```ts
for (const viewport of [{ width: 375, height: 900 }, { width: 768, height: 1000 }, { width: 1440, height: 1200 }]) {
  test(`hub has one H1 and no overflow at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/en/prompts')
    await expect(page.locator('h1')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => window.innerWidth))
  })
}
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec playwright test --config playwright.phase3.config.ts tests/phase3/frontend/four-families.e2e.spec.ts`

Expected: required family selectors/screenshots are absent before implementation.

- [ ] **Step 3: Implement test command and visual proof**

Cover Hub/Gallery/Entity/Detail at all three widths; assert H1, section anchors, keyboard copy feedback, candidate non-links, noindex filters, public media policy, header/footer nav and no overflow. Keep the default frontend command baseline-neutral. Run `pnpm run test:phase3:frontend:visual` for explicit screenshot review; baseline creation or update requires a separate deliberate Playwright `--update-snapshots` action.

- [ ] **Step 4: Verify GREEN**

Run `pnpm run test:phase3:frontend`, `pnpm run test:phase3`, `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run build`, and `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add tests/phase3/frontend playwright.phase3.config.ts package.json
git commit -m "test: verify pSEO wireframe frontend"
```

## Plan self-review

- Wireframe family IA is covered by Tasks 3–4; shared shell/media/candidate policy by Tasks 1–2; visual system by Task 1; route integration by Task 4; all responsive/access/browser verification by Task 5.
- No second app or public X media is introduced.
- Every later interface is defined in an earlier task and every task has RED, GREEN and a commit step.
