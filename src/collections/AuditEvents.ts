import type { CollectionConfig } from 'payload'

import { collectionAccess } from '@/access/payload-access'

import { preventFieldMutation, preventStableIdMutation, productionFields } from './shared'

export const AuditEvents: CollectionConfig = {
  slug: 'audit-events',
  admin: { useAsTitle: 'event_type' },
  access: collectionAccess('audit-events'),
  hooks: {
    beforeChange: [
      preventStableIdMutation,
      preventFieldMutation(['event_id']),
      ({ data, operation }) => {
        if (operation === 'update') throw new Error('audit events are append-only')
        return data
      },
    ],
    beforeDelete: [() => {
      throw new Error('audit events are append-only')
    }],
  },
  indexes: [
    { fields: ['correlation_id', 'occurred_at'] },
    { fields: ['occurred_at', 'actor_user'] },
    { fields: ['entity_type', 'entity_stable_id'] },
  ],
  fields: [
    ...productionFields(['recorded'], 'recorded'),
    { name: 'event_id', type: 'text', required: true, unique: true, index: true },
    { name: 'actor_user', type: 'relationship', relationTo: 'users' },
    { name: 'actor_type', type: 'select', required: true, options: ['user', 'service', 'anonymous'] },
    { name: 'actor_stable_id', type: 'text', required: true, index: true },
    { name: 'actor_service', type: 'text' },
    { name: 'correlation_id', type: 'text', required: true, index: true },
    { name: 'causation_id', type: 'text' },
    { name: 'event_type', type: 'text', required: true, index: true },
    { name: 'entity_type', type: 'text', required: true, index: true },
    { name: 'entity_stable_id', type: 'text', required: true, index: true },
    { name: 'outcome', type: 'select', required: true, options: ['allowed', 'denied', 'failed'] },
    { name: 'prior_state', type: 'json' },
    { name: 'new_state', type: 'json' },
    { name: 'reason_code', type: 'text' },
    { name: 'occurred_at', type: 'date', required: true, index: true },
  ],
}
