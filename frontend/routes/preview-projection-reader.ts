import type { PageProjection } from '@/contracts/projection'
import type { ApplicationLocale } from '@/contracts/locale'
import type { PageFamily } from '@/page/schema'

export type FrontendRouteRequest = Readonly<{
  family: PageFamily
  locale: ApplicationLocale
  route: string
}>

export type ActivePublicationProjection = Readonly<{
  publishVersion: number
  projectionId: string
  projection: PageProjection
}>

export type ActivePublicationProjectionReader = Readonly<{
  readBoundProjection: (request: FrontendRouteRequest) => Promise<ActivePublicationProjection | undefined>
}>

const previewReaderState = globalThis as typeof globalThis & {
  __boPseoFrontendPreviewReader?: ActivePublicationProjectionReader
}

const previewEnabled = (): boolean => process.env.NODE_ENV !== 'production' && process.env.PSEO_FRONTEND_PREVIEW === '1'

/** Test-only registry kept separate from the Node-only Payload route reader. */
export const injectFrontendPreviewProjectionReader = (reader: ActivePublicationProjectionReader | undefined): void => {
  if (!previewEnabled()) throw new Error('Frontend preview projection injection requires PSEO_FRONTEND_PREVIEW=1 outside production')
  previewReaderState.__boPseoFrontendPreviewReader = reader
}

export const injectedFrontendPreviewProjectionReader = (): ActivePublicationProjectionReader | undefined =>
  previewEnabled() ? previewReaderState.__boPseoFrontendPreviewReader : undefined
