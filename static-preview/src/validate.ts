import { APPLICATION_LOCALES, PREVIEW_ROUTE_IDS, type PageFamily, type PreviewRoute } from './contracts'
import type { PreviewCopy } from '../fixtures/copy'

const EXPECTED_ROUTE_IDS = new Set([
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
])

const EXPECTED_FAMILY_COUNTS: Readonly<Record<PageFamily, number>> = {
  hub: 1,
  gallery: 2,
  entity: 7,
  detail: 20,
}

const isSafeSegment = (value: string): boolean => /^[a-z0-9-]+$/.test(value)

export function validateCohort(routes: readonly PreviewRoute[]): void {
  if (routes.length !== 30) {
    throw new Error(`Preview Beta cohort must contain exactly 30 routes; received ${routes.length}`)
  }

  const routeIds = new Set<string>()
  const routePaths = new Set<string>()
  const familyCounts: Record<PageFamily, number> = { hub: 0, gallery: 0, entity: 0, detail: 0 }

  for (const route of routes) {
    if (routeIds.has(route.routeId)) {
      throw new Error(`Duplicate route ID: ${route.routeId}`)
    }
    routeIds.add(route.routeId)

    if (!route.segments.length || route.segments.some((segment) => !isSafeSegment(segment))) {
      throw new Error(`Unsafe route path for ${route.routeId}`)
    }
    const path = route.segments.join('/')
    if (routePaths.has(path)) {
      throw new Error(`Duplicate route path: /${path}`)
    }
    routePaths.add(path)

    if (route.provenance.kind !== route.provenance.rightsCode) {
      throw new Error(`Unsafe provenance for ${route.routeId}`)
    }
    familyCounts[route.family] += 1
  }

  for (const [family, expectedCount] of Object.entries(EXPECTED_FAMILY_COUNTS) as Array<
    [PageFamily, number]
  >) {
    if (familyCounts[family] !== expectedCount) {
      throw new Error(`Expected ${expectedCount} ${family} routes; received ${familyCounts[family]}`)
    }
  }

  if (routeIds.size !== EXPECTED_ROUTE_IDS.size || [...routeIds].some((id) => !EXPECTED_ROUTE_IDS.has(id))) {
    throw new Error('Preview Beta cohort must use the exact route ID set')
  }

  for (const route of routes) {
    for (const parentRouteId of route.parentRouteIds) {
      if (!routeIds.has(parentRouteId)) {
        throw new Error(`Missing parent route ${parentRouteId} for ${route.routeId}`)
      }
      if (parentRouteId === route.routeId) {
        throw new Error(`Route ${route.routeId} cannot be its own parent`)
      }
    }
  }
}

function sameKeys(actual: object, expected: readonly string[]): boolean {
  const keys = Object.keys(actual).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function assertPopulatedStrings(value: unknown, path: string): void {
  if (typeof value === 'function') return
  if (typeof value === 'string') {
    if (!value.trim()) throw new Error(`Missing localized copy at ${path}`)
    return
  }
  if (!value || typeof value !== 'object') throw new Error(`Invalid localized copy at ${path}`)
  for (const [key, nested] of Object.entries(value)) assertPopulatedStrings(nested, `${path}.${key}`)
}

export function validatePreviewCopy(copy: PreviewCopy): void {
  if (!sameKeys(copy, APPLICATION_LOCALES)) throw new Error('Preview copy must contain exactly the normative locales')

  const english = copy.en
  for (const locale of APPLICATION_LOCALES) {
    const localized = copy[locale]
    assertPopulatedStrings(localized, locale)
    if (!sameKeys(localized.routes, PREVIEW_ROUTE_IDS)) throw new Error(`Preview copy has an incomplete route matrix for ${locale}`)
    if (!sameKeys(localized.localeNames, APPLICATION_LOCALES)) throw new Error(`Preview copy has an incomplete locale selector for ${locale}`)
    for (const routeId of PREVIEW_ROUTE_IDS) {
      if (!localized.routes[routeId].title.trim() || !localized.routes[routeId].summary.trim()) {
        throw new Error(`Preview copy has an empty route value for ${locale}/${routeId}`)
      }
      if (locale !== 'en' && localized.routes[routeId].title === english.routes[routeId].title) {
        throw new Error(`Preview copy cannot reuse an English title for ${locale}/${routeId}`)
      }
    }
    if (locale !== 'en' && localized.disclosure.header === english.disclosure.header) {
      throw new Error(`Preview copy cannot reuse English disclosure for ${locale}`)
    }
  }
}
