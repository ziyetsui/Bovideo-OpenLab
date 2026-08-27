import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3417'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /local-runtime\.e2e\.spec\.ts/,
  reporter: 'list',
  workers: 1,
  use: { ...devices['Desktop Chrome'], baseURL },
  webServer: {
    command: 'cross-env PORT=3417 pnpm dev:local',
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/healthz`,
  },
})
