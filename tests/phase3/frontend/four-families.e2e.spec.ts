import { expect, test, type Page } from '@playwright/test'

const families = {
  hub: {
    route: '/en/prompts',
    slots: ['hero', 'search', 'axes', 'results', 'featured', 'footer'],
  },
  gallery: {
    route: '/en/prompts/image',
    slots: ['hero', 'stats', 'search', 'facets', 'use_cases', 'pagination', 'footer'],
  },
  entity: {
    route: '/en/prompts/models/example-model',
    slots: ['hero', 'stats', 'generation_chrome', 'top_prompts', 'qualification', 'footer'],
  },
  detail: {
    route: '/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001',
    slots: ['identity', 'prompt', 'variations', 'actions'],
  },
} as const

const viewports = [
  { name: 'mobile', width: 375, height: 900 },
  { name: 'tablet', width: 768, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
] as const

const remoteEvidenceHost = 'pbs.twimg.com'

const tabTo = async (page: Page, selector: string): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press('Tab')
    if (await page.evaluate((target) => document.activeElement?.matches(target) ?? false, selector)) return
  }
  throw new Error(`Keyboard focus did not reach ${selector}`)
}

test.describe('Phase 3 projection-backed frontend families', () => {
  for (const viewport of viewports) {
    test(`renders Hub, Gallery, Entity, and Detail anchors at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)

      for (const [family, definition] of Object.entries(families) as [keyof typeof families, typeof families[keyof typeof families]][]) {
        const response = await page.goto(definition.route)

        expect(response?.status(), family).toBe(200)
        await expect(page.locator('h1'), `${family}/${viewport.name} owns exactly one page heading`).toHaveCount(1)
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
        await expect(page.locator('header nav[aria-label="Primary"]')).toHaveCount(1)
        await expect(page.locator('footer.frontend-site-footer nav[aria-label="Footer"]')).toHaveCount(1)
        await expect(page.locator('footer.frontend-site-footer a[href="/data-policy"], footer.frontend-site-footer a[href="/legal"]')).toHaveCount(0)

        const display = await page.locator('h1.frontend-display').evaluate((heading) => ({
          fontSize: getComputedStyle(heading).fontSize,
          width: heading.getBoundingClientRect().width,
        }))
        expect(display.fontSize).toBe(viewport.width === 375 ? '36px' : viewport.width === 768 ? '60px' : '96px')
        expect(display.width).toBeLessThanOrEqual(viewport.width === 1440 ? 1280 : viewport.width - 32)

        for (const slot of definition.slots) {
          const locator = family === 'detail' ? page.locator(`#question-${slot}`) : page.locator(`[data-slot="${slot}"]`)
          await expect(locator, `${family}/${viewport.name} exposes ${slot}`).toHaveCount(1)
        }
      }
    })
  }

  for (const viewport of viewports) {
    test(`keeps candidate, media, and keyboard-copy policies at ${viewport.width}px`, async ({ page, context }) => {
      await page.setViewportSize(viewport)
      await page.goto(families.gallery.route)

      const nonCanonicalFilterStates = page.locator('[data-link-policy="filter_state"][data-noindex="true"]')
      await expect(nonCanonicalFilterStates.locator('a')).toHaveCount(0)
      const filters = page.locator('button[data-link-policy="filter_state"][data-noindex="true"]')
      const filterCount = await filters.count()
      expect(filterCount).toBeGreaterThan(0)
      for (let index = 0; index < filterCount; index += 1) {
        await expect(filters.nth(index)).toHaveAttribute('aria-pressed', 'false')
      }
      await filters.first().click()
      await expect(filters.first()).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('[data-testid="gallery-results"]')).toContainText(/\d+ result/)
      expect(page.url()).toBe(new URL(families.gallery.route, 'http://127.0.0.1:3418').href)

      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(families.detail.route)
      expect(await page.content()).not.toContain(remoteEvidenceHost)
      const candidates = page.locator('[data-candidate="true"]')
      await expect(candidates).not.toHaveCount(0)
      await expect(candidates.locator('a')).toHaveCount(0)
      await expect(page.locator(`[data-media-mode="public"], img[src*="${remoteEvidenceHost}"], video[src*="${remoteEvidenceHost}"], a[href*="${remoteEvidenceHost}"]`)).toHaveCount(0)

      await tabTo(page, '[data-action="copy-prompt"]')
      await expect(page.locator('[data-action="copy-prompt"]')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('status').filter({ hasText: 'Prompt copied' })).toBeVisible()
    })
  }
})
