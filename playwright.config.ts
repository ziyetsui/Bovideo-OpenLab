import { defineConfig, devices } from '@playwright/test'
import { config as loadEnvironment } from 'dotenv'

import { resolveE2ETarget } from './tests/helpers/e2eTarget'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
loadEnvironment({ path: '.env.preview.local' })
loadEnvironment()

const staticPreview = process.env.PVB_STATIC_PREVIEW === '1'
const target = staticPreview
  ? { baseURL: 'http://127.0.0.1:4173', startLocalServer: true }
  : resolveE2ETarget(process.env)

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: target.baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: target.startLocalServer
    ? {
        command: staticPreview ? 'pnpm run preview:static:build && pnpm run preview:static:serve' : 'pnpm dev',
        reuseExistingServer: staticPreview ? false : true,
        timeout: 120_000,
        url: staticPreview ? `${target.baseURL}/en/prompts` : `${target.baseURL}/admin/login`,
      }
    : undefined,
})
