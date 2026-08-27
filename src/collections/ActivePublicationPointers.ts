import type { CollectionConfig } from 'payload'

import { auditAfterDelete, collectionAccess, pointerAuditAfterChange } from '@/access/payload-access'

import { preventPointerDelete, preventStableIdMutation, requirePointerCanonicalCommand } from './shared'
import { createUlid } from '@/access/ulid'

export const ActivePublicationPointers: CollectionConfig = {
  slug: 'active-publication-pointers',
  admin: { useAsTitle: 'singleton_key' },
  access: collectionAccess('active-publication-pointers'),
  hooks: {
    beforeChange: [preventStableIdMutation, requirePointerCanonicalCommand],
    beforeDelete: [preventPointerDelete],
    afterChange: [pointerAuditAfterChange],
    afterDelete: [auditAfterDelete('active-publication-pointers')],
  },
  indexes: [{ fields: ['singleton_key'], unique: true }],
  fields: [
    { name: 'stable_id', type: 'text', required: true, unique: true, index: true, defaultValue: createUlid, admin: { readOnly: true } },
    { name: 'revision', type: 'number', required: true, min: 0, defaultValue: 0, index: true, admin: { readOnly: true } },
    { name: 'singleton_key', type: 'text', required: true, unique: true, defaultValue: 'active-publication', admin: { readOnly: true } },
    { name: 'publish_version', type: 'number', min: 1 },
    { name: 'previous_verified_version', type: 'number', min: 1 },
  ],
}
