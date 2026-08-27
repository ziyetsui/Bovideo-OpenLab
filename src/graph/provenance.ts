import type { CandidateEdge, GraphSourceEvidence } from './elevation'
import { createHash } from 'node:crypto'

export type ProvenanceFailureCode = 'missing_evidence' | 'rights_blocked' | 'evidence_revision_mismatch'

export class ProvenanceError extends Error {
  readonly code: ProvenanceFailureCode
  constructor(code: ProvenanceFailureCode) {
    super(`candidate provenance rejected: ${code}`)
    this.name = 'ProvenanceError'
    this.code = code
  }
}

const blockedRights = new Set(['blocked', 'revoked', 'unknown'])

export const validateCandidateProvenance = (edge: CandidateEdge, sources: readonly GraphSourceEvidence[]): void => {
  if (edge.evidenceRefs.length === 0) throw new ProvenanceError('missing_evidence')
  const byId = new Map(sources.map((source) => [source.sourceId, source]))
  for (const ref of edge.evidenceRefs) {
    const source = byId.get(ref.sourceId)
    if (source === undefined || !source.available) throw new ProvenanceError('missing_evidence')
    if (blockedRights.has(source.rightsState)) throw new ProvenanceError('rights_blocked')
    if (source.revision !== ref.revision) throw new ProvenanceError('evidence_revision_mismatch')
  }
}

export const evidenceRevisionHash = (sources: readonly GraphSourceEvidence[]): string =>
  `sha256:v1:${createHash('sha256').update(sources.map((source) => `${source.sourceId}:${source.revision}`).sort().join('|')).digest('hex')}`
