export const APPLICATION_LOCALES = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'de-DE',
  'fr-FR',
  'it-IT',
  'es-ES',
  'es-419',
  'pt-BR',
  'pt-PT',
  'hi-IN',
  'th-TH',
  'tr-TR',
  'vi-VN',
] as const

export type ApplicationLocale = (typeof APPLICATION_LOCALES)[number]

export type PageFamily = 'hub' | 'gallery' | 'entity' | 'detail'

export const PREVIEW_ROUTE_IDS = [
  'hub-prompts',
  'gallery-image',
  'gallery-video',
  'entity-model-01',
  'entity-model-02',
  'entity-model-03',
  'entity-model-04',
  'entity-model-05',
  'entity-model-06',
  'entity-model-07',
  'detail-001',
  'detail-002',
  'detail-003',
  'detail-004',
  'detail-005',
  'detail-006',
  'detail-007',
  'detail-008',
  'detail-009',
  'detail-010',
  'detail-011',
  'detail-012',
  'detail-013',
  'detail-014',
  'detail-015',
  'detail-016',
  'detail-017',
  'detail-018',
  'detail-019',
  'detail-020',
] as const

export type PreviewRouteId = (typeof PREVIEW_ROUTE_IDS)[number]

export type PublicationState = 'approved' | 'withdrawn'

export const PREVIEW_MODES = ['baseline', 'withdrawn'] as const

export type PreviewMode = (typeof PREVIEW_MODES)[number]

export type PreviewRoute = Readonly<{
  routeId: PreviewRouteId
  family: PageFamily
  segments: readonly string[]
  titleKey: string
  summaryKey: string
  publicationState: PublicationState
  parentRouteIds: readonly string[]
  unavailableModule: 'case' | 'tutorial' | 'comparison' | 'faq' | null
  provenance: Readonly<{
    kind: 'synthetic' | 'first_party'
    rightsCode: 'synthetic' | 'first_party'
  }>
}>
