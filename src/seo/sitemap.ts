import { createHash } from 'node:crypto'

import { APPLICATION_LOCALES, type ApplicationLocale } from '@/contracts/locale'
import type { PageFamily } from '@/page/schema'
import { validatePublicRoute } from './routes'

export const MAX_SITEMAP_URLS_PER_SHARD = 10_000
export type SitemapRouteCandidate = Readonly<{
  route: string
  locale: ApplicationLocale
  family: PageFamily
  status: 200 | 301 | 308 | 410
  indexable: boolean
  /** Clean canonical path emitted by route validation; omitted means reject. */
  canonicalPath?: string
  /** A stable identity shared by locale variants. Defaults to route without locale. */
  routeKey?: string
  contentHash: string
  linkHash: string
  schemaHash: string
  lastModified?: string
  /** Qualification/route layer may explicitly exclude a route. */
  sitemapEligible?: boolean
}>

export type SitemapEntry = Readonly<{
  loc: string
  route: string
  locale: ApplicationLocale
  family: PageFamily
  routeKey: string
  lastmod: string
  alternates: Readonly<Record<ApplicationLocale, string>>
  contentHash: string
  linkHash: string
  schemaHash: string
}>

export type SitemapShard = Readonly<{
  name: string
  publishVersion: number
  locale: ApplicationLocale
  family: PageFamily
  shardIndex: number
  entries: readonly SitemapEntry[]
  xml: string
  xmlHash: string
}>

export type VersionedSitemap = Readonly<{
  publishVersion: number
  origin: string
  routeManifestHash: string
  urlCount: number
  excludedRoutes: readonly Readonly<{ route: string; reason: string }>[]
  shards: readonly SitemapShard[]
}>

export type PreviousSitemap = Readonly<{
  shards: readonly SitemapShard[]
}>

const hash = (value: string): string => `sha256:v1:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const cleanRoute = (route: string): string => {
  const parsed = new URL(route, 'https://sitemap.invalid')
  if (parsed.search !== '' || parsed.hash !== '') throw new Error(`Sitemap route must not contain query or hash: ${route}`)
  const pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '')
  if (!pathname.startsWith('/') || pathname.includes('//') || pathname.split('/').some((part) => part === '.' || part === '..')) throw new Error(`Sitemap route path is unsafe: ${route}`)
  return pathname
}

const absoluteUrl = (origin: string, route: string): string => new URL(route, `${origin.replace(/\/+$/, '')}/`).toString()

const routeIdentity = (candidate: SitemapRouteCandidate, route: string): string => {
  if (candidate.routeKey !== undefined && candidate.routeKey.length > 0) return candidate.routeKey
  const prefix = `/${candidate.locale}`
  return route.startsWith(`${prefix}/`) ? route.slice(prefix.length) : route
}

const stableEntryKey = (entry: SitemapEntry): string => JSON.stringify({
  route: entry.route, locale: entry.locale, family: entry.family, routeKey: entry.routeKey,
  contentHash: entry.contentHash, linkHash: entry.linkHash, schemaHash: entry.schemaHash,
})

const previousByRoute = (previous: PreviousSitemap | undefined): Map<string, SitemapEntry> => {
  const entries = previous?.shards.flatMap((shard) => shard.entries) ?? []
  return new Map(entries.map((entry) => [entry.loc, entry]))
}

const asLastmod = (value: string | undefined): string => {
  if (value === undefined) return '1970-01-01T00:00:00.000Z'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Sitemap lastModified is invalid: ${value}`)
  return parsed.toISOString()
}

const buildXml = (entries: readonly SitemapEntry[]): string => {
  const urls = entries.map((entry) => {
    const alternates = Object.entries(entry.alternates)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([locale, href]) => `    <xhtml:link rel="alternate" hreflang="${esc(locale)}" href="${esc(href)}"/>`)
      .join('\n')
    return `  <url>\n    <loc>${esc(entry.loc)}</loc>\n    <lastmod>${esc(entry.lastmod)}</lastmod>\n${alternates}\n  </url>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.length > 0 ? `\n${urls}\n` : ''}</urlset>`
}

/** Build deterministic, version-bound Sitemap shards from one release manifest. */
export const buildVersionedSitemap = (input: Readonly<{
  publishVersion: number
  origin: string
  routes: readonly SitemapRouteCandidate[]
  previous?: PreviousSitemap
  maxUrlsPerShard?: number
}>): VersionedSitemap => {
  if (!Number.isSafeInteger(input.publishVersion) || input.publishVersion < 1) throw new Error('Sitemap publishVersion must be a positive integer')
  const origin = new URL(input.origin).origin
  const maxUrlsPerShard = input.maxUrlsPerShard ?? MAX_SITEMAP_URLS_PER_SHARD
  if (!Number.isSafeInteger(maxUrlsPerShard) || maxUrlsPerShard < 1 || maxUrlsPerShard > MAX_SITEMAP_URLS_PER_SHARD) throw new Error('Sitemap shard size must be between 1 and 10000')

  const excludedRoutes: Array<{ route: string; reason: string }> = []
  const seenRoutes = new Set<string>()
  const eligible = input.routes.flatMap((candidate) => {
    if (!APPLICATION_LOCALES.includes(candidate.locale)) { excludedRoutes.push({ route: candidate.route, reason: 'locale_not_approved' }); return [] }
    if (candidate.status !== 200) { excludedRoutes.push({ route: candidate.route, reason: 'route_not_canonical_200' }); return [] }
    if (!candidate.indexable) { excludedRoutes.push({ route: candidate.route, reason: 'route_not_indexable' }); return [] }
    if (candidate.sitemapEligible === false) { excludedRoutes.push({ route: candidate.route, reason: 'sitemap_not_eligible' }); return [] }
    try {
      const route = cleanRoute(candidate.route)
      if (!route.startsWith(`/${candidate.locale}/`) && route !== `/${candidate.locale}`) { excludedRoutes.push({ route: candidate.route, reason: 'route_locale_mismatch' }); return [] }
      const routeCheck = validatePublicRoute({ requestedUrl: route, canonicalPath: candidate.canonicalPath ?? '', status: 200 })
      if (!routeCheck.valid || !routeCheck.sitemapEligible) { excludedRoutes.push({ route: candidate.route, reason: `route_not_self_canonical:${routeCheck.errors.join(',') || 'canonical_missing'}` }); return [] }
      const duplicateKey = `${candidate.locale}:${candidate.family}:${route}`
      if (seenRoutes.has(duplicateKey)) { excludedRoutes.push({ route: candidate.route, reason: 'duplicate_route' }); return [] }
      seenRoutes.add(duplicateKey)
      return [{ ...candidate, route }]
    } catch (error) {
      excludedRoutes.push({ route: candidate.route, reason: error instanceof Error ? error.message : 'route_invalid' })
      return []
    }
  })

  const byIdentity = new Map<string, typeof eligible>()
  for (const candidate of eligible) {
    const identity = `${candidate.family}:${routeIdentity(candidate, candidate.route)}`
    const group = byIdentity.get(identity) ?? []
    group.push(candidate)
    byIdentity.set(identity, group)
  }
  const previous = previousByRoute(input.previous)
  const entries: SitemapEntry[] = eligible.map((candidate) => {
    const routeKey = routeIdentity(candidate, candidate.route)
    const loc = absoluteUrl(origin, candidate.route)
    const siblingRoutes = byIdentity.get(`${candidate.family}:${routeKey}`) ?? []
    const alternates = Object.fromEntries(siblingRoutes
      .sort((left, right) => left.locale.localeCompare(right.locale))
      .map((sibling) => [sibling.locale, absoluteUrl(origin, sibling.route)])) as Record<ApplicationLocale, string>
    const prior = previous.get(loc)
    const unchanged = prior !== undefined && prior.contentHash === candidate.contentHash && prior.linkHash === candidate.linkHash && prior.schemaHash === candidate.schemaHash
    return {
      loc, route: candidate.route, locale: candidate.locale, family: candidate.family, routeKey,
      lastmod: unchanged ? prior.lastmod : asLastmod(candidate.lastModified), alternates,
      contentHash: candidate.contentHash, linkHash: candidate.linkHash, schemaHash: candidate.schemaHash,
    }
  }).sort((left, right) => left.loc.localeCompare(right.loc))

  const grouped = new Map<string, SitemapEntry[]>()
  for (const entry of entries) {
    const key = `${entry.locale}:${entry.family}`
    const group = grouped.get(key) ?? []
    group.push(entry)
    grouped.set(key, group)
  }
  const shards: SitemapShard[] = []
  for (const key of [...grouped.keys()].sort()) {
    const [locale, family] = key.split(':') as [ApplicationLocale, PageFamily]
    const group = grouped.get(key)!
    for (let offset = 0, shardIndex = 0; offset < group.length; offset += maxUrlsPerShard, shardIndex += 1) {
      const shardEntries = Object.freeze(group.slice(offset, offset + maxUrlsPerShard))
      const xml = buildXml(shardEntries)
      shards.push(Object.freeze({
        name: `sitemap-v${input.publishVersion}-${locale}-${family}-${shardIndex + 1}.xml`,
        publishVersion: input.publishVersion, locale, family, shardIndex: shardIndex + 1,
        entries: shardEntries, xml, xmlHash: hash(xml),
      }))
    }
  }
  const manifestInput = entries.map(stableEntryKey).sort().join('\n')
  return Object.freeze({
    publishVersion: input.publishVersion, origin, routeManifestHash: hash(`v${input.publishVersion}\n${manifestInput}`),
    urlCount: entries.length, excludedRoutes: Object.freeze(excludedRoutes.sort((left, right) => left.route.localeCompare(right.route))),
    shards: Object.freeze(shards),
  })
}

export const buildSitemap = buildVersionedSitemap
export const buildSitemapShards = buildVersionedSitemap
