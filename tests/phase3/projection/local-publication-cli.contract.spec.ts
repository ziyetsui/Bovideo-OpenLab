import { describe, expect, it } from 'vitest'

import { artifactsFromPayload, nextLocalProjectionPublishVersion, parseLocalProjectionPublishArgs, planLocalPointerActivation } from '../../../scripts/generate-local-pseo-projections'

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

  it('carries only reviewed, populated taxonomy entities into the internal projection input', async () => {
    const artifacts = await artifactsFromPayload({
      async find() {
        return {
          docs: [{
            stable_id: '00000000-0000-4000-8000-000000000101',
            canonical_label: 'Source-backed prompt',
            prompt: { original_text: 'A source-backed prompt.' },
            outcome: { media_type: 'image' },
            source: {
              stable_id: '00000000-0000-4000-8000-000000000201',
              source_version: `sha256:v1:${'a'.repeat(64)}`,
              captured_at: '2026-08-26T00:00:00.000Z',
            },
            model_refs: [{
              stable_id: '00000000-0000-4000-8000-000000000301', node_type: 'model', stable_key: 'model:higgsfield', label: 'Higgsfield', promotion_state: 'reviewed',
            }],
            taxonomy_refs: [
              { stable_id: '00000000-0000-4000-8000-000000000302', node_type: 'style', stable_key: 'style:cinematic', label: 'Cinematic', promotion_state: 'candidate' },
              { stable_id: '00000000-0000-4000-8000-000000000303', node_type: 'subject', stable_key: 'subject:city', label: 'City', promotion_state: 'qualified' },
            ],
          }],
        }
      },
    } as never, 'en')

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.entityRefs).toEqual([
      { id: '00000000-0000-4000-8000-000000000301', kind: 'model', stableKey: 'model:higgsfield', label: 'Higgsfield', promotionState: 'reviewed' },
    ])
  })
})
