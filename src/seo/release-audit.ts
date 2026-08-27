import type { PageEnvelope } from '@/page/schema'
import { buildInternalLinkGraph, buildStructuredData, validateStructuredData, type InternalLinkGraphInventory, type InternalLinkGraphReport } from '@/page/structured-data'

export type ReleasePageAudit = Readonly<{
  status: 'PASS' | 'FAIL'
  structuredDataErrors: Readonly<Record<string, readonly string[]>>
  linkGraph: InternalLinkGraphReport
  errors: readonly string[]
}>

/** Run the JSON-LD, canonical-visible-content, internal-link and orphan checks
 * against the exact page set that will feed the release route manifest. */
export const auditReleasePages = (pages: readonly PageEnvelope[], inventory: InternalLinkGraphInventory = {}): ReleasePageAudit => {
  const structuredDataErrors: Record<string, readonly string[]> = {}
  for (const page of pages) {
    const errors = validateStructuredData(page, buildStructuredData(page))
    if (errors.length > 0) structuredDataErrors[page.route] = Object.freeze([...errors])
  }
  const linkGraph = buildInternalLinkGraph(pages, {
    ...inventory,
    sitemapRoutes: inventory.sitemapRoutes ?? pages.filter((page) => page.index_state === 'indexable').map((page) => page.route),
  })
  const errors = [
    ...Object.entries(structuredDataErrors).flatMap(([route, routeErrors]) => routeErrors.map((error) => `${route}:${error}`)),
    ...linkGraph.orphanPageIds.map((pageId) => `orphan_page:${pageId}`),
    ...linkGraph.overDepthPageIds.map((pageId) => `over_depth_page:${pageId}`),
    ...linkGraph.inventoryRouteGaps.sitemap.map((route) => `sitemap_route_gap:${route}`),
    ...linkGraph.inventoryOrphanRoutes.sitemap.map((route) => `sitemap_orphan_route:${route}`),
    ...linkGraph.inventoryRouteGaps.searchConsole.map((route) => `search_console_route_gap:${route}`),
    ...linkGraph.inventoryOrphanRoutes.searchConsole.map((route) => `search_console_orphan_route:${route}`),
    ...linkGraph.inventoryRouteGaps.analytics.map((route) => `analytics_route_gap:${route}`),
    ...linkGraph.inventoryOrphanRoutes.analytics.map((route) => `analytics_orphan_route:${route}`),
  ]
  return Object.freeze({ status: errors.length === 0 ? 'PASS' : 'FAIL', structuredDataErrors: Object.freeze(structuredDataErrors), linkGraph, errors: Object.freeze(errors) })
}

export const buildReleaseAudit = auditReleasePages
