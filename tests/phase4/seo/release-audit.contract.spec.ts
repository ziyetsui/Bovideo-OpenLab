import { describe, expect, it } from 'vitest'

import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { auditReleasePages } from '@/seo/release-audit'

describe('Phase 4 JSON-LD and internal-link release audit', () => {
  it('passes the complete hub fixture and binds the sitemap inventory to the same graph', () => {
    const hub = { ...P3_GOLDEN_FIXTURES.hub.complete, index_state: 'indexable' as const }
    const audit = auditReleasePages([hub], { rootPageIds: [hub.page_id], sitemapRoutes: [hub.route] })
    expect(audit.status).toBe('PASS')
    expect(audit.structuredDataErrors).toEqual({})
    expect(audit.linkGraph.orphanPageIds).toEqual([])
  })

  it('fails closed for orphan routes and invalid visible JSON-LD', () => {
    const hub = { ...P3_GOLDEN_FIXTURES.hub.complete, index_state: 'indexable' as const, title: 'Visible title' }
    const orphan = { ...P3_GOLDEN_FIXTURES.detail.complete, index_state: 'indexable' as const, route: '/en/prompts/orphan', canonical: 'https://preview.local/en/prompts/orphan', title: 'Orphan title' }
    const audit = auditReleasePages([hub, orphan], { rootPageIds: [hub.page_id], sitemapRoutes: [hub.route, orphan.route] })
    expect(audit.status).toBe('FAIL')
    expect(audit.errors.some((error) => error.startsWith('orphan_page:'))).toBe(true)
  })

  it('fails closed for search-console and analytics inventory gaps too', () => {
    const hub = { ...P3_GOLDEN_FIXTURES.hub.complete, index_state: 'indexable' as const }
    const audit = auditReleasePages([hub], { rootPageIds: [hub.page_id], searchConsoleRoutes: ['/en/missing'], analyticsRoutes: ['/en/missing'] })
    expect(audit.status).toBe('FAIL')
    expect(audit.errors).toEqual(expect.arrayContaining(['search_console_route_gap:/en/missing', 'analytics_route_gap:/en/missing']))
  })
})
