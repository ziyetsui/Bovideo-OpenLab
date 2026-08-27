import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'
import { objectRefSchema } from '@/storage/object-ref'
import { requireTrustedObjectRef } from '@/storage/payload-object-authority'
import { staleLocalesForNewSourceRevision } from '@/localization/source-stale'

import {
  preventFieldMutation,
  preventStableIdMutation,
  productionFields,
  requireCanonicalCommandFor,
} from './shared'

export const Sources: CollectionConfig = {
  slug: 'sources',
  admin: { useAsTitle: 'provider_record_id' },
  access: collectionAccess('sources'),
  hooks: {
    beforeChange: [
      requireTrustedObjectRef('raw_ref'),
      preventStableIdMutation,
      preventFieldMutation(['raw_ref', 'content_hash', 'captured_at', 'semantic_key']),
      requireCanonicalCommandFor('source'),
    ],
    afterChange: [async (args) => {
      const { doc, operation, req } = args
      await auditAfterChange('sources')(args)
      if (operation === 'create') await staleLocalesForNewSourceRevision({
        payload: req.payload,
        req,
        source: doc as never,
        correlation_id: globalThis.crypto.randomUUID(),
      })
      return doc
    }],
    afterDelete: [auditAfterDelete('sources')],
  },
  indexes: [
    { fields: ['provider', 'provider_record_id', 'content_hash'], unique: true },
    { fields: ['semantic_key'], unique: true },
    { fields: ['rights_state', 'deletion_state'] },
  ],
  fields: [
    ...productionFields(['active', 'superseded', 'removed'], 'active'),
    {
      name: 'provider',
      type: 'select',
      required: true,
      index: true,
      options: ['twitter241', 'x_public_search', 'first_party', 'submission', 'official_doc'],
    },
    { name: 'provider_record_id', type: 'text', required: true, index: true },
    /** Provider-neutral key for a semantic fact. X status IDs share x-status:<id>. */
    { name: 'semantic_key', type: 'text', index: true },
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
          : 'raw_ref must be a canonical ObjectRef for private raw-evidence with the source content hash'
      },
    },
    { name: 'captured_at', type: 'date', required: true, index: true },
    { name: 'content_hash', type: 'text', required: true, index: true },
    { name: 'author_ref', type: 'relationship', relationTo: 'taxonomy-nodes' },
    {
      name: 'rights_state',
      type: 'select',
      required: true,
      index: true,
      options: [
        'unknown',
        'metadata_only',
        'display_licensed',
        'redistribution_licensed',
        'first_party',
        'blocked',
        'revoked',
      ],
    },
    {
      name: 'rights_basis',
      type: 'textarea',
      validate: (value, { siblingData }) => {
        const rightsState = (siblingData as { rights_state?: string }).rights_state
        if (
          (rightsState === 'display_licensed' ||
            rightsState === 'redistribution_licensed' ||
            rightsState === 'first_party') &&
          !value?.trim()
        ) {
          return 'rights_basis is required for licensed or first_party content'
        }
        return true
      },
    },
    {
      name: 'deletion_state',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'active',
      options: ['active', 'requested', 'removed'],
    },
  ],
}
