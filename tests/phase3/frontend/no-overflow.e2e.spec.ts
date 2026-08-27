import { expect, test } from '@playwright/test'

const routes = [
  '/en/prompts',
  '/en/prompts/image',
  '/en/prompts/models/example-model',
  '/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001',
] as const

const viewports = [
  { width: 375, height: 900 },
  { width: 768, height: 1000 },
  { width: 1440, height: 1200 },
] as const

test.describe('Phase 3 responsive frontend layout', () => {
  for (const viewport of viewports) {
    for (const route of routes) {
      test(`${route} has no horizontal document overflow at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport)
        const response = await page.goto(route)

        expect(response?.status()).toBe(200)
        expect(await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))).toEqual({ scrollWidth: viewport.width, clientWidth: viewport.width })
      })
    }
  }
})
