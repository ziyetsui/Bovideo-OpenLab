import path from 'node:path'

import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'

import * as initialMigration from '@/migrations/20250929_111647'
import * as phaseZeroMigration from '@/migrations/20260822_083720_pseo_phase0_schema'

import { afterAll, describe, expect, it } from 'vitest'

const platform = await getPlatformProxy<CloudflareEnv>({
  configPath: path.join(process.cwd(), 'wrangler.jsonc'),
  envFiles: [],
  persist: false,
  remoteBindings: false,
})
const db = drizzle(platform.env.D1)
const migrationArgs = { db, payload: undefined, req: undefined } as never

describe('Phase 0 pSEO migration', () => {
  afterAll(async () => {
    await platform.dispose()
  })

  it(
    'migrates forward and rolls its own schema back without partial pSEO tables',
    async () => {
      await initialMigration.up(migrationArgs)
      await phaseZeroMigration.up(migrationArgs)

      const afterUp = await platform.env.D1.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sources'",
      ).all<{ name: string }>()
      expect(afterUp.results).toEqual([{ name: 'sources' }])

      await phaseZeroMigration.down(migrationArgs)

      const afterDown = await platform.env.D1.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sources'",
      ).all<{ name: string }>()
      expect(afterDown.results).toEqual([])
    },
    15_000,
  )
})
