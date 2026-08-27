import { describe, expect, it } from 'vitest'

import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { projectEntityPage, projectGalleryPage, projectHubPage, qualifyEntity, selectFeaturedCandidates } from '@/page/projections'
import type { EntityPage, GalleryPage, HubPage } from '@/page/schema'
import { pageEnvelopeSchema } from '@/page/schema'

describe('P3-T03/T04/T05 page projections', () => {
  it('selects qualified featured items deterministically with creator diversity', () => {
    const candidates = [
      { id: '00000000-0000-4000-8000-000000000102', qualified: true, creatorId: 'creator-b', sourceId: 'source-b', score: 9 },
      { id: '00000000-0000-4000-8000-000000000101', qualified: true, creatorId: 'creator-a', sourceId: 'source-a', score: 9 },
      { id: '00000000-0000-4000-8000-000000000103', qualified: true, creatorId: 'creator-a', sourceId: 'source-c', score: 8 },
      { id: '00000000-0000-4000-8000-000000000199', qualified: false, creatorId: 'creator-x', sourceId: 'source-x', score: 99 },
    ]
    expect(selectFeaturedCandidates(candidates)).toEqual(['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103'])
    const projected = projectHubPage(P3_GOLDEN_FIXTURES.hub.complete as HubPage, candidates)
    expect(projected.inventory_count).toBe(3)
    expect(projected.links.filter((link) => link.relation === 'item').map((link) => link.label)).toEqual(['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103'])
    expect(pageEnvelopeSchema.safeParse(projected).success).toBe(true)
  })

  it('rejects mixed or unresolved Gallery routes and exposes finite crawlable pagination', () => {
    expect(() => projectGalleryPage(P3_GOLDEN_FIXTURES.gallery.complete as GalleryPage, { mediaType: 'mixed', page: 1, pageSize: 24, totalItems: 48, filterState: {} })).toThrow(/media type/i)
    const projected = projectGalleryPage(P3_GOLDEN_FIXTURES.gallery.complete as GalleryPage, { mediaType: 'image', page: 2, pageSize: 24, totalItems: 48, filterState: { subject: 'product' } })
    expect(projected.next_page).toBeNull()
    expect(projected.previous_page).toContain('page=1')
    expect(projected.filter_state).toEqual({ subject: 'product' })
    expect(pageEnvelopeSchema.safeParse(projected).success).toBe(true)
  })

  it('records every Entity gate failure and never qualifies an under-threshold page', () => {
    const failed = qualifyEntity({ usableItems: 3, independentCreators: 1, siblingOverlapRatio: 0.9, demandEvidence: false, uniqueLocalizedBody: false, keywordOwner: null, identityValid: false, informationGain: false, rightsDelivery: false })
    expect(failed.qualified).toBe(false)
    expect(failed.reasonCodes).toEqual(['insufficient_usable_items', 'insufficient_independent_creators', 'sibling_overlap_too_high', 'missing_demand_evidence', 'missing_unique_localized_body', 'missing_keyword_owner', 'invalid_identity', 'insufficient_information_gain', 'rights_delivery_not_ready'])
    const projected = projectEntityPage(P3_GOLDEN_FIXTURES.entity.complete as EntityPage, { usableItems: 3, independentCreators: 1, siblingOverlapRatio: 0.9, demandEvidence: false, uniqueLocalizedBody: false, keywordOwner: null, identityValid: false, informationGain: false, rightsDelivery: false })
    expect(projected.index_state).toBe('not_generated')
    expect(projected.qualification.reason_codes).toEqual(failed.reasonCodes)
    expect(pageEnvelopeSchema.safeParse(projected).success).toBe(true)
  })

  it('qualifies only when all ten gates pass across a deterministic 10,000-case matrix', () => {
    const valid = { usableItems: 10, independentCreators: 2, siblingOverlapRatio: 0.59, demandEvidence: true, uniqueLocalizedBody: true, keywordOwner: 'prompt', identityValid: true, informationGain: true, rightsDelivery: true }
    expect(qualifyEntity(valid).qualified).toBe(true)
    for (let sample = 0; sample < 10_000; sample += 1) {
      const candidate = {
        ...valid,
        usableItems: sample % 11,
        independentCreators: sample % 3,
        siblingOverlapRatio: (sample % 101) / 100,
        demandEvidence: sample % 2 === 0,
        uniqueLocalizedBody: sample % 3 !== 0,
        keywordOwner: sample % 5 === 0 ? 'prompt' : null,
        identityValid: sample % 7 !== 0,
        informationGain: sample % 11 !== 0,
        rightsDelivery: sample % 13 !== 0,
      }
    const result = qualifyEntity(candidate)
    const allGatesPass = candidate.usableItems >= 10 && candidate.independentCreators >= 2 && candidate.siblingOverlapRatio < 0.6 && candidate.demandEvidence && candidate.uniqueLocalizedBody && candidate.keywordOwner !== null && candidate.identityValid && candidate.informationGain && candidate.rightsDelivery
    expect(result.qualified).toBe(allGatesPass)
    const projected = projectEntityPage(P3_GOLDEN_FIXTURES.entity.complete as EntityPage, candidate)
    expect(projected.index_state).toBe(allGatesPass ? 'discoverable_noindex' : 'not_generated')
    expect(projected.qualification.qualified).toBe(allGatesPass)
  }
})
})
