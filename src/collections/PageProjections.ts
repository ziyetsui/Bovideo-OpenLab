import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { auditAfterChange, collectionAccess } from '@/access/payload-access'
import { pageProjectionSchema } from '@/contracts/projection'
import { hasInternalProjectionPublicationCapability } from '@/publication/payload-projection-command'

const immutableProjectionError = (): APIError<{ field: string }> =>
  new APIError('page projections are append-only', 400, { field: 'page-projection' })

/** Validates the renderer-only contract before the projection becomes immutable. */
export const validatePageProjection: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation === 'update') throw immutableProjectionError()
  const record = data as Record<string, unknown>
  const payload = record.projection as Record<string, unknown>
  if (record.state === 'released' && !hasInternalProjectionPublicationCapability(req?.context))
    throw new APIError('trusted release eligibility is required before a projection can be released', 400, { field: 'state' })
  const parsed = pageProjectionSchema.parse({
    projection_id: record.projection_id,
    page_id: record.page_id,
    locale: record.locale,
    family: record.family,
    state: record.state,
    dependency_hash: record.dependency_hash,
    page: payload?.page,
    navigation: payload?.navigation,
    slots: payload?.slots,
    content_hash: record.content_hash,
    link_hash: record.link_hash,
    schema_hash: record.schema_hash,
    renderer_version: record.renderer_version,
    validation_report_ref: record.validation_report_ref,
  })
  if (parsed.state === 'released' && parsed.page.index_state !== 'discoverable_noindex')
    throw new APIError('local projection publication may release noindex pages only', 400, { field: 'projection.page.index_state' })
  return {
    ...data,
    projection_id: parsed.projection_id,
    page_id: parsed.page_id,
    locale: parsed.locale,
    family: parsed.family,
    state: parsed.state,
    dependency_hash: parsed.dependency_hash,
    content_hash: parsed.content_hash,
    link_hash: parsed.link_hash,
    schema_hash: parsed.schema_hash,
    renderer_version: parsed.renderer_version,
    validation_report_ref: parsed.validation_report_ref,
    projection: { page: parsed.page, navigation: parsed.navigation, slots: parsed.slots },
  }
}

export const PageProjections: CollectionConfig = {
  slug: 'page-projections',
  admin: { useAsTitle: 'projection_id' },
  access: collectionAccess('page-projections'),
  hooks: {
    beforeChange: [validatePageProjection],
    afterChange: [auditAfterChange('page-projections')],
    beforeDelete: [() => { throw immutableProjectionError() }],
  },
  indexes: [
    { fields: ['projection_id'], unique: true },
    { fields: ['page_id', 'locale', 'state'] },
    { fields: ['dependency_hash'] },
    { fields: ['content_hash'] },
  ],
  fields: [
    { name: 'projection_id', type: 'text', required: true, unique: true, index: true },
    { name: 'page_id', type: 'text', required: true, index: true },
    { name: 'locale', type: 'select', required: true, options: ['en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'sv', 'tr', 'zh-CN', 'zh-TW', 'ar'] },
    { name: 'family', type: 'select', required: true, options: ['hub', 'gallery', 'entity', 'detail'] },
    { name: 'state', type: 'select', required: true, options: ['draft', 'validated', 'released', 'superseded', 'withdrawn'] },
    { name: 'projection', type: 'json', required: true, admin: { description: 'Renderer-only page, navigation, and slot contract.' } },
    { name: 'dependency_hash', type: 'text', required: true, index: true },
    { name: 'content_hash', type: 'text', required: true, index: true },
    { name: 'link_hash', type: 'text', required: true, index: true },
    { name: 'schema_hash', type: 'text', required: true, index: true },
    { name: 'renderer_version', type: 'text', required: true },
    { name: 'validation_report_ref', type: 'text', required: true },
    { name: 'workflow_run', type: 'relationship', relationTo: 'workflow-runs', required: true, index: true },
  ],
}
