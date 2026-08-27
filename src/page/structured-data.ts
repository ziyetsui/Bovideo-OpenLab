import type { PageEnvelope } from './schema'
import { APPROVED_MEDIA_CATALOG } from './media-catalog'

export type StructuredDataNode = Readonly<Record<string, unknown>>
export type InternalLinkEdge = Readonly<{ from: string; to: string; relation: string }>
export type InternalLinkGraphInventory = Readonly<{
  rootPageIds?: readonly string[]
  maxClickDepth?: number
  sitemapRoutes?: readonly string[]
  searchConsoleRoutes?: readonly string[]
  analyticsRoutes?: readonly string[]
}>
export type InternalLinkGraphReport = Readonly<{
  edges: readonly InternalLinkEdge[]
  orphanPageIds: readonly string[]
  depthByPageId: Readonly<Record<string, number>>
  maxClickDepth: number
  overDepthPageIds: readonly string[]
  inventoryRouteGaps: Readonly<{ sitemap: readonly string[]; searchConsole: readonly string[]; analytics: readonly string[] }>
  inventoryOrphanRoutes: Readonly<{ sitemap: readonly string[]; searchConsole: readonly string[]; analytics: readonly string[] }>
}>

const absolute = (value: string): boolean => /^https:\/\/[^/]+(?:\/|$)/.test(value)
const originFor = (page: PageEnvelope): string => new URL(page.canonical).origin
const absoluteUrl = (page: PageEnvelope, href: string): string => {
  if (/^https:\/\//.test(href)) return href
  return new URL(href, `${originFor(page)}/`).toString()
}

export const buildStructuredData = (page: PageEnvelope): readonly StructuredDataNode[] => {
  const breadcrumb: StructuredDataNode = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: page.breadcrumbs.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.label, item: absoluteUrl(page, item.href) })),
  }
  if (page.page_type === 'detail') {
    const nodes: StructuredDataNode[] = [
      { '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, description: page.description, url: page.canonical },
      breadcrumb,
    ]
    const examples = page.detail.questions.find((question) => question.id === 'examples')
    if (examples?.state === 'present') {
      for (const [index, ref] of examples.content.mediaRefs.entries()) {
        const media = APPROVED_MEDIA_CATALOG[ref]
        if (media === undefined || media.status !== 'approved') continue
        nodes.push({
          '@context': 'https://schema.org',
          '@type': media.media_type === 'video' ? 'VideoObject' : 'ImageObject',
          name: `${page.title} example ${index + 1}`,
          contentUrl: media.url,
        })
      }
    }
    return nodes
  }
  const items = page.links.filter((link) => link.relation === 'item' && link.target_page_id !== null).map((link, index) => ({ '@type': 'ListItem', position: index + 1, name: link.label, url: absoluteUrl(page, link.href) }))
  return [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: page.title, description: page.description, url: page.canonical },
    { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: items },
    breadcrumb,
  ]
}

export const validateStructuredData = (page: PageEnvelope, nodes: readonly StructuredDataNode[]): string[] => {
  const errors: string[] = []
  for (const node of nodes) {
    if (node['@context'] !== 'https://schema.org') errors.push('SCHEMA_CONTEXT_INVALID')
    if (typeof node.url === 'string' && !absolute(node.url)) errors.push('SCHEMA_URL_NOT_ABSOLUTE')
    if (typeof node.contentUrl === 'string' && !absolute(node.contentUrl)) errors.push('SCHEMA_CONTENT_URL_NOT_ABSOLUTE')
    if ('aggregateRating' in node || 'author' in node) errors.push('SCHEMA_UNSUPPORTED_FABRICATED_FACT')
  }
  const pageNode = nodes.find((node) => node['@type'] === 'WebPage' || node['@type'] === 'CollectionPage')
  if (pageNode?.name !== page.title || pageNode?.description !== page.description) errors.push('SCHEMA_VISIBLE_CONTENT_MISMATCH')
  const breadcrumbs = nodes.find((node) => node['@type'] === 'BreadcrumbList')
  if (breadcrumbs === undefined || !Array.isArray(breadcrumbs.itemListElement) || breadcrumbs.itemListElement.length !== page.breadcrumbs.length) errors.push('SCHEMA_BREADCRUMB_MISMATCH')
  return errors
}

export const buildInternalLinkGraph = (pages: readonly PageEnvelope[], inventory: InternalLinkGraphInventory = {}): InternalLinkGraphReport => {
  const pageByRoute = new Map(pages.map((page) => [page.route, page]))
  const edges: InternalLinkEdge[] = []
  for (const page of pages) for (const link of page.links) {
    const target = pageByRoute.get(link.href)
    if (target === undefined || !link.indexable) continue
    edges.push({ from: page.page_id, to: target.page_id, relation: link.relation })
  }
  const activePages = pages.filter((page) => page.index_state !== 'not_generated' && page.index_state !== 'retired')
  const activeIds = new Set(activePages.map((page) => page.page_id))
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (!activeIds.has(edge.from) || !activeIds.has(edge.to)) continue
    const targets = adjacency.get(edge.from) ?? []
    targets.push(edge.to)
    adjacency.set(edge.from, targets)
  }
  const defaultRoots = activePages.filter((page) => page.page_type === 'hub').map((page) => page.page_id)
  const roots = (inventory.rootPageIds ?? (defaultRoots.length > 0 ? defaultRoots : activePages.slice(0, 1).map((page) => page.page_id))).filter((id) => activeIds.has(id))
  const depthByPageId: Record<string, number> = Object.fromEntries(activePages.map((page) => [page.page_id, -1]))
  const queue = roots.map((id) => ({ id, depth: 0 }))
  for (const root of roots) depthByPageId[root] = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const target of adjacency.get(current.id) ?? []) {
      if (depthByPageId[target] !== -1) continue
      depthByPageId[target] = current.depth + 1
      queue.push({ id: target, depth: current.depth + 1 })
    }
  }
  const reachableDepths = Object.values(depthByPageId).filter((depth) => depth >= 0)
  const maxClickDepth = inventory.maxClickDepth ?? 3
  const overDepthPageIds = Object.entries(depthByPageId).filter(([, depth]) => depth > maxClickDepth).map(([pageId]) => pageId)
  const missingRoutes = (routes: readonly string[] | undefined): readonly string[] => (routes ?? []).filter((route) => !pageByRoute.has(route))
  const unreachableRoutes = (routes: readonly string[] | undefined): readonly string[] => (routes ?? []).filter((route) => {
    const page = pageByRoute.get(route)
    return page !== undefined && depthByPageId[page.page_id] === -1
  })
  return {
    edges,
    orphanPageIds: activePages.filter((page) => depthByPageId[page.page_id] === -1).map((page) => page.page_id),
    depthByPageId,
    maxClickDepth: reachableDepths.length > 0 ? Math.max(...reachableDepths) : 0,
    overDepthPageIds,
    inventoryRouteGaps: {
      sitemap: missingRoutes(inventory.sitemapRoutes),
      searchConsole: missingRoutes(inventory.searchConsoleRoutes),
      analytics: missingRoutes(inventory.analyticsRoutes),
    },
    inventoryOrphanRoutes: {
      sitemap: unreachableRoutes(inventory.sitemapRoutes),
      searchConsole: unreachableRoutes(inventory.searchConsoleRoutes),
      analytics: unreachableRoutes(inventory.analyticsRoutes),
    },
  }
}
