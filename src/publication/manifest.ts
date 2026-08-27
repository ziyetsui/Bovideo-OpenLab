import { createHash } from 'node:crypto'

import type { DetailRoute } from '@/detail/schema'
import type { PublicationSnapshot } from '@/contracts/publication'
import { buildEmptyProductionSitemap, type P2LocalSitemapManifest } from './sitemap'

export type PublicationTreeFile = Readonly<{ path: string; bytes: string | Uint8Array }>
export type P2LocalPreviewManifest = Readonly<{
  profile: 'p2-local'
  publish_version: number
  noindex: true
  public_deployment: false
  route_count: number
  route_tree_hash: string
  robots_hash: string
  fixture_hash: string
}>
export type LocalPublicationManifest = Readonly<{
  profile: 'p2-local'
  label: 'P2L-B0' | 'P2L-B1' | 'P2L-B2' | 'P2L-B3'
  snapshot: PublicationSnapshot
  payloadTreeHash: string
  routePayloadHash: string
  exportTreeHash: string
  routeManifestHash: string
  previewManifest: P2LocalPreviewManifest
  productionSitemap: P2LocalSitemapManifest
  sitemapXml: string
  exportFixture: Readonly<{ publication: 'local_only'; treeHash: string }>
  routes: readonly DetailRoute[]
  routeFiles: readonly PublicationTreeFile[]
  exportFiles: readonly PublicationTreeFile[]
}>
export type LocalSnapshotManifest = LocalPublicationManifest

export type PublicationManifestInput = Readonly<{
  label: LocalPublicationManifest['label']
  publishVersion: number
  routes: readonly DetailRoute[]
  routeFiles: readonly PublicationTreeFile[]
  exportFiles: readonly PublicationTreeFile[]
  snapshot?: PublicationSnapshot
  metadata?: Readonly<Record<string, unknown>>
}>

const LABEL_VERSION: Readonly<Record<LocalPublicationManifest['label'], number>> = Object.freeze({ 'P2L-B0': 1, 'P2L-B1': 2, 'P2L-B2': 3, 'P2L-B3': 4 })
const ROBOTS = 'noindex,nofollow,noarchive,nosnippet'

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left).map((char) => char.codePointAt(0) ?? 0)
  const b = Array.from(right).map((char) => char.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index]! - b[index]!
  return a.length - b.length
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareCodePoints(left, right)).map(([key, child]) => [key, stableValue(child)]))
  }
  return value
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value))}\n`
}

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : new Uint8Array(value)
}

function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
function pathCompare(left: string, right: string): number { return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')) }
function assertPath(path: string): void {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('\u0000') || path.split('/').includes('..')) throw new Error(`unsafe publication path: ${path}`)
}
function normalizeFiles(files: readonly PublicationTreeFile[]): PublicationTreeFile[] {
  const normalized = files.map((file) => { assertPath(file.path); return { path: file.path, bytes: bytes(file.bytes) } })
  if (new Set(normalized.map(({ path }) => path)).size !== normalized.length) throw new Error('duplicate publication tree path')
  return normalized.sort((left, right) => pathCompare(left.path, right.path))
}

export function hashPublicationTree(files: readonly PublicationTreeFile[]): `sha256:p2l-v1:${string}` {
  const framing = normalizeFiles(files).map((file) => `${file.path}\u0000${sha256(bytes(file.bytes))}\n`).join('')
  return `sha256:p2l-v1:${sha256(Buffer.from(framing, 'utf8'))}`
}

function hashV1(files: readonly PublicationTreeFile[]): `sha256:v1:${string}` { return `sha256:v1:${hashPublicationTree(files).slice('sha256:p2l-v1:'.length)}` }
function routeManifestHash(routes: readonly DetailRoute[]): string {
  return hashPublicationTree([{ path: 'route-manifest.json', bytes: stableJson([...routes].sort((left, right) => pathCompare(left.path, right.path))) }])
}

export function buildLocalPublicationManifest(input: PublicationManifestInput): LocalPublicationManifest {
  if (LABEL_VERSION[input.label] !== input.publishVersion) throw new Error('publication label and version mismatch')
  const expectedRouteCount = input.label === 'P2L-B0' ? 0 : input.label === 'P2L-B3' ? 15 : 16
  if (input.routes.length !== expectedRouteCount) throw new Error(`${input.label} requires exactly ${expectedRouteCount} routes`)
  const routes = [...input.routes].sort((left, right) => pathCompare(left.path, right.path))
  const routeFiles = normalizeFiles(input.routeFiles)
  const exportFiles = normalizeFiles(input.exportFiles)
  if (routeFiles.some(({ path }) => !path.startsWith('routes/') || !/\.(?:json|html)$/.test(path))) throw new Error('route payload path must be an allowed JSON/HTML file under routes/')
  if (exportFiles.some(({ path }) => !path.startsWith('export/'))) throw new Error('export payload path must be under export/')
  if (routes.some((route) => route.robots !== ROBOTS)) throw new Error('all local publication routes must be noindex')
  if (new Set(routes.map((route) => route.locale)).size !== routes.length) throw new Error('duplicate locale route in local publication')
  const routeFileLocales = routeFiles.map(({ path }) => path.split('/')[1]).filter((locale): locale is string => locale !== undefined)
  if (new Set(routeFileLocales).size !== routeFileLocales.length || routeFileLocales.length !== expectedRouteCount || !routes.every((route) => routeFileLocales.includes(route.locale)))
    throw new Error('route payload files do not match the route manifest')
  const routeHash = routeManifestHash(routes)
  const exportHash = hashPublicationTree(exportFiles)
  const sitemap = buildEmptyProductionSitemap({ publishVersion: input.publishVersion, routeManifestHash: routeHash })
  const payloadFiles = [...routeFiles, ...exportFiles, { path: 'sitemap.xml', bytes: sitemap.xml }]
  const payloadHash = hashPublicationTree(payloadFiles)
  const snapshot = input.snapshot ?? {
    publish_version: input.publishVersion, schema_version: 1, created_at: '2026-08-25T00:00:00.000Z',
    route_manifest_ref: `local:route-manifest:${input.publishVersion}`, sitemap_manifest_ref: `local:sitemap-manifest:${input.publishVersion}`,
    github_manifest_ref: `local:export:${input.publishVersion}`, content_tree_hash: hashV1(payloadFiles),
    previous_verified_version: input.publishVersion > 1 ? input.publishVersion - 1 : null, validation_report_ref: `local:validation:${input.publishVersion}`,
  } satisfies PublicationSnapshot
  if (snapshot.publish_version !== input.publishVersion) throw new Error('snapshot publish version mismatch')
  const fixtureHash = hashPublicationTree(exportFiles)
  const preview: P2LocalPreviewManifest = Object.freeze({ profile: 'p2-local', publish_version: input.publishVersion, noindex: true, public_deployment: false, route_count: routes.length, route_tree_hash: hashPublicationTree(routeFiles), robots_hash: hashV1([{ path: 'robots.txt', bytes: ROBOTS }]), fixture_hash: fixtureHash })
  return Object.freeze({ profile: 'p2-local', label: input.label, snapshot, payloadTreeHash: payloadHash, routePayloadHash: hashPublicationTree(routeFiles), exportTreeHash: exportHash, routeManifestHash: routeHash, previewManifest: preview, productionSitemap: sitemap.manifest, sitemapXml: sitemap.xml, exportFixture: Object.freeze({ publication: 'local_only', treeHash: fixtureHash }), routes: Object.freeze(routes), routeFiles: Object.freeze(routeFiles), exportFiles: Object.freeze(exportFiles) })
}

export const createLocalPublicationManifest = buildLocalPublicationManifest
export const buildDeterministicPublicationManifest = buildLocalPublicationManifest
