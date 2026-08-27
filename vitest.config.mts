import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    // Payload's API integration tests execute in Node. jsdom replaces typed
    // array globals with a separate realm, which violates esbuild invariants.
    environment: 'node',
    // Payload suites share one ephemeral PostgreSQL cluster. File-level
    // concurrency would race schema initialization and test records.
    fileParallelism: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/int/**/*.int.spec.ts'],
  },
})
