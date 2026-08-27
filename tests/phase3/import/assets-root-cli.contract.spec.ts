import { describe, expect, it } from 'vitest'

import { parseAssetsRootImportArgs } from '../../../scripts/import-assets-root'

describe('assets-root import CLI', () => {
  it('accepts an explicit assets root and dry run', () => {
    expect(parseAssetsRootImportArgs(['--assets-root', '/private/assets', '--dry-run'], {})).toEqual({
      rootDirectory: '/private/assets', dryRun: true,
    })
  })

  it('reads ASSET_ROOT_DIR and rejects unsupported flags before any write', () => {
    expect(parseAssetsRootImportArgs([], { ASSET_ROOT_DIR: '/private/assets' })).toEqual({
      rootDirectory: '/private/assets', dryRun: false,
    })
    expect(() => parseAssetsRootImportArgs(['--unsafe'], { ASSET_ROOT_DIR: '/private/assets' })).toThrow(/unknown assets-root import argument/i)
  })
})
