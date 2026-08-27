import { expect, test } from '@playwright/test'

const locales = ['en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN'] as const

test.describe('projection page graph, media, and locale delivery', () => {
  test.setTimeout(30_000)
  test.beforeEach(async ({ page }) => {
    await page.route(/https:\/\/[^/]*twimg\.com\//, async (route) => await route.abort())
  })

  test('clicks through Hub → Gallery → Entity → Detail and renders projected media plus prompt bytes', async ({ page }) => {
    await page.goto('/en/prompts', { waitUntil: 'domcontentloaded' })
    await page.getByRole('link', { name: 'Image prompts', exact: true }).evaluate((link: HTMLAnchorElement) => {
      setTimeout(() => link.click(), 0)
    })
    await page.waitForURL(/\/en\/prompts\/image$/, { waitUntil: 'commit' })

    await page.getByRole('link', { name: 'Example model', exact: true }).evaluate((link: HTMLAnchorElement) => {
      setTimeout(() => link.click(), 0)
    })
    await page.waitForURL(/\/en\/prompts\/models\/example-model$/, { waitUntil: 'commit' })

    await page.getByRole('link', { name: 'Model prompt', exact: true }).evaluate((link: HTMLAnchorElement) => {
      setTimeout(() => link.click(), 0)
    })
    await page.waitForURL(/\/en\/prompts\/cinematic-product-shot-/, { waitUntil: 'commit' })
    await expect(page.locator('[data-slot="detail-media"] img[src*="pbs.twimg.com"]')).toHaveCount(1)
    await expect(page.locator('.prompt-copy')).toContainText('Use the supplied product at dusk.')
  })

  test('serves all advertised locale Hub routes and visibly localizes Chinese chrome', async ({ page }) => {
    for (const locale of locales) {
      const response = await page.goto(`/${locale}/prompts`, { waitUntil: 'domcontentloaded' })
      expect(response?.status(), locale).toBe(200)
      await expect(page.locator('.frontend-locale-root')).toHaveAttribute('lang', locale)
      await expect(page.locator(`.locale-control a[href="/${locale}/prompts"]`)).toHaveAttribute('aria-current', 'page')
    }

    await page.goto('/en/prompts', { waitUntil: 'domcontentloaded' })
    await page.locator('.locale-control a[href="/zh-CN/prompts"]').evaluate((link: HTMLAnchorElement) => {
      setTimeout(() => link.click(), 0)
    })
    await page.waitForURL(/\/zh-CN\/prompts$/, { waitUntil: 'commit' })
    await expect(page.locator('h1')).toContainText('提示词')
    await expect(page.getByRole('heading', { name: '探索' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: '搜索提示词' })).toBeVisible()
    await expect(page.locator('.locale-fallback-notice')).toContainText('界面已翻译')
    await expect(page.locator('.prompt-card__prompt').first()).toHaveText('Use the supplied product at dusk.')

    await page.goto('/zh-CN/prompts/image', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '精选' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '模型' })).toBeVisible()
    await page.goto('/zh-CN/prompts/models/example-model', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '热门提示词' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '常见问题' })).toBeVisible()
    await page.goto('/zh-CN/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /基本信息/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /操作/ })).toBeVisible()
  })
})
