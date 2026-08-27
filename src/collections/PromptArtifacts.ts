import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'

import { preventPromptOriginalTextMutation, preventStableIdMutation, productionFields } from './shared'

export const PromptArtifacts: CollectionConfig = {
  slug: 'prompt-artifacts',
  admin: { useAsTitle: 'canonical_label' },
  access: collectionAccess('prompt-artifacts'),
  hooks: {
    beforeChange: [preventStableIdMutation, preventPromptOriginalTextMutation],
    afterChange: [auditAfterChange('prompt-artifacts')],
    afterDelete: [auditAfterDelete('prompt-artifacts')],
  },
  indexes: [{ fields: ['source', 'kind', 'source_version'], unique: true }],
  fields: [
    ...productionFields(['draft', 'review', 'approved', 'published', 'blocked', 'withdrawn'], 'draft'),
    { name: 'kind', type: 'select', required: true, options: ['prompt', 'workflow', 'comparison'] },
    { name: 'canonical_label', type: 'text', required: true, index: true },
    {
      name: 'prompt',
      type: 'group',
      fields: [
        { name: 'original_text', type: 'textarea', required: true },
        {
          name: 'variables',
          type: 'array',
          fields: [
            { name: 'token', type: 'text', required: true },
            { name: 'description', type: 'text' },
            { name: 'allowed_values', type: 'json' },
            { name: 'occurrences', type: 'number', min: 0 },
          ],
        },
      ],
    },
    { name: 'original_language', type: 'text', required: true, defaultValue: 'en' },
    {
      name: 'outcome',
      type: 'group',
      fields: [
        { name: 'media_type', type: 'select', options: ['image', 'video', 'unresolved'] },
        { name: 'summary', type: 'textarea' },
        { name: 'capability', type: 'text' },
      ],
    },
    {
      name: 'inputs',
      type: 'group',
      fields: [
        { name: 'required', type: 'json' },
        { name: 'optional', type: 'json' },
      ],
    },
    { name: 'parameters', type: 'json' },
    { name: 'examples', type: 'json' },
    { name: 'workflow_steps', type: 'json' },
    { name: 'signals', type: 'json' },
    { name: 'source', type: 'relationship', required: true, relationTo: 'sources', index: true },
    { name: 'model_refs', type: 'relationship', relationTo: 'taxonomy-nodes', hasMany: true },
    { name: 'taxonomy_refs', type: 'relationship', relationTo: 'taxonomy-nodes', hasMany: true },
    { name: 'variation_refs', type: 'relationship', relationTo: 'prompt-artifacts', hasMany: true },
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
      name: 'safety_state',
      type: 'select',
      required: true,
      options: ['pending', 'approved', 'blocked'],
    },
    {
      name: 'evidence_state',
      type: 'select',
      required: true,
      options: ['pending', 'verified', 'insufficient'],
    },
  ],
}
