import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'

import {
  localeOptions,
  preventStableIdMutation,
  productionFields,
  requireApprovedPageEvidence,
  requireCanonicalCommandFor,
} from './shared'

export const PageRecords: CollectionConfig = {
  slug: 'page-records',
  admin: { useAsTitle: 'intent' },
  access: collectionAccess('page-records'),
  hooks: {
    beforeChange: [preventStableIdMutation, requireApprovedPageEvidence, requireCanonicalCommandFor('page')],
    afterChange: [auditAfterChange('page-records')],
    afterDelete: [auditAfterDelete('page-records')],
  },
  indexes: [
    { fields: ['page_type', 'index_state'] },
    { fields: ['page_type', 'root_object_key', 'locale'], unique: true },
  ],
  fields: [
    ...productionFields(['active', 'retired'], 'active'),
    { name: 'page_type', type: 'select', required: true, index: true, options: ['hub', 'gallery', 'entity', 'detail'] },
    { name: 'locale', type: 'select', required: true, index: true, options: localeOptions },
    {
      name: 'root_object',
      type: 'relationship',
      required: true,
      relationTo: ['prompt-artifacts', 'taxonomy-nodes'],
    },
    {
      name: 'root_object_key',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true, description: 'Canonical typed root object identity for SQL uniqueness.' },
    },
    { name: 'intent', type: 'textarea', required: true },
    {
      name: 'primary_keyword_by_locale',
      type: 'array',
      fields: [
        { name: 'locale', type: 'select', required: true, options: localeOptions },
        { name: 'keyword', type: 'text', required: true },
      ],
    },
    { name: 'inventory', type: 'json', required: true },
    { name: 'demand_evidence', type: 'json' },
    { name: 'information_gain', type: 'json' },
    { name: 'qualification_score', type: 'json', required: true },
    { name: 'qualification_input_hash', type: 'text', required: true, index: true },
    { name: 'qualification_rule_version', type: 'text', required: true },
    { name: 'approval_edge', type: 'relationship', relationTo: 'edges' },
    { name: 'approval_evidence', type: 'relationship', relationTo: 'sources', hasMany: true },
    {
      name: 'index_state',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'not_generated',
      options: ['not_generated', 'discoverable_noindex', 'index_candidate', 'indexable', 'retired'],
    },
    { name: 'reason_codes', type: 'json' },
  ],
}
