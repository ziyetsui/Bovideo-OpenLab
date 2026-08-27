import { createHash } from 'node:crypto'

import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'
import { pageModuleSchema, type PageModule } from '@/page/modules'

import { localeOptions, preventStableIdMutation, productionFields } from './shared'

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
}

/** Content identity derives from the strict module payload, never a client hash. */
export const hashModule = (module: PageModule): string => {
  const { content_hash: _contentHash, ...content } = module
  return `sha256:v1:${createHash('sha256').update(stableSerialize(content), 'utf8').digest('hex')}`
}

/** Parses strict module bytes at the Payload boundary and replaces the client hash. */
export const validateModuleEnvelopePayload: CollectionBeforeChangeHook = ({ data, operation }) => {
  const record = data as Record<string, unknown>
  const projectionFields = ['payload', 'slot_key', 'position', 'dependency_hash', 'quality_result', 'risk_classes', 'visibility', 'renderer_version'] as const
  const projectionReady = projectionFields.every((field) => record[field] !== undefined && record[field] !== null)
  const projectionChanged = projectionFields.some((field) => record[field] !== undefined)
  if (operation === 'update' && !projectionChanged) {
    if (record.content_hash !== undefined) throw new Error('content_hash cannot be changed without strict module revalidation')
    return data
  }
  if (!projectionReady) throw new Error('projection-ready module envelopes require every strict projection field')
  const parsed = pageModuleSchema.parse({
    module_id: record.module_id,
    page_id: record.page_id,
    locale: record.locale,
    module_type: record.module_type,
    module_version: record.module_version,
    source_refs: record.source_refs,
    rights_state: record.rights_state,
    generated_by: record.generated_by,
    generator_version: record.generator_version ?? null,
    content_hash: record.content_hash,
    observed_at: record.observed_at,
    expires_at: record.expires_at ?? null,
    review_state: record.review_state,
    payload: record.payload,
    schema_version: 1,
  })
  return { ...data, payload: parsed.payload, content_hash: hashModule(parsed) }
}

export const ModuleEnvelopes: CollectionConfig = {
  slug: 'module-envelopes',
  admin: { useAsTitle: 'module_type' },
  access: collectionAccess('module-envelopes'),
  hooks: {
    beforeChange: [preventStableIdMutation, validateModuleEnvelopePayload],
    afterChange: [auditAfterChange('module-envelopes')],
    afterDelete: [auditAfterDelete('module-envelopes')],
  },
  indexes: [{ fields: ['page_id', 'locale', 'module_type', 'module_version'], unique: true }],
  fields: [
    ...productionFields(['active', 'blocked', 'stale'], 'active'),
    { name: 'module_id', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
    { name: 'page_id', type: 'text', required: true, index: true },
    { name: 'locale', type: 'select', required: true, options: localeOptions, index: true },
    {
      name: 'module_type',
      type: 'select',
      required: true,
      options: ['case', 'tutorial', 'prompt', 'comparison', 'faq', 'examples', 'provenance', 'action'],
    },
    { name: 'module_version', type: 'number', required: true, min: 1 },
    { name: 'payload', type: 'json' },
    { name: 'slot_key', type: 'text' },
    { name: 'position', type: 'number', min: 0 },
    { name: 'dependency_refs', type: 'relationship', relationTo: ['sources', 'module-envelopes'], hasMany: true },
    { name: 'dependency_hash', type: 'text', index: true },
    { name: 'quality_result', type: 'json' },
    { name: 'risk_classes', type: 'json' },
    { name: 'visibility', type: 'select', options: ['private', 'internal_preview', 'public'] },
    { name: 'renderer_version', type: 'text' },
    { name: 'stale_reason', type: 'textarea' },
    { name: 'source_refs', type: 'relationship', relationTo: 'sources', hasMany: true, required: true },
    {
      name: 'rights_state',
      type: 'select',
      required: true,
      options: ['unknown', 'metadata_only', 'display_licensed', 'redistribution_licensed', 'first_party', 'blocked', 'revoked'],
    },
    { name: 'content_hash', type: 'text', required: true, index: true },
    { name: 'generated_by', type: 'select', required: true, options: ['human', 'rule', 'rpa', 'llm'] },
    { name: 'generator_version', type: 'text' },
    { name: 'observed_at', type: 'date', required: true },
    { name: 'expires_at', type: 'date' },
    { name: 'review_state', type: 'select', required: true, options: ['candidate', 'approved', 'blocked', 'stale'] },
  ],
}
