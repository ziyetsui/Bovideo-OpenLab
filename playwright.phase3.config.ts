import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3418'

export default defineConfig({
  testDir: './tests/phase3/frontend',
  testMatch: /\.e2e\.spec\.tsx?$/,
  reporter: 'list',
  outputDir: 'test-results/phase3-runtime',
  timeout: 120_000,
  use: { ...devices['Desktop Chrome'], baseURL },
  workers: 1,
  webServer: {
    command: 'cross-env PSEO_FRONTEND_PREVIEW=1 PORT=3418 pnpm exec tsx tests/phase3/frontend/run-preview-server.ts',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    url: `${baseURL}/readyz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
