import type { Payload } from 'payload'

import type { GoldenApprovalLookup } from './golden-set'

/** Adapts the Payload PostgreSQL collection to the server-owned lookup contract. */
export const createPayloadGoldenApprovalLookup = (payload: Payload): GoldenApprovalLookup => ({
  findApprovedGoldenReplacement: async ({ baseline_manifest_hash, candidate_manifest_hash, evaluator_version }) => {
    const result = await payload.find({
      collection: 'golden-replacement-approvals',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [
          { baseline_manifest_hash: { equals: baseline_manifest_hash } },
          { candidate_manifest_hash: { equals: candidate_manifest_hash } },
          { evaluator_version: { equals: evaluator_version } },
          { audit_outcome: { equals: 'allowed' } },
        ],
      },
    })
    const persisted = result.docs[0]
    if (!persisted) return null
    // Payload documents also contain storage/audit columns. Project only the
    // signed approval facts so the strict domain schema cannot be bypassed by
    // persistence metadata and cannot accidentally trust client fields.
    return {
      baseline_manifest_hash: persisted.baseline_manifest_hash,
      candidate_manifest_hash: persisted.candidate_manifest_hash,
      evaluator_version: persisted.evaluator_version,
      reviewer_actor_id: persisted.reviewer_actor_id,
      reviewer_role: persisted.reviewer_role,
      correlation_id: persisted.correlation_id,
      approved_at: persisted.approved_at,
      audit_ref: persisted.audit_ref,
      audit_outcome: persisted.audit_outcome,
    }
  },
})
