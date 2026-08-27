import { pageProjectionSchema } from '@/contracts/projection'

import type { ActivePublicationProjectionReader, FrontendRouteRequest } from './preview-projection-reader'

type PayloadFind = Readonly<{ collection: string; where?: unknown; limit?: number; depth?: number; overrideAccess?: boolean }>
type PayloadFindByID = Readonly<{ collection: string; id: string | number; depth?: number; overrideAccess?: boolean }>
export type ProjectionPayloadReader = Readonly<{
  find: (input: PayloadFind) => Promise<Readonly<{ docs: readonly Record<string, unknown>[] }>>
  findByID: (input: PayloadFindByID) => Promise<unknown>
}>

const identifier = (value: unknown): string | number | undefined => {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' || typeof id === 'number' ? id : undefined
  }
  return undefined
}

/** Payload stores the strict renderer payload under its `projection` JSON column. */
const materializeProjection = (document: unknown): unknown => {
  if (typeof document !== 'object' || document === null) return document
  const row = document as Record<string, unknown>
  const bytes = typeof row.projection === 'object' && row.projection !== null
    ? row.projection as Record<string, unknown>
    : undefined
  if (bytes === undefined) return row
  const {
    projection: _projectionBytes,
    id: _payloadID,
    workflow_run: _workflowRun,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...metadata
  } = row
  return { ...metadata, page: bytes.page, navigation: bytes.navigation, slots: bytes.slots }
}

/** Reads an immutable projection only through the current active publication binding. */
export const createPayloadActiveProjectionReader = (payload: ProjectionPayloadReader): ActivePublicationProjectionReader => Object.freeze({
  async readBoundProjection(request: FrontendRouteRequest) {
    try {
      const pointers = await payload.find({ collection: 'active-publication-pointers', limit: 1, depth: 0, overrideAccess: true, where: { singleton_key: { equals: 'active-publication' } } })
      const publishVersion = pointers.docs[0]?.publish_version
      if (!Number.isSafeInteger(publishVersion) || (publishVersion as number) < 1) return undefined
      const bindings = await payload.find({
        collection: 'publication-projections', limit: 1, depth: 0, overrideAccess: true,
        where: { and: [
          { publish_version: { equals: publishVersion } },
          { locale: { equals: request.locale } },
          { family: { equals: request.family } },
          { route: { equals: request.route } },
          { internal_noindex: { equals: true } },
        ] },
      })
      const projectionID = identifier(bindings.docs[0]?.projection)
      if (projectionID === undefined) return undefined
      const projection = pageProjectionSchema.safeParse(materializeProjection(await payload.findByID({ collection: 'page-projections', id: projectionID, depth: 0, overrideAccess: true })))
      if (!projection.success || projection.data.state !== 'released' || projection.data.page.index_state !== 'discoverable_noindex') return undefined
      if (projection.data.projection_id !== String(bindings.docs[0]?.projection_id ?? projection.data.projection_id)) return undefined
      if (projection.data.page.route !== request.route || projection.data.locale !== request.locale || projection.data.family !== request.family) return undefined
      return Object.freeze({ publishVersion: publishVersion as number, projectionId: projection.data.projection_id, projection: projection.data })
    } catch {
      return undefined
    }
  },
})
