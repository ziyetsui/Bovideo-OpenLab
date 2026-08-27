import type { CollectionConfig } from 'payload'

import { auditAfterDelete, collectionAccess } from '@/access/payload-access'

import {
  localeOptions,
  localeAuditAfterChange,
  enforceLocaleServerMetadata,
  deriveLocaleSourceVersionOnCreate,
  enforceLocaleContentCommand,
  preventLocaleIdentityMutation,
  preventStableIdMutation,
  productionFields,
  requireCanonicalCommandFor,
} from './shared'

export const LocaleVariants: CollectionConfig = {
  slug: 'locale-variants',
  admin: { useAsTitle: 'locale' },
  access: collectionAccess('locale-variants'),
  hooks: {
    beforeChange: [
      preventStableIdMutation, deriveLocaleSourceVersionOnCreate,
      preventLocaleIdentityMutation,
      enforceLocaleContentCommand,
      enforceLocaleServerMetadata,
      requireCanonicalCommandFor('locale'),
    ],
    afterChange: [localeAuditAfterChange],
    afterDelete: [auditAfterDelete('locale-variants')],
  },
  indexes: [
    { fields: ['locale', 'workflow_state'] },
    { fields: ['entity_key', 'locale', 'source_version'], unique: true },
  ],
  fields: [
    ...productionFields(['active', 'withdrawn'], 'active'),
    {
      name: 'entity',
      type: 'relationship',
      required: true,
      relationTo: ['prompt-artifacts', 'taxonomy-nodes', 'page-records'],
    },
    { name: 'entity_key', type: 'text', required: true, index: true, admin: { readOnly: true } },
    { name: 'locale', type: 'select', required: true, index: true, options: localeOptions },
    { name: 'source_locale', type: 'select', required: true, options: localeOptions },
    { name: 'translation_model', type: 'text', required: true },
    { name: 'translation_prompt_version', type: 'text', required: true },
    { name: 'localized_fields', type: 'json', required: true },
    { name: 'content_revision', type: 'number', required: true, min: 1, index: true },
    {
      name: 'quality',
      type: 'group',
      fields: [
        { name: 'terminology_score', type: 'number', min: 0, max: 1 },
        { name: 'placeholder_integrity', type: 'select', options: ['pass', 'fail'] },
        { name: 'factual_consistency', type: 'select', options: ['pass', 'fail'] },
        { name: 'language_detection', type: 'select', options: ['pass', 'fail'] },
        { name: 'human_score', type: 'number', min: 1, max: 5 },
      ],
    },
    {
      name: 'workflow_state',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'missing',
      options: ['missing', 'machine_draft', 'review', 'approved', 'published', 'blocked', 'stale', 'withdrawn'],
    },
    { name: 'reviewed_by', type: 'relationship', relationTo: 'users' },
    { name: 'reviewed_by_stable_id', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'reviewed_revision', type: 'number', min: 1, admin: { readOnly: true } },
    {
      name: 'last_content_editor',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      validate: (value: unknown, { siblingData }: { siblingData?: unknown }) =>
        (siblingData as { is_money_page?: boolean } | undefined)?.is_money_page !== true || value !== undefined
          ? true
          : 'last_content_editor is required for a Money Page',
    },
    { name: 'last_content_editor_stable_id', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'is_money_page', type: 'checkbox', required: true, defaultValue: false, index: true },
    {
      name: 'risk_classes',
      type: 'select',
      hasMany: true,
      defaultValue: [],
      options: ['money', 'comparison', 'price', 'legal_rights'],
      index: true,
      admin: { readOnly: true },
    },
    { name: 'reviewed_at', type: 'date' },
    { name: 'published_version', type: 'number', min: 1 },
  ],
}
