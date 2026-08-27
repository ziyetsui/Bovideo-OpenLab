import { describe, expect, it } from 'vitest'

import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { buildInternalLinkGraph, buildStructuredData, validateStructuredData } from '@/page/structured-data'

describe('P3-T08 structured data and internal-link graph', () => {
  it('emits visible-content-matched CollectionPage/ItemList/BreadcrumbList data', () => {
    const page = P3_GOLDEN_FIXTURES.hub.complete
    const nodes = buildStructuredData(page)
    expect(nodes.map((node) => node['@type'])).toEqual(['CollectionPage', 'ItemList', 'BreadcrumbList'])
    expect(validateStructuredData(page, nodes)).toEqual([])
  })

  it('keeps Detail JSON-LD conservative and rejects fabricated facts', () => {
    const page = P3_GOLDEN_FIXTURES.detail.complete
    const nodes = buildStructuredData(page)
    expect(nodes.map((node) => node['@type'])).toEqual(['WebPage', 'BreadcrumbList', 'ImageObject'])
    expect(nodes.find((node) => node['@type'] === 'ImageObject')?.contentUrl).toBe('https://preview.local/media/media-p2l-example-001')
    expect(validateStructuredData(page, [...nodes, { '@context': 'https://schema.org', '@type': 'Thing', aggregateRating: 5 }])).toContain('SCHEMA_UNSUPPORTED_FABRICATED_FACT')
  })

  it('constructs only canonical in-inventory edges and reports orphans', () => {
    const hub = { ...P3_GOLDEN_FIXTURES.hub.complete, links: [{ ...P3_GOLDEN_FIXTURES.hub.complete.links[0], relation: 'item' as const, href: P3_GOLDEN_FIXTURES.entity.complete.route, target_page_id: P3_GOLDEN_FIXTURES.entity.complete.page_id, indexable: true }] }
    const isolated = { ...P3_GOLDEN_FIXTURES.detail.complete, page_id: '00000000-0000-4000-8000-000000000099', route: '/en/prompts/isolated-detail', links: [] }
    const graph = buildInternalLinkGraph([hub, P3_GOLDEN_FIXTURES.entity.complete, isolated])
    expect(graph.edges).toHaveLength(1)
    expect(graph.orphanPageIds).toContain(isolated.page_id)
  })

  it('reports crawl depth and inventory routes missing from the page graph', () => {
    const root = P3_GOLDEN_FIXTURES.hub.complete
    const middle = { ...P3_GOLDEN_FIXTURES.entity.complete, page_id: 'ent_graph_middle', route: '/en/prompts/models/graph-middle', links: [] }
    const leaf = { ...P3_GOLDEN_FIXTURES.detail.complete, page_id: 'det_graph_leaf', route: '/en/prompts/graph-leaf', links: [] }
    const rootWithLink = { ...root, links: [{ ...root.links[0], relation: 'item' as const, href: middle.route, target_page_id: middle.page_id, indexable: true }] }
    const middleWithLink = { ...middle, links: [{ ...root.links[0], relation: 'item' as const, href: leaf.route, target_page_id: leaf.page_id, indexable: true }] }
    const graph = buildInternalLinkGraph([rootWithLink, middleWithLink, leaf], {
      rootPageIds: [root.page_id],
      maxClickDepth: 1,
      sitemapRoutes: ['/en/missing-sitemap', leaf.route],
      searchConsoleRoutes: ['/en/missing-gsc'],
      analyticsRoutes: ['/en/missing-analytics'],
    })
    expect(graph.depthByPageId).toMatchObject({ [root.page_id]: 0, [middle.page_id]: 1, [leaf.page_id]: 2 })
    expect(graph.maxClickDepth).toBe(2)
    expect(graph.overDepthPageIds).toEqual([leaf.page_id])
    expect(graph.inventoryRouteGaps).toEqual({ sitemap: ['/en/missing-sitemap'], searchConsole: ['/en/missing-gsc'], analytics: ['/en/missing-analytics'] })
    expect(graph.inventoryOrphanRoutes).toEqual({ sitemap: [], searchConsole: [], analytics: [] })
  })
})
