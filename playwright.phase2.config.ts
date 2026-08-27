import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.P2_BASE_URL ?? 'http://127.0.0.1:3000'
const hostname = new URL(baseURL).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) throw new Error('P2-L Playwright accepts loopback URLs only')

export default defineConfig({
  testDir: './tests/phase2',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  outputDir: 'test-results/phase2',
  use: { ...devices['Desktop Chrome'], baseURL },
  webServer: process.env.P2_BASE_URL ? undefined : { command: 'pnpm exec tsx scripts/phase2/admin-review-server.tsx', url: 'http://127.0.0.1:3000/admin/locale-review', reuseExistingServer: true, timeout: 30_000 },
})
