import type { DetailProvenance } from './schema'

export type DetailEvidence = Readonly<{
  sourceRefs: readonly string[]
  provenance: DetailProvenance
  observedAt?: string
  revision?: number
  currentRevision?: number
  available?: boolean
}>

export class DetailProvenanceError extends Error {
  readonly code: 'missing_source' | 'unavailable_mismatch' | 'stale_revision' | 'candidate_not_approved'
  constructor(code: DetailProvenanceError['code']) {
    super(`detail provenance rejected: ${code}`)
    this.name = 'DetailProvenanceError'
    this.code = code
  }
}

/**
 * Factual modules must carry at least one evidence reference. Missing data is
 * represented explicitly instead of being filled by a renderer or translator.
 */
export const assertDetailProvenance = (evidence: DetailEvidence): void => {
  if (!Array.isArray(evidence.sourceRefs) || evidence.sourceRefs.length === 0)
    throw new DetailProvenanceError('missing_source')
  if (evidence.provenance === 'unavailable' && evidence.available === true)
    throw new DetailProvenanceError('unavailable_mismatch')
  if (evidence.provenance !== 'unavailable' && evidence.available === false)
    throw new DetailProvenanceError('unavailable_mismatch')
  if (evidence.provenance === 'candidate' && evidence.revision !== undefined && evidence.currentRevision !== undefined && evidence.revision !== evidence.currentRevision)
    throw new DetailProvenanceError('stale_revision')
}

export const provenanceLabel = (provenance: DetailProvenance): string => ({
  explicit: 'Explicit source evidence',
  inferred: 'Inferred from approved evidence',
  unavailable: 'Not available from approved evidence',
  candidate: 'Candidate relation — not yet approved',
}[provenance])

