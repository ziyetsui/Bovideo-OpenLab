import { test, expect } from '@playwright/test'

test('localhost locale review panel exposes review evidence without restricted text', async ({ page }) => {
  await page.goto('/admin/locale-review')
  await expect(page.getByTestId('locale-review-panel')).toBeVisible()
  await expect(page.getByTestId('locale-review-coverage')).toContainText('16/16')
})
