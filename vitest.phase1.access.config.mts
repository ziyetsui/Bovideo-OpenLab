import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    fileParallelism: false,
    exclude: ['tests/phase1/access/**/*.payload.int.spec.ts'],
    include: ['tests/phase1/access/**/*.int.spec.ts'],
  },
})
