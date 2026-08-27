import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { auditAfterChange } from '@/access/payload-access'
import { hasInternalProjectionPublicationCapability } from '@/publication/payload-projection-command'

const rejectUntrustedBinding: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation !== 'create') throw new Error('publication projection bindings are append-only')
  if (!hasInternalProjectionPublicationCapability(req.context))
    throw new Error('publication projection bindings require a trusted internal publication command')
  const record = data as Record<string, unknown>
  if (record.internal_noindex !== true) throw new Error('local publication bindings must remain noindex')
  return data
}

/** Immutable route-level binding from a publication version to an exact projection. */
export const PublicationProjections: CollectionConfig = {
  slug: 'publication-projections',
  admin: { useAsTitle: 'route', hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: {
    beforeChange: [rejectUntrustedBinding],
    afterChange: [auditAfterChange('publication-projections' as never)],
    beforeDelete: [() => { throw new Error('publication projection bindings are append-only') }],
  },
  indexes: [
    { fields: ['publish_version', 'locale', 'family', 'route'], unique: true },
    { fields: ['publish_version', 'projection'], unique: true },
  ],
  fields: [
    { name: 'publish_version', type: 'number', required: true, min: 1, index: true },
    { name: 'projection', type: 'relationship', relationTo: 'page-projections', required: true, index: true },
    { name: 'route', type: 'text', required: true, index: true },
    { name: 'locale', type: 'select', required: true, options: ['en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'sv', 'tr', 'zh-CN', 'zh-TW', 'ar'], index: true },
    { name: 'family', type: 'select', required: true, options: ['hub', 'gallery', 'entity', 'detail'], index: true },
    { name: 'internal_noindex', type: 'checkbox', required: true, defaultValue: true },
  ],
}
