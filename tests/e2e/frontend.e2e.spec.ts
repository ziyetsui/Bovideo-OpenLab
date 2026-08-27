import { test, expect } from '@playwright/test'

test.describe('Frontend', () => {
  test('can go on homepage', async ({ page }) => {
    const response = await page.goto('/')

    expect(response?.headers()['x-robots-tag']).toContain('noindex')
    await expect(page).toHaveTitle(/Bovideo OpenLab/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)

    const heading = page.locator('h1').first()

    await expect(heading).toHaveText('Bovideo OpenLab')
    await expect(page.locator('body')).not.toContainText('vscode://file/')
  })
})
