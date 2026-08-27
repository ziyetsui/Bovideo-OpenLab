import { describe, expect, it } from 'vitest'

import { parseSnapshotImportArgs } from '../../../scripts/import-higgsfield-snapshot'

describe('snapshot import CLI', () => {
  it('accepts an explicit snapshot and dry run', () => {
    expect(parseSnapshotImportArgs(['--snapshot', '/private/assets/snapshot', '--dry-run'], {})).toEqual({
      snapshotDir: '/private/assets/snapshot',
      dryRun: true,
    })
  })

  it('accepts the standard pnpm argument boundary before import flags', () => {
    expect(parseSnapshotImportArgs(['--', '--snapshot', '/private/assets/snapshot', '--dry-run'], {})).toEqual({
      snapshotDir: '/private/assets/snapshot',
      dryRun: true,
    })
  })

  it('uses ASSET_SNAPSHOT_DIR only when no argument is supplied', () => {
    expect(parseSnapshotImportArgs([], { ASSET_SNAPSHOT_DIR: '/private/assets/snapshot' })).toEqual({
      snapshotDir: '/private/assets/snapshot',
      dryRun: false,
    })
  })

  it('rejects an unknown flag before any import can start', () => {
    expect(() => parseSnapshotImportArgs(['--unsafe'], { ASSET_SNAPSHOT_DIR: '/private/assets/snapshot' })).toThrow(/unknown snapshot import argument/i)
  })
})
