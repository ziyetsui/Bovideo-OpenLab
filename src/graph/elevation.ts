import { createHash } from 'node:crypto'

import type { GraphRelation } from '@/contracts/graph'

import { evidenceRevisionHash, validateCandidateProvenance } from './provenance'

/** The only state an automated graph producer may assign. Review owns promotion. */
export const GRAPH_CANDIDATE_REVIEW_STATE = 'candidate' as const
export type GraphCandidateReviewState = typeof GRAPH_CANDIDATE_REVIEW_STATE

/** Locale-independent UTF-8 ordering for persisted graph candidate material. */
export const compareGraphBytes = (left: string, right: string): number => {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!
    if (difference !== 0) return difference
  }
  return leftBytes.length - rightBytes.length
}

export type GraphRightsState = 'unknown' | 'metadata_only' | 'display_licensed' | 'redistribution_licensed' | 'first_party' | 'blocked' | 'revoked'
export type GraphArtifactInput = Readonly<{
  artifactId: string
  sourceId: string
  sourceVersion: string
  rightsState: GraphRightsState
  safetyState: 'pending' | 'approved' | 'blocked'
}>
export type GraphSourceEvidence = Readonly<{
  sourceId: string
  revision: string
  rightsState: GraphRightsState
  available: boolean
}>
export type CandidateEvidenceRef = Readonly<{ sourceId: string; revision: string }>
export type CandidateEdge = Readonly<{
  id: string
  revision: number
  fromArtifactId: string
  toArtifactId: string
  relation: GraphRelation
  evidenceRefs: readonly CandidateEvidenceRef[]
  confidence: number
  reviewState: 'candidate' | 'approved' | 'rejected'
  proposerId: string
  evidenceRevision: string
  safetyState: 'pending' | 'approved' | 'blocked'
  rightsState: GraphRightsState
}>
export type CandidateNode = Readonly<{
  id: string
  revision: number
  nodeType: 'output' | 'model' | 'use_case' | 'style' | 'technique' | 'creator' | 'subject'
  stableKey: string
  label: string
  description: string
  evidenceRefs: readonly CandidateEvidenceRef[]
  confidence: number
  reviewState: 'candidate' | 'approved' | 'rejected'
  promotionState: 'candidate' | 'reviewed' | 'qualified' | 'retired'
  proposerId: string
  evidenceRevision: string
  safetyState: 'pending' | 'approved' | 'blocked'
  rightsState: GraphRightsState
}>

export class GraphElevationError extends Error {
  readonly code: 'missing_evidence' | 'rights_blocked' | 'unsafe_artifact' | 'evidence_revision_mismatch'
  constructor(code: GraphElevationError['code']) {
    super(`graph elevation rejected: ${code}`)
    this.name = 'GraphElevationError'
    this.code = code
  }
}

const stableId = (value: string): string => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16]!, 16) % 4]!
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

export type GraphElevationOptions = Readonly<{
  artifacts: () => readonly GraphArtifactInput[]
  sources: () => readonly GraphSourceEvidence[]
  candidateSink?: Readonly<{ append: (edge: CandidateEdge) => Promise<void> | void }>
}>

export class GraphElevationService {
  readonly #options: GraphElevationOptions
  constructor(options: GraphElevationOptions) { this.#options = options }

  async elevate(input: Readonly<{
    fromArtifactId: string
    toArtifactId: string
    relation: CandidateEdge['relation']
    confidence: number
  }>): Promise<CandidateEdge> {
    const artifacts = this.#options.artifacts()
    const from = artifacts.find((artifact) => artifact.artifactId === input.fromArtifactId)
    const to = artifacts.find((artifact) => artifact.artifactId === input.toArtifactId)
    if (from === undefined || to === undefined) throw new GraphElevationError('missing_evidence')
    if (from.safetyState === 'blocked' || to.safetyState === 'blocked') throw new GraphElevationError('unsafe_artifact')
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new GraphElevationError('unsafe_artifact')
    const sourceMap = new Map(this.#options.sources().map((source) => [source.sourceId, source]))
    const sourceEvidence = [sourceMap.get(from.sourceId), sourceMap.get(to.sourceId)]
    if (sourceEvidence.some((source) => source === undefined)) throw new GraphElevationError('missing_evidence')
    if (sourceEvidence[0] !== undefined && sourceEvidence[0].revision !== from.sourceVersion || sourceEvidence[1] !== undefined && sourceEvidence[1].revision !== to.sourceVersion) throw new GraphElevationError('evidence_revision_mismatch')
    if (sourceEvidence.some((source) => source !== undefined && ['blocked', 'revoked', 'unknown'].includes(source.rightsState))) throw new GraphElevationError('rights_blocked')
    const evidenceRefs = sourceEvidence
      .filter((source): source is GraphSourceEvidence => source !== undefined)
      .map((source) => ({ sourceId: source.sourceId, revision: source.revision }))
      .sort((left, right) => compareGraphBytes(left.sourceId, right.sourceId))
    const edge: CandidateEdge = Object.freeze({
      id: stableId(`${input.fromArtifactId}:${input.toArtifactId}:${input.relation}:${evidenceRefs.map((ref) => `${ref.sourceId}:${ref.revision}`).join('|')}`),
      revision: 1,
      fromArtifactId: input.fromArtifactId,
      toArtifactId: input.toArtifactId,
      relation: input.relation,
      evidenceRefs: Object.freeze(evidenceRefs),
      confidence: input.confidence,
      reviewState: GRAPH_CANDIDATE_REVIEW_STATE,
      proposerId: 'elevation-service',
      evidenceRevision: evidenceRevisionHash(sourceEvidence.filter((source): source is GraphSourceEvidence => source !== undefined)),
      safetyState: from.safetyState === 'approved' && to.safetyState === 'approved' ? 'approved' : 'pending',
      rightsState: sourceEvidence.every((source) => source?.rightsState === 'first_party') ? 'first_party' : 'metadata_only',
    })
    validateCandidateProvenance(edge, this.#options.sources())
    await this.#options.candidateSink?.append(edge)
    return edge
  }
}
