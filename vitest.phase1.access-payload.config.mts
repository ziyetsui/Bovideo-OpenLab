import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    fileParallelism: false,
    // These two specs exercise real Local API, REST, and GraphQL requests
    // against disposable PostgreSQL. Their exhaustive access matrices exceed
    // Vitest's unit-test default without indicating a functional failure.
    testTimeout: 30_000,
    include: ['tests/phase1/access/**/*.payload.int.spec.ts'],
  },
})
