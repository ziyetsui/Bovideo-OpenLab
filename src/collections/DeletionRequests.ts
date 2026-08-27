import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'
import { relationRefSchema } from '@/contracts/common'

import { preventStableIdMutation, productionFields, requireCanonicalCommandFor } from './shared'

export const DeletionRequests: CollectionConfig = {
  slug: 'deletion-requests',
  admin: { useAsTitle: 'external_request_key' },
  access: collectionAccess('deletion-requests'),
  hooks: {
    beforeChange: [preventStableIdMutation, requireCanonicalCommandFor('deletion')],
    afterChange: [auditAfterChange('deletion-requests')],
    afterDelete: [auditAfterDelete('deletion-requests')],
  },
  indexes: [{ fields: ['external_request_key'], unique: true }],
  fields: [
    ...productionFields(['received', 'validated', 'withdrawing', 'surfaces_pending', 'completed', 'rejected', 'cancelled'], 'received'),
    { name: 'external_request_key', type: 'text', required: true, unique: true },
    { name: 'scope', type: 'select', required: true, options: ['source', 'artifact', 'locale', 'page', 'export'] },
    { name: 'requested_by', type: 'relationship', relationTo: 'users', required: true },
    { name: 'legal_basis', type: 'textarea', required: true },
    {
      name: 'object_refs',
      type: 'json',
      required: true,
      validate: (value) =>
        Array.isArray(value) && value.length > 0 && value.every((entry) => relationRefSchema.safeParse(entry).success)
          ? true
          : 'object_refs must be a non-empty array of canonical typed relation references',
    },
    { name: 'deadline', type: 'date' },
    { name: 'reason_code', type: 'text', required: true },
  ],
}
