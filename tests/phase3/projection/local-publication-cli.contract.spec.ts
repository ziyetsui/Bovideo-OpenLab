import { describe, expect, it } from 'vitest'

import { nextLocalProjectionPublishVersion, parseLocalProjectionPublishArgs, planLocalPointerActivation } from '../../../scripts/generate-local-pseo-projections'

describe('local projection publication command', () => {
  it('accepts an explicit locale and rejects arbitrary publication arguments', () => {
    expect(parseLocalProjectionPublishArgs(['--locale', 'en'])).toEqual({ locale: 'en' })
    expect(() => parseLocalProjectionPublishArgs(['--locale', 'xx'])).toThrow(/locale/i)
    expect(() => parseLocalProjectionPublishArgs(['--publish-version', '1'])).toThrow(/unknown/i)
  })

  it('does not reuse a version left by an interrupted local projection run', () => {
    expect(nextLocalProjectionPublishVersion({ snapshotVersions: [], workflowKeys: ['local-projection:1:projection-a'] })).toBe(2)
    expect(nextLocalProjectionPublishVersion({ snapshotVersions: [2], workflowKeys: ['local-projection:1:projection-a', 'unrelated'] })).toBe(3)
  })

  it('bootstraps the pointer at the null triple before advancing to a release', () => {
    expect(planLocalPointerActivation(undefined, 3)).toEqual({
      bootstrap: { publish_version: null, previous_verified_version: null, revision: 0 },
      expected: { publish_version: null, previous_verified_version: null, revision: 0 },
      desired: { publish_version: 3, previous_verified_version: null, revision: 1 },
    })
  })
})
