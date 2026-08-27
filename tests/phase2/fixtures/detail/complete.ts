import { APPLICATION_LOCALES, type ApplicationLocale } from '@/contracts/locale'
import type { ApprovedLocaleBatch } from '@/review/locale-review'
import { projectDetailRoute, routeForPage, type DetailProjectionInput } from '@/detail/projector'
import type { DetailPageData, DetailRoute } from '@/detail/schema'

const UUID = '00000000-0000-4000-8000-000000000001'
const SOURCE_HASH = `sha256:v1:${'a'.repeat(64)}` as `sha256:v1:${string}`

export const completeDetailInput: DetailProjectionInput = Object.freeze({
  artifactId: 'artifact-p2l-reviewed-001', routeId: UUID, slug: 'cinematic-product-shot', sourceHash: SOURCE_HASH,
  originalText: 'Use gpt-4.1 at https://bo.example.test with {{prompt}}.', originalLanguage: 'en',
  canonicalLabel: 'Cinematic product shot', medium: 'image', sourceUrl: 'https://x.example.test/status/p2l-001',
  observedAt: '2026-08-24T12:00:00.000Z', requiredInputs: ['subject image'], optionalInputs: ['brand palette'],
  parameters: [{ name: 'aspect ratio', value: '16:9', sourceRef: 'artifact-p2l-reviewed-001' }],
  mediaRefs: ['media-p2l-example-001'], workflow: [{ text: 'Add the subject image', action: 'upload', assertion: 'The subject is visible', status: 'verified' as const }],
  variationRefs: ['candidate-p2l-variation-001'], likes: 241, bookmarks: 24, views: 2410,
  productActionId: 'action-p2l-copy-prompt', sourceRef: 'source-p2l-001',
  localizedTitles: Object.freeze(Object.fromEntries(APPLICATION_LOCALES.map((locale) => [locale, `[${locale}] Cinematic product shot`])) as Record<ApplicationLocale, string>),
})

export const completeApprovedLocaleBatch: ApprovedLocaleBatch = Object.freeze({
  artifactId: completeDetailInput.artifactId, sourceHash: completeDetailInput.sourceHash,
  locales: Object.freeze(APPLICATION_LOCALES.map((locale, index) => Object.freeze({
    id: `locale-p2l-${String(index + 1).padStart(2, '0')}`, locale, sourceHash: completeDetailInput.sourceHash,
    revision: 2, workflowState: 'approved' as const, qaResultId: `qa-p2l-${String(index + 1).padStart(2, '0')}`,
    reviewerId: 'reviewer-p2l-001', reviewedAt: '2026-08-24T12:00:00.000Z', localizedFieldsHash: completeDetailInput.sourceHash,
  }))),
  reviewManifestHash: completeDetailInput.sourceHash,
})

export const completeDetailPages: readonly DetailPageData[] = Object.freeze(APPLICATION_LOCALES.map((locale) => projectDetailRoute(completeDetailInput, completeApprovedLocaleBatch, { locale })))
export const completeDetailRoute: DetailRoute = routeForPage(completeDetailPages[0]!, completeDetailInput.sourceHash)

export const completeDetailFixture = Object.freeze({
  input: completeDetailInput, approvedLocaleBatch: completeApprovedLocaleBatch,
  pages: completeDetailPages, route: completeDetailRoute,
})
