import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['static-preview/tests/**/*.spec.ts'],
    // 480-route multi-build gates measured 18–23 seconds under review load; keep a local-only safety margin.
    testTimeout: 60_000,
  },
})
