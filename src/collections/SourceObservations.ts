import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete } from '@/access/payload-access'
import { objectRefSchema } from '@/storage/object-ref'
import { requireTrustedObjectRef } from '@/storage/payload-object-authority'

import { preventFieldMutation, preventStableIdMutation } from './shared'

/**
 * Append-only, private aliases for independently captured provider records.
 *
 * A Source is the canonical semantic fact (for X: one status ID).  An
 * observation is the provider-specific raw receipt that led to that fact.
 * Keeping them separate lets a public-search fallback prove what it observed
 * without creating a second semantic source, prompt, or media graph.
 */
export const SourceObservations: CollectionConfig = {
  slug: 'source-observations',
  admin: { useAsTitle: 'provider_record_id', hidden: true },
  access: { read: () => false },
  hooks: {
    beforeChange: [
      requireTrustedObjectRef('raw_ref'),
      preventStableIdMutation,
      preventFieldMutation([
        'source_ref', 'provider', 'provider_record_id', 'canonical_url',
        'raw_ref', 'captured_at', 'content_hash', 'workflow_run',
      ]),
    ],
    afterChange: [auditAfterChange('source-observations')],
    afterDelete: [auditAfterDelete('source-observations')],
  },
  indexes: [
    { fields: ['provider', 'provider_record_id', 'content_hash'], unique: true },
    { fields: ['source_ref', 'captured_at'] },
    { fields: ['workflow_run'] },
  ],
  fields: [
    { name: 'stable_id', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
    { name: 'revision', type: 'number', required: true, min: 1, defaultValue: 1, index: true },
    { name: 'schema_version', type: 'number', required: true, min: 1, defaultValue: 1 },
    { name: 'source_version', type: 'text', required: true, index: true },
    { name: 'source_ref', type: 'relationship', relationTo: 'sources', required: true, index: true },
    { name: 'workflow_run', type: 'relationship', relationTo: 'workflow-runs', required: true, index: true },
    { name: 'provider', type: 'text', required: true, index: true },
    { name: 'provider_record_id', type: 'text', required: true, index: true },
    { name: 'canonical_url', type: 'text', required: true },
    {
      name: 'raw_ref',
      type: 'json',
      required: true,
      access: { read: () => false },
      validate: (value, { siblingData }) => {
        const parsed = objectRefSchema.safeParse(value)
        const contentHash = (siblingData as { content_hash?: unknown }).content_hash
        return parsed.success && parsed.data.namespace === 'raw-evidence' && parsed.data.content_hash === contentHash
          ? true
          : 'raw_ref must be a canonical ObjectRef for private raw-evidence with the observation content hash'
      },
    },
    { name: 'captured_at', type: 'date', required: true, index: true },
    { name: 'content_hash', type: 'text', required: true, index: true },
  ],
}
