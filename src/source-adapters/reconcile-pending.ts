import type { SourceWritePlane } from './checkpoint'
import type { RawEvidenceStore } from './types'

/** Ingest-only recovery of durable raw ingress markers; it exposes no public object capability. */
export const reconcilePendingRawEvidence = async (input: Readonly<{
  raw_store: RawEvidenceStore
  write_plane: SourceWritePlane
  now: string
  min_age_ms: number
  verify_raw: (candidate: Awaited<ReturnType<RawEvidenceStore['pendingRecoveryCandidates']>>[number]['ref']) => Promise<boolean>
}>): Promise<Readonly<{ committed: number; quarantined: number; retained: number }>> => {
  let committed = 0; let quarantined = 0; let retained = 0
  for (const candidate of await input.raw_store.pendingRecoveryCandidates()) {
    try {
      const oldEnough = Date.parse(input.now) - Date.parse(candidate.issued_at) >= input.min_age_ms
      const verified = oldEnough && await input.verify_raw(candidate.ref)
      const disposition = await input.write_plane.reconcilePendingRaw({ receipt_id: candidate.receipt_id, raw_ref: candidate.ref, raw_hash: candidate.ref.content_hash, correlation_id: candidate.correlation_id, eligible_for_orphan: oldEnough && verified })
      if (disposition === 'retained') { retained += 1; continue }
      await input.raw_store.markDisposition({ receipt_id: candidate.receipt_id, disposition })
      if (disposition === 'committed') committed += 1
      else quarantined += 1
    } catch { retained += 1 }
  }
  return Object.freeze({ committed, quarantined, retained })
}
