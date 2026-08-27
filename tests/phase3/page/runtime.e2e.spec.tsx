import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const routes = {
  hub: '/en/prompts',
  gallery: '/en/prompts/image',
  entity: '/en/prompts/models/example-model',
  detail: '/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001',
} as const

const familySections = {
  hub: ['hub-hero', 'hub-axes', 'hub-featured', 'hub-shelves', 'hub-residual', 'hub-method', 'hub-related', 'hub-cta'],
  gallery: ['gallery-hero', 'gallery-axes', 'gallery-featured', 'gallery-models', 'gallery-subject', 'gallery-residual', 'gallery-method', 'gallery-related', 'gallery-pagination'],
  entity: ['entity-hero', 'entity-recent', 'entity-inventory', 'entity-variables', 'entity-creators', 'entity-about', 'entity-self-audit', 'entity-related', 'entity-cta'],
  detail: ['identity', 'outcome', 'prompt', 'inputs', 'parameters', 'examples', 'workflow', 'variations', 'source_signals', 'actions'],
} as const

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

const seriousAxeViolations = (results: Awaited<ReturnType<AxeBuilder['analyze']>>) => results.violations.filter(
  (violation) => violation.impact === 'serious' || violation.impact === 'critical',
)

const tabTo = async (page: Page, selector: string, maximumTabs = 40): Promise<void> => {
  for (let attempt = 0; attempt < maximumTabs; attempt += 1) {
    await page.keyboard.press('Tab')
    if (await page.evaluate((target) => document.activeElement?.matches(target) ?? false, selector)) return
  }
  throw new Error(`Keyboard focus did not reach ${selector} within ${maximumTabs} Tab presses`)
}

const expectVisibleFocus = async (page: Page): Promise<void> => {
  const outline = await page.evaluate(() => {
    if (!(document.activeElement instanceof HTMLElement)) return { style: 'none', width: '0px' }
    const computed = getComputedStyle(document.activeElement)
    return { style: computed.outlineStyle, width: computed.outlineWidth }
  })
  expect(outline.style).not.toBe('none')
  expect(outline.width).not.toBe('0px')
}

test.describe('Phase 3 Bauhaus runtime acceptance', () => {
  for (const viewport of viewports) {
    test(`four canonical families pass visual and accessibility checks at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport)

      for (const family of Object.keys(routes) as (keyof typeof routes)[]) {
        const response = await page.goto(routes[family])
        expect(response?.status(), family).toBe(200)
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex\s*,\s*nofollow\s*,\s*noarchive\s*,\s*nosnippet/)

        const orderedSelectors = family === 'detail'
          ? familySections.detail.map((id) => `#question-${id}`)
          : familySections[family].map((id) => `[data-section="${id}"]`)
        for (const selector of orderedSelectors) await expect(page.locator(selector), `${family}: ${selector}`).toHaveCount(1)
        expect(await page.evaluate((selectors) => {
          const nodes = selectors.map((selector) => document.querySelector(selector))
          return nodes.every((node, index) => node !== null && (index === 0 || Boolean(nodes[index - 1]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)))
        }, orderedSelectors), `${family}/${viewport.name} module order`).toBe(true)

        const computed = await page.locator('body').evaluate((body) => ({
          background: getComputedStyle(body).backgroundColor,
          font: getComputedStyle(body).fontFamily,
          noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        }))
        expect(computed.background).toBe('rgb(240, 240, 240)')
        expect(computed.font).toContain('Outfit Variable')
        expect(computed.noOverflow, `${family}/${viewport.name} overflow`).toBe(true)

        const promptGrid = page.locator('[data-responsive-grid="prompts"]').first()
        if (await promptGrid.count()) {
          const columns = await promptGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
          expect(columns).toBe(viewport.width === 375 ? 1 : viewport.width === 768 ? 2 : 3)
        }

        const results = await new AxeBuilder({ page }).analyze()
        expect(seriousAxeViolations(results), `${family}/${viewport.name}`).toEqual([])
        await page.locator('nextjs-portal').evaluateAll((portals) => portals.forEach((portal) => portal.remove()))
        await expect(page).toHaveScreenshot(`${family}-${viewport.name}.png`, { fullPage: true })
      }
    })
  }

  test('keyboard focus exposes the primary journey', async ({ page }) => {
    await page.goto(routes.hub)
    for (const selector of [
      '.skip-link',
      '.wordmark',
      '.locale-control summary',
      '.breadcrumb a',
      '[data-ui="prompt-card"] a',
    ]) {
      await page.keyboard.press('Tab')
      await expect(page.locator(selector).first()).toBeFocused()
      await expectVisibleFocus(page)
    }
    await expect(page.locator('[data-ui="search-field"] input')).toBeDisabled()

    await page.goto(routes.gallery)
    await tabTo(page, 'a[rel="next"]')
    await expect(page.locator('a[rel="next"]')).toBeFocused()
    await expectVisibleFocus(page)

    await page.goto(routes.detail)
    await tabTo(page, '[data-action="copy-prompt"]', 20)
    await expect(page.locator('[data-action="copy-prompt"]')).toBeFocused()
    await expectVisibleFocus(page)
  })

  test('primary discovery remains server rendered without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    try {
      for (const [family, route] of Object.entries(routes) as [keyof typeof routes, string][]) {
        expect((await page.goto(route))?.status()).toBe(200)
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.locator('[data-locale-switch] a')).toHaveCount(16)
        if (family !== 'detail') await expect(page.locator('[data-ui="prompt-card"] a').first()).toHaveAttribute('href', /^\/[a-z]{2}(?:-[A-Z]{2})?\/prompts\//)
      }
      await page.goto(routes.gallery)
      await expect(page.locator('a[rel="next"]')).toHaveAttribute('href', '/en/prompts/image?page=2')
      await expect(page.locator('[data-ui="search-field"] input')).toBeDisabled()
      await page.goto(routes.detail)
      await expect(page.locator('[data-action="copy-prompt"]')).toContainText('Copy original prompt')
    } finally {
      await context.close()
    }
  })

  test('locale, medium and entity variants retain route behavior', async ({ page }) => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN'] as const) {
      expect((await page.goto(`/${locale}/prompts`))?.status(), `hub/${locale}`).toBe(200)
      await expect(page.locator('h1')).toHaveCount(1)
    }
    for (const route of ['/en/prompts/video', '/en/prompts/use-cases/example-use-case', '/en/prompts/styles/example-style']) {
      expect((await page.goto(route))?.status(), route).toBe(200)
      await expect(page.locator('h1')).toHaveCount(1)
    }
    for (const galleryPath of ['/en/prompts/image', '/en/prompts/video'] as const) {
      await page.goto(`${galleryPath}?page=2`)
      await expect(page.locator('[data-gallery-filter]')).toContainText('page 2 of 2')
      await expect(page.locator('a[rel="next"]')).toHaveCount(0)
      await expect(page.locator('a[rel="prev"]')).toHaveAttribute('href', `${galleryPath}?page=1`)
    }
  })
})
