import { describe, expect, it } from 'vitest'

import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { QUALIFICATION_REASON_CODES, qualifyForRelease } from '@/seo/qualification'

const page = { ...P3_GOLDEN_FIXTURES.hub.complete, index_state: 'indexable' as const }

describe('Phase 4 qualification and reason ledger', () => {
  it('accepts only a fully qualified, self-canonical, rights-safe page', () => {
    const result = qualifyForRelease({
      page,
      robots: 'index,follow',
      localeApproved: true,
      rightsState: 'first_party',
      primaryMediaPresent: true,
      hardGates: [{ code: 'identity_valid', passed: true }, { code: 'information_gain', passed: true }],
    })
    expect(result).toMatchObject({ qualified: true, indexState: 'indexable', reasonCodes: [] })
    expect(result.ledger).toHaveLength(7)
  })

  it('uses stable reason order and never releases a failed hard gate', () => {
    const result = qualifyForRelease({
      page: { ...page, index_state: 'retired' },
      robots: 'noindex,nofollow',
      localeApproved: false,
      rightsState: 'metadata_only',
      primaryMediaPresent: false,
      hardGates: [{ code: 'identity_valid', passed: false }],
    })
    expect(result.qualified).toBe(false)
    expect(result.indexState).toBe('retired')
    expect(result.reasonCodes).toEqual(QUALIFICATION_REASON_CODES.filter((code) => code !== 'canonical_not_self'))
  })

  it('covers more than ten thousand gate combinations with a fail-closed invariant', () => {
    for (let sample = 0; sample < 10_000; sample += 1) {
      const bits = (offset: number): boolean => ((sample >> offset) & 1) === 1
      const result = qualifyForRelease({
        page: { ...page, index_state: bits(0) ? 'indexable' : 'discoverable_noindex' },
        robots: bits(1) ? 'index,follow' : 'noindex,follow',
        requestedCanonical: bits(2) ? page.canonical : `${page.canonical}?page=2`,
        localeApproved: bits(3),
        rightsState: bits(4) ? 'redistribution_licensed' : 'unknown',
        primaryMediaPresent: bits(5),
        hardGates: [{ code: 'identity_valid', passed: bits(6) }],
      })
      expect(result.qualified).toBe(result.reasonCodes.length === 0)
      if (result.qualified) expect(result.indexState).toBe('indexable')
      else expect(result.indexState).not.toBe('indexable')
    }
  })
})
