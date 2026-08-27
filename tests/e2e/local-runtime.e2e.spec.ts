import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'

test('embedded PostgreSQL makes Payload and Admin ready without external requests', async ({ page, request }) => {
  const health = await request.get('/healthz')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })
  expect(health.headers()['cache-control']).toBe('no-store')

  const ready = await request.get('/readyz')
  expect(ready.status()).toBe(200)
  expect(await ready.json()).toEqual({ database: 'postgres', status: 'ready' })
  expect(ready.headers()['cache-control']).toBe('no-store')

  const listeners = execFileSync('lsof', ['-nP', '-iTCP:3417', '-sTCP:LISTEN', '-F', 'n'], { encoding: 'utf8' })
  expect(listeners).toContain('n127.0.0.1:3417')
  expect(listeners).not.toContain('n*:3417')

  await page.context().route('**/*', async (route) => {
    expect(['127.0.0.1', 'localhost']).toContain(new URL(route.request().url()).hostname)
    await route.continue()
  })
  const admin = await page.goto('/admin')
  expect(admin?.status()).toBe(200)
  await expect(page).toHaveURL(/\/admin\/(?:login|create-first-user)/)
  await expect(page.locator('#field-email')).toBeVisible()
  await expect(page.locator('#field-password')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})
