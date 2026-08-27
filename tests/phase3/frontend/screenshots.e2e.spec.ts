import { expect, test } from '@playwright/test'

const visualReviewEnabled = process.env.PSEO_FRONTEND_VISUAL === '1'
const routes = {
  hub: '/en/prompts',
  gallery: '/en/prompts/image',
  entity: '/en/prompts/models/example-model',
  detail: '/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001',
} as const
const viewports = [
  { name: 'mobile', width: 375, height: 900 },
  { name: 'tablet', width: 768, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
] as const

test.describe('explicit reviewed pSEO frontend screenshots', () => {
  test.skip(!visualReviewEnabled, 'Set PSEO_FRONTEND_VISUAL=1 for the explicit screenshot review run.')

  for (const viewport of viewports) {
    for (const [family, route] of Object.entries(routes)) {
      test(`${family} ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto(route)
        await expect(page).toHaveScreenshot(`rebuilt-${family}-${viewport.name}.png`, { fullPage: true })
      })
    }
  }
})
