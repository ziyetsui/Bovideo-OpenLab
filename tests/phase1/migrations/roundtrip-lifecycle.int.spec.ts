import { describe, expect, it } from 'vitest'

import { runMigrationRoundtrip } from '../../../scripts/phase1/migration-roundtrip'

describe('P1-T03 child lifecycle', () => {
  it('finishes the no-push source-to-fresh-target drill after migration output', async () => {
    await expect(runMigrationRoundtrip()).resolves.toBeUndefined()
  }, 90_000)
})
