import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    fileParallelism: false,
    include: [
      'tests/phase1/contracts/**/*.contract.spec.ts',
      'tests/phase1/migrations/**/*.int.spec.ts',
      'tests/phase1/storage/**/*.contract.spec.ts',
      'tests/phase1/queues/**/*.int.spec.ts',
      'tests/phase1/localization/**/*.contract.spec.ts',
      'tests/phase1/observability/**/*.contract.spec.ts',
      'tests/phase1/acceptance/**/*.spec.ts',
      'tests/phase1/source-adapters/**/*.int.spec.ts',
    ],
  },
})
