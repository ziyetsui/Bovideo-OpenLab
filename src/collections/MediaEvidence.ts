import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete } from '@/access/payload-access'
import { versionedHashSchema } from '@/contracts/common'
import { mediaEvidenceSchema } from '@/contracts/projection'

/** Parse and retain only strict evidence policy facts at the Payload boundary. */
export const validateMediaEvidence: CollectionBeforeChangeHook = ({ data, operation, originalDoc }) => {
  const incoming = (data ?? {}) as Record<string, unknown>
  const evidenceFields = [
    'media_evidence_id', 'source_ref', 'provider', 'provider_media_id',
    'media_type', 'width', 'height', 'duration_ms', 'remote_url',
    'thumbnail_url', 'observed_at', 'rights_state', 'sensitive_content_state',
    'content_hash', 'visibility', 'delivery_target', 'preview_noindex',
    'attribution_url', 'source_version', 'workflow_run',
  ]
  const requiresValidation = operation === 'create' || evidenceFields.some((field) => incoming[field] !== undefined)

  // Existing pre-provenance rows remain untouched unless an evidence or
  // provenance fact changes. This preserves the nullable migration bridge
  // without allowing changed rows to bypass the complete write boundary.
  if (!requiresValidation) return data

  const merged = { ...(originalDoc as Record<string, unknown> | undefined), ...incoming }
  // Payload materializes these server-managed timestamps before collection
  // hooks. They are not evidence facts and the strict contract must not parse
  // them as client-provided fields.
  const { id: _id, source_version, workflow_run, createdAt: _createdAt, updatedAt: _updatedAt, ...evidence } = merged
  if (!versionedHashSchema.safeParse(source_version).success || workflow_run === undefined || workflow_run === null)
    throw new Error('media evidence provenance requires source_version and workflow_run')
  const parsed = mediaEvidenceSchema.parse(evidence)
  return { ...incoming, ...parsed, source_version, workflow_run }
}

/**
 * Private provenance for remote media. This collection deliberately has no
 * upload configuration and its remote URLs cannot be read through Payload.
 */
export const MediaEvidence: CollectionConfig = {
  slug: 'media-evidence',
  admin: { useAsTitle: 'provider_media_id', hidden: true },
  access: { read: () => false },
  hooks: {
    beforeChange: [validateMediaEvidence],
    afterChange: [auditAfterChange('media-evidence')],
    afterDelete: [auditAfterDelete('media-evidence')],
  },
  indexes: [{ fields: ['provider', 'provider_media_id'], unique: true }],
  fields: [
    { name: 'media_evidence_id', type: 'text', required: true, unique: true, index: true },
    { name: 'source_ref', type: 'relationship', relationTo: 'sources', required: true, index: true },
    { name: 'source_version', type: 'text', required: true, index: true },
    { name: 'workflow_run', type: 'relationship', relationTo: 'workflow-runs', required: true, index: true },
    { name: 'provider', type: 'select', required: true, options: ['x', 'approved_cdn', 'first_party'] },
    { name: 'provider_media_id', type: 'text', required: true, index: true },
    { name: 'media_type', type: 'select', required: true, options: ['image', 'video'] },
    { name: 'width', type: 'number', min: 1 },
    { name: 'height', type: 'number', min: 1 },
    { name: 'duration_ms', type: 'number', min: 0 },
    { name: 'remote_url', type: 'text', required: true, access: { read: () => false } },
    { name: 'thumbnail_url', type: 'text', access: { read: () => false } },
    { name: 'observed_at', type: 'date', required: true, index: true },
    { name: 'rights_state', type: 'select', required: true, options: ['unknown', 'metadata_only', 'display_licensed', 'redistribution_licensed', 'first_party', 'blocked', 'revoked'] },
    { name: 'sensitive_content_state', type: 'select', required: true, options: ['unknown', 'allowed', 'restricted', 'blocked'] },
    { name: 'content_hash', type: 'text', required: true, index: true },
    { name: 'visibility', type: 'select', required: true, options: ['private_evidence', 'internal_preview', 'public'] },
    { name: 'delivery_target', type: 'select', required: true, options: ['private_reference', 'x_cdn', 'approved_public_cdn'] },
    { name: 'preview_noindex', type: 'checkbox', required: true, defaultValue: true },
    { name: 'attribution_url', type: 'text', access: { read: () => false } },
  ],
}
