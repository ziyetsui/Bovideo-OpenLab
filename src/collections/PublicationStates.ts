import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'

import { preventStableIdMutation, productionFields, requireCanonicalCommandFor } from './shared'

export const PublicationStates: CollectionConfig = {
  slug: 'publication-states',
  admin: { useAsTitle: 'publish_version' },
  access: collectionAccess('publication-states'),
  hooks: {
    beforeChange: [preventStableIdMutation, requireCanonicalCommandFor('publication')],
    afterChange: [auditAfterChange('publication-states')],
    afterDelete: [auditAfterDelete('publication-states')],
  },
  indexes: [{ fields: ['publish_version'], unique: true }],
  fields: [
    ...productionFields(['draft', 'preparing', 'validated', 'active', 'superseded', 'rolled_back', 'failed'], 'draft'),
    { name: 'publish_version', type: 'number', required: true, unique: true, index: true },
    { name: 'reason_code', type: 'text' },
    { name: 'activated_at', type: 'date' },
  ],
}
