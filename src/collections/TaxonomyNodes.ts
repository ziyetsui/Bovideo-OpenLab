import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'

import { preventStableIdMutation, productionFields } from './shared'

export const TaxonomyNodes: CollectionConfig = {
  slug: 'taxonomy-nodes',
  admin: { useAsTitle: 'stable_key' },
  access: collectionAccess('taxonomy-nodes'),
  hooks: {
    beforeChange: [preventStableIdMutation],
    afterChange: [auditAfterChange('taxonomy-nodes')],
    afterDelete: [auditAfterDelete('taxonomy-nodes')],
  },
  indexes: [
    { fields: ['node_type', 'promotion_state'] },
    { fields: ['node_type', 'stable_key'], unique: true },
  ],
  fields: [
    ...productionFields(['active', 'retired'], 'active'),
    {
      name: 'node_type',
      type: 'select',
      required: true,
      index: true,
      options: ['output', 'model', 'use_case', 'style', 'technique', 'creator', 'subject'],
    },
    { name: 'stable_key', type: 'text', required: true, unique: true, index: true },
    { name: 'label', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'promotion_state',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'candidate',
      options: ['candidate', 'reviewed', 'qualified', 'retired'],
    },
    { name: 'evidence_refs', type: 'relationship', relationTo: 'sources', hasMany: true },
    { name: 'inventory_count', type: 'number', min: 0, defaultValue: 0, admin: { readOnly: true } },
  ],
}
