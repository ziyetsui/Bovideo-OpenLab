import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'
import { GRAPH_RELATIONS } from '@/contracts/graph'

import { normalizeEdgeRelationBeforeValidate } from './edge-relation-normalization'
import { preventStableIdMutation, productionFields } from './shared'

export const Edges: CollectionConfig = {
  slug: 'edges',
  admin: { useAsTitle: 'relation' },
  access: collectionAccess('edges'),
  hooks: {
    beforeValidate: [normalizeEdgeRelationBeforeValidate],
    beforeChange: [preventStableIdMutation],
    afterChange: [auditAfterChange('edges')],
    afterDelete: [auditAfterDelete('edges')],
  },
  indexes: [
    { fields: ['relation', 'review_state'] },
    { fields: ['from_key', 'relation', 'to_key', 'source_version'], unique: true },
  ],
  fields: [
    ...productionFields(['active', 'retired'], 'active'),
    {
      name: 'from',
      type: 'relationship',
      required: true,
      relationTo: ['sources', 'prompt-artifacts', 'taxonomy-nodes'],
    },
    { name: 'from_key', type: 'text', required: true, index: true, admin: { readOnly: true } },
    {
      name: 'relation',
      type: 'select',
      required: true,
      index: true,
      options: [...GRAPH_RELATIONS],
    },
    { name: 'legacy_relation_label', type: 'text', admin: { readOnly: true } },
    { name: 'relation_migration_state', type: 'select', admin: { readOnly: true }, options: ['canonical', 'requires_review'] },
    {
      name: 'to',
      type: 'relationship',
      required: true,
      relationTo: ['sources', 'prompt-artifacts', 'taxonomy-nodes'],
    },
    { name: 'to_key', type: 'text', required: true, index: true, admin: { readOnly: true } },
    { name: 'evidence', type: 'relationship', required: true, relationTo: 'sources', hasMany: true },
    { name: 'confidence', type: 'number', required: true, min: 0, max: 1 },
    {
      name: 'review_state',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'candidate',
      options: ['candidate', 'approved', 'rejected'],
    },
    { name: 'valid_from', type: 'date' },
    { name: 'valid_to', type: 'date' },
  ],
}
