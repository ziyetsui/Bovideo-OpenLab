import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { immutableIdSchema, versionedHashSchema } from '@/contracts/common'
import { principalFromPayloadUser } from '@/access/principals'
import { auditAfterChange, collectionAccess } from '@/access/payload-access'
import { createUlid } from '@/access/ulid'
import { recordStructuredEvent, requestObservationContext, structuredLogSinkFromRequest } from '@/observability/events'

import { preventStableIdMutation } from './shared'

const approvalImmutableFields = [
  'baseline_manifest_hash',
  'candidate_manifest_hash',
  'evaluator_version',
  'reviewer_actor_id',
  'correlation_id',
  'approved_at',
  'audit_ref',
  'audit_outcome',
] as const

const approvalError = (message: string): APIError<{ field: string }> =>
  new APIError(message, 400, { field: 'golden_replacement_approval' })

/**
 * Golden replacements are append-only approval facts.  The reviewer identity,
 * approval timestamp, and audit reference are derived from the authenticated
 * Payload user; clients cannot self-assign reviewer authority.
 */
export const validateGoldenReplacementApproval: CollectionBeforeChangeHook = ({
  data,
  operation,
  req,
}) => {
  if (operation === 'update') throw approvalError('golden replacement approvals are immutable')
  if (operation !== 'create') return data

  const principal = principalFromPayloadUser(req.user)
  if (principal.kind !== 'user' || !principal.roles.includes('reviewer'))
    throw approvalError('only an authenticated reviewer may approve a golden replacement')

  const changed = data as Record<string, unknown>
  // Immutable mutations are rejected by the operation discriminator. Payload
  // may populate `originalDoc` during create normalization, so it is not a
  // reliable existing-record signal on this lifecycle path.
  const requiredText: ReadonlyArray<[string, unknown]> = [
    ['baseline_manifest_hash', changed.baseline_manifest_hash],
    ['candidate_manifest_hash', changed.candidate_manifest_hash],
    ['evaluator_version', changed.evaluator_version],
    ['correlation_id', changed.correlation_id],
  ]
  for (const [field, value] of requiredText) {
    if (typeof value !== 'string' || value.trim().length === 0) throw approvalError(`${field} is required`)
  }
  if (!versionedHashSchema.safeParse(changed.baseline_manifest_hash).success)
    throw approvalError('baseline_manifest_hash must be a versioned SHA-256 hash')
  if (!versionedHashSchema.safeParse(changed.candidate_manifest_hash).success)
    throw approvalError('candidate_manifest_hash must be a versioned SHA-256 hash')
  if (!immutableIdSchema.safeParse(changed.correlation_id).success)
    throw approvalError('correlation_id must be an immutable ID')
  // Actor identity is server-derived. Ignore a caller-provided value rather
  // than allowing the request body to select the reviewer recorded in the
  // durable approval fact.
  if (changed.reviewer_role !== undefined && changed.reviewer_role !== 'reviewer')
    throw approvalError('reviewer_role must be reviewer')
  if (changed.audit_outcome !== undefined && changed.audit_outcome !== 'allowed')
    throw approvalError('golden replacement approval outcome must be allowed')
  if (changed.approved_at !== undefined)
    throw approvalError('approved_at is server-derived')

  const correlationId = String(changed.correlation_id)
  // These values are intentionally optional in Payload's GraphQL input so a
  // reviewer can submit only approval facts. They are assigned here, after
  // authenticated principal validation, and therefore cannot be client-owned.
  changed.stable_id = createUlid()
  changed.revision = 1
  changed.schema_version = 1
  changed.status = 'recorded'
  changed.reviewer_actor_id = principal.id
  changed.reviewer_role = 'reviewer'
  changed.reviewer_user = principal.payloadUserId
  changed.approved_at = changed.approved_at ?? new Date().toISOString()
  changed.audit_outcome = 'allowed'
  changed.audit_ref = `golden-replacement-approval:${correlationId}`
  changed.audit = {
    created_by: principal.payloadUserId,
    updated_by: principal.payloadUserId,
    correlation_id: correlationId,
  }
  changed.source_version = changed.candidate_manifest_hash
  recordStructuredEvent(structuredLogSinkFromRequest(req), {
    event_name: 'localization.golden_approval',
    context: requestObservationContext(req, correlationId),
    refs: { baseline_manifest_hash: String(changed.baseline_manifest_hash), candidate_manifest_hash: String(changed.candidate_manifest_hash), approval_ref: String(changed.audit_ref) },
    metadata: { evaluator_version: String(changed.evaluator_version), outcome: 'allowed' },
  })
  return changed
}

export const GoldenReplacementApprovals: CollectionConfig = {
  slug: 'golden-replacement-approvals',
  admin: { useAsTitle: 'candidate_manifest_hash' },
  access: collectionAccess('golden-replacement-approvals'),
  hooks: {
    beforeChange: [preventStableIdMutation, validateGoldenReplacementApproval],
    afterChange: [auditAfterChange('golden-replacement-approvals')],
    beforeDelete: [() => {
      throw approvalError('golden replacement approvals are append-only')
    }],
  },
  indexes: [
    { fields: ['baseline_manifest_hash', 'candidate_manifest_hash', 'evaluator_version'], unique: true },
    { fields: ['correlation_id'], unique: true },
  ],
  fields: [
    // Server-derived fields must not be GraphQL-required: generated mutation
    // inputs are validated before beforeChange can derive their durable values.
    { name: 'stable_id', type: 'text', unique: true, index: true, admin: { readOnly: true } },
    { name: 'revision', type: 'number', min: 1, index: true, admin: { readOnly: true } },
    { name: 'schema_version', type: 'number', min: 1, admin: { readOnly: true } },
    { name: 'source_version', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'status', type: 'select', index: true, options: ['recorded'], admin: { readOnly: true } },
    {
      name: 'audit', type: 'group', admin: { readOnly: true }, fields: [
        { name: 'created_by', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
        { name: 'updated_by', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
        { name: 'correlation_id', type: 'text', index: true, admin: { readOnly: true } },
      ],
    },
    { name: 'baseline_manifest_hash', type: 'text', required: true, index: true },
    { name: 'candidate_manifest_hash', type: 'text', required: true, index: true },
    { name: 'evaluator_version', type: 'text', required: true, index: true },
    { name: 'reviewer_user', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
    { name: 'reviewer_actor_id', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'reviewer_role', type: 'select', options: ['reviewer'], admin: { readOnly: true } },
    { name: 'correlation_id', type: 'text', required: true, unique: true, index: true },
    { name: 'approved_at', type: 'date', admin: { readOnly: true } },
    { name: 'audit_ref', type: 'text', unique: true, admin: { readOnly: true } },
    { name: 'audit_outcome', type: 'select', options: ['allowed'], admin: { readOnly: true } },
  ],
}

export { approvalImmutableFields }
