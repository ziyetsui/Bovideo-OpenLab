import { APPLICATION_LOCALES, type ApplicationLocale } from '@/contracts/locale'
import { createHash } from 'node:crypto'
import type { ApprovedLocaleBatch } from '@/review/locale-review'
import { projectDetailRoute, routeForPage, type DetailProjectionInput } from '@/detail/projector'
import type { DetailPageData, DetailRoute } from '@/detail/schema'

const UUID = '00000000-0000-4000-8000-000000000001'
const SOURCE_HASH = `sha256:v1:${'a'.repeat(64)}` as `sha256:v1:${string}`

const localDetailInput: DetailProjectionInput = Object.freeze({
  artifactId: 'artifact-p2l-reviewed-001', routeId: UUID, slug: 'cinematic-product-shot', sourceHash: SOURCE_HASH,
  originalText: 'Use gpt-4.1 at http://127.0.0.1:3000/fixture with {{prompt}}.', originalLanguage: 'en',
  canonicalLabel: 'Cinematic product shot', medium: 'image', sourceUrl: 'http://127.0.0.1:3000/fixture/status/p2l-001',
  observedAt: '2026-08-24T12:00:00.000Z', requiredInputs: ['subject image'], optionalInputs: ['brand palette'],
  parameters: [{ name: 'aspect ratio', value: '16:9', sourceRef: 'artifact-p2l-reviewed-001' }],
  mediaRefs: ['media-p2l-example-001'], workflow: [{ text: 'Add the subject image', action: 'upload', assertion: 'The subject is visible', status: 'verified' as const }],
  variationRefs: ['candidate-p2l-variation-001'], likes: 241, bookmarks: 24, views: 2410,
  productActionId: 'action-p2l-copy-prompt', sourceRef: 'source-p2l-001',
  localizedTitles: Object.freeze(Object.fromEntries(APPLICATION_LOCALES.map((locale) => [locale, `[${locale}] Cinematic product shot`])) as Record<ApplicationLocale, string>),
})

const localApprovedLocaleBatch: ApprovedLocaleBatch = Object.freeze({
  artifactId: localDetailInput.artifactId, sourceHash: localDetailInput.sourceHash,
  locales: Object.freeze(APPLICATION_LOCALES.map((locale, index) => Object.freeze({
    id: `locale-p2l-${String(index + 1).padStart(2, '0')}`, locale, sourceHash: localDetailInput.sourceHash,
    revision: 2, workflowState: 'approved' as const, qaResultId: `qa-p2l-${String(index + 1).padStart(2, '0')}`,
    reviewerId: 'reviewer-p2l-001', reviewedAt: '2026-08-24T12:00:00.000Z', localizedFieldsHash: localDetailInput.sourceHash,
  }))), reviewManifestHash: localDetailInput.sourceHash,
})

export const LOCAL_DETAIL_PAGES: readonly DetailPageData[] = Object.freeze(APPLICATION_LOCALES.map((locale) => projectDetailRoute(localDetailInput, localApprovedLocaleBatch, { locale })))
export const LOCAL_DETAIL_ROUTE: DetailRoute = routeForPage(LOCAL_DETAIL_PAGES[0]!, localDetailInput.sourceHash)
export const LOCAL_DETAIL_ROUTE_ID = UUID
export const LOCAL_DETAIL_SLUG = localDetailInput.slug
export const INVENTORY_DETAIL_ROUTE_IDS: readonly string[] = Object.freeze(Array.from({ length: 24 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`))
export const inventoryPageId = (routeId: string): string => {
  if (routeId === LOCAL_DETAIL_ROUTE_ID) return LOCAL_DETAIL_PAGES[0]!.pageId
  const hex = createHash('sha256').update(`p3-inventory-page:${routeId}`, 'utf8').digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16] ?? '8', 16) % 4] ?? '8'
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}
