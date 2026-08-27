import { test, expect } from '@playwright/test'

import { renderDetailDocument } from '@/detail/render'
import { completeDetailFixture } from '../fixtures/detail/complete'

test('loopback detail document remains noindex and accessible in a browser context', async ({ page }) => {
  const detail = completeDetailFixture.pages.find((item) => item.locale === 'en')!
  const response = renderDetailDocument(detail)
  await page.setContent(response.html)
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow,noarchive,nosnippet')
  await expect(page.locator('[data-provenance="unavailable"]')).toHaveCount(0)
  expect(new URL('http://127.0.0.1:3000/en/prompts/demo-00000000-0000-4000-8000-000000000001').hostname).toBe('127.0.0.1')
})
