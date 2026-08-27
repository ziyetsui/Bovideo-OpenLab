import { createHash } from 'node:crypto'

export const EMPTY_PRODUCTION_SITEMAP_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>'

export type P2LocalSitemapManifest = Readonly<{
  profile: 'p2-local'
  publish_version: number
  route_manifest_hash: string
  url_count: number
  shards: readonly string[]
  submission: 'prohibited'
  sitemap_xml_hash: `sha256:v1:${string}`
}>

export type EmptyProductionSitemap = Readonly<{
  xml: string
  xmlHash: `sha256:v1:${string}`
  manifest: P2LocalSitemapManifest
}>

const hash = (bytes: string): `sha256:v1:${string}` =>
  `sha256:v1:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`

const versionedP2Hash = /^sha256:p2l-v1:[a-f0-9]{64}$/

export function buildEmptyProductionSitemap(input: Readonly<{
  publishVersion: number
  routeManifestHash: string
  urls?: readonly string[]
}>): EmptyProductionSitemap {
  if (!Number.isSafeInteger(input.publishVersion) || input.publishVersion < 1)
    throw new Error('production Sitemap publish version must be positive')
  if (!versionedP2Hash.test(input.routeManifestHash)) throw new Error('route manifest hash is invalid')
  if (input.urls !== undefined && input.urls.length !== 0)
    throw new Error('P2-L production Sitemap must contain zero URLs')
  const xmlHash = hash(EMPTY_PRODUCTION_SITEMAP_XML)
  const manifest: P2LocalSitemapManifest = Object.freeze({
    profile: 'p2-local', publish_version: input.publishVersion,
    route_manifest_hash: input.routeManifestHash, url_count: 0, shards: [], submission: 'prohibited', sitemap_xml_hash: xmlHash,
  })
  return Object.freeze({ xml: EMPTY_PRODUCTION_SITEMAP_XML, xmlHash, manifest })
}

export function validateProductionSitemap(value: EmptyProductionSitemap): Readonly<{
  wellFormed: true
  protocolPublishable: false
  urlCount: 0
}> {
  if (value.xml !== EMPTY_PRODUCTION_SITEMAP_XML) throw new Error('production Sitemap sentinel bytes changed')
  if (value.manifest.profile !== 'p2-local' || value.manifest.url_count !== 0 || value.manifest.shards.length !== 0 || value.manifest.submission !== 'prohibited')
    throw new Error('production Sitemap manifest is not the prohibited empty sentinel')
  if (value.xmlHash !== hash(value.xml) || value.manifest.sitemap_xml_hash !== value.xmlHash) throw new Error('production Sitemap hash mismatch')
  if (/<(?:url|sitemap)(?:\s|>)/i.test(value.xml)) throw new Error('empty Sitemap contains a URL entry')
  return { wellFormed: true, protocolPublishable: false, urlCount: 0 }
}

export const createEmptyProductionSitemap = buildEmptyProductionSitemap
export const validateEmptyProductionSitemap = validateProductionSitemap
