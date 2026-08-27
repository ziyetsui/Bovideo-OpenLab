import type { PageProjection } from '@/contracts/projection'
import { pageProjectionSchema } from '@/contracts/projection'
import { createPayloadActiveProjectionReader } from './payload-active-projection-reader'
import type { ProjectionPayloadReader } from './payload-active-projection-reader'
import { localizeBoundProjection } from '../localization/localize-bound-projection'
import {
  injectedFrontendPreviewProjectionReader,
  type ActivePublicationProjectionReader,
  type FrontendRouteRequest,
} from './preview-projection-reader'

export type { ActivePublicationProjection, ActivePublicationProjectionReader, FrontendRouteRequest } from './preview-projection-reader'

const isRouteProjection = (request: FrontendRouteRequest, projection: PageProjection): boolean =>
  projection.state === 'released' &&
  projection.page.page_type === request.family &&
  projection.page.locale === request.locale &&
  projection.page.route === request.route

const isReviewedExactLocale = (request: FrontendRouteRequest, projection: PageProjection): boolean =>
  request.locale === 'en' || projection.page.translation_state === 'translated'

const persistedReader = async (): Promise<ActivePublicationProjectionReader | undefined> => {
  try {
    const { getPayload } = await import('payload')
    const { createPayloadConfig } = await import('@/payload.config')
    return createPayloadActiveProjectionReader(await getPayload({ config: createPayloadConfig() }) as unknown as ProjectionPayloadReader)
  } catch {
    return undefined
  }
}

/** Resolves a page only from a live active-pointer → binding → immutable projection chain. */
export const resolveFrontendRoute = async (request: FrontendRouteRequest): Promise<PageProjection | undefined> => {
  const previewReader = injectedFrontendPreviewProjectionReader()
  const reader = previewReader ?? await persistedReader()
  if (reader === undefined) return undefined

  const bound = await reader.readBoundProjection(request)
  if (bound !== undefined && Number.isSafeInteger(bound.publishVersion) && bound.publishVersion > 0) {
    const parsed = pageProjectionSchema.safeParse(bound.projection)
    if (parsed.success && parsed.data.projection_id === bound.projectionId && isRouteProjection(request, parsed.data) && isReviewedExactLocale(request, parsed.data)) return parsed.data
  }
  if (request.locale === 'en') return undefined

  const sourceRequest: FrontendRouteRequest = {
    ...request,
    locale: 'en',
    route: request.route === `/${request.locale}`
      ? '/en'
      : request.route.startsWith(`/${request.locale}/`)
        ? `/en${request.route.slice(request.locale.length + 1)}`
        : request.route,
  }
  const sourceBound = await reader.readBoundProjection(sourceRequest)
  if (sourceBound === undefined || !Number.isSafeInteger(sourceBound.publishVersion) || sourceBound.publishVersion < 1) return undefined
  const parsedSource = pageProjectionSchema.safeParse(sourceBound.projection)
  if (!parsedSource.success || parsedSource.data.projection_id !== sourceBound.projectionId || !isRouteProjection(sourceRequest, parsedSource.data)) return undefined
  const localized = localizeBoundProjection(parsedSource.data, request.locale)
  return isRouteProjection(request, localized) ? localized : undefined
}
