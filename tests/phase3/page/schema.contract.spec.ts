import { describe, expect, it } from 'vitest'

import { APPLICATION_LOCALES } from '@/contracts/locale'
import { P3_GOLDEN_FIXTURES, P3_GOLDEN_LOCALE_FIXTURES } from '@/page/fixtures'
import { pageEnvelopeSchema, pageFamilySchemas } from '@/page/schema'
import { diffPayloadToPageSchema } from '@/page/payload-diff'
import { INVENTORY_DETAIL_ROUTE_IDS, inventoryPageId } from '@/detail/local-fixture'

describe('P3-T01 page schemas and golden fixtures', () => {
  it('validates complete, partial and stale fixtures for every family', () => {
    for (const [family, fixtures] of Object.entries(P3_GOLDEN_FIXTURES)) {
      for (const [state, page] of Object.entries(fixtures)) {
        expect(pageEnvelopeSchema.safeParse(page), `${family}/${state}`).toMatchObject({ success: true })
        expect(pageFamilySchemas[family as keyof typeof pageFamilySchemas].safeParse(page).success).toBe(true)
      }
    }
  })

  it('covers every family and all 16 application locales without fallback', () => {
    for (const [family, states] of Object.entries(P3_GOLDEN_LOCALE_FIXTURES)) {
      for (const [state, pages] of Object.entries(states)) {
        expect(pages, `${family}/${state}`).toHaveLength(APPLICATION_LOCALES.length)
        expect(pages.map((page) => page.locale)).toEqual([...APPLICATION_LOCALES])
        expect(new Set(pages.map((page) => page.locale)).size).toBe(APPLICATION_LOCALES.length)
        expect(pages.every((page) => page.page_type === family)).toBe(true)
        if (family === 'detail') expect(pages.every((page) => page.page_type !== 'detail' || page.page_id === page.detail.pageId)).toBe(true)
      }
    }
  })

  it('fails closed for filler, fake links, unsupported media and malformed entity qualification', () => {
    const completeHub = P3_GOLDEN_FIXTURES.hub.complete
    expect(pageEnvelopeSchema.safeParse({ ...completeHub, generated_filler_count: 1 }).success).toBe(false)
    expect(pageEnvelopeSchema.safeParse({ ...completeHub, links: [{ ...completeHub.links[0], href: 'javascript:alert(1)' }] }).success).toBe(false)
    expect(pageEnvelopeSchema.safeParse({ ...P3_GOLDEN_FIXTURES.gallery.complete, media_type: 'mixed' }).success).toBe(false)
    const entity = P3_GOLDEN_FIXTURES.entity.complete
    if (entity.page_type !== 'entity') throw new Error('fixture family mismatch')
    expect(pageEnvelopeSchema.safeParse({ ...entity, qualification: { ...entity.qualification, sibling_overlap_ratio: 2 } }).success).toBe(false)
  })

  it('preserves honest unavailable and stale child states', () => {
    expect(P3_GOLDEN_FIXTURES.hub.partial.modules.some((module) => module.state === 'unavailable')).toBe(true)
    const entity = P3_GOLDEN_FIXTURES.entity.stale
    const detail = P3_GOLDEN_FIXTURES.detail.stale
    if (entity.page_type !== 'entity') throw new Error('fixture family mismatch')
    expect(entity.qualification.qualified).toBe(false)
    if (detail.page_type !== 'detail') throw new Error('fixture family mismatch')
    expect(detail.detail.generatedFillerCount).toBe(0)
  })

  it('proves the explicit Payload-to-page projection has no unmapped fields', () => {
    for (const [family, fixtures] of Object.entries(P3_GOLDEN_FIXTURES)) {
      const page = fixtures.complete
      const payload = { ...page, id: page.page_id, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' }
      const diff = diffPayloadToPageSchema(payload, family as keyof typeof pageFamilySchemas, page)
      expect(diff, family).toMatchObject({ ok: true, missing: [], unmapped: [], schemaErrors: [] })
    }
    const page = P3_GOLDEN_FIXTURES.hub.complete
    const drift = diffPayloadToPageSchema({ ...page, unexpected_payload_field: true }, 'hub', page)
    expect(drift.ok).toBe(false)
    expect(drift.unmapped).toEqual(['unexpected_payload_field'])
  })

  it('keeps every crawlable detail route bound to a unique page identity', () => {
    expect(INVENTORY_DETAIL_ROUTE_IDS).toHaveLength(24)
    expect(new Set(INVENTORY_DETAIL_ROUTE_IDS.map((routeId) => inventoryPageId(routeId))).size).toBe(24)
  })
})
