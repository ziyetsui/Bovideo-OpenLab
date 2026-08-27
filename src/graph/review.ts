import type { CandidateEdge, CandidateNode } from './elevation'
import { validateCandidateProvenance, ProvenanceError, evidenceRevisionHash } from './provenance'
import type { GraphSourceEvidence } from './elevation'

export type ReviewEdge = Readonly<Pick<CandidateEdge, 'id' | 'revision' | 'proposerId' | 'reviewState' | 'evidenceRefs' | 'rightsState' | 'evidenceRevision' | 'safetyState'>>
export type CandidateEdgeReviewCommand = Readonly<{
  edgeId: string
  expectedRevision: number
  reviewer: Readonly<{ id: string; role: string }>
  decision: 'approve' | 'reject'
}>
export type ReviewResult = Readonly<ReviewEdge & { auditId: string }>
export type EdgeStore = Readonly<{
  read: (edgeId: string) => Promise<ReviewEdge | undefined>
  transact: <T>(expectedRevision: number, operation: (current: ReviewEdge) => Promise<T>) => Promise<Readonly<{ committed: true; value: T } | { committed: false }>>
}>
export type ReviewAuditSink = Readonly<{ append: (audit: Readonly<Record<string, unknown>>) => Promise<void> | void }>

export class CandidateEdgeReviewError extends Error {
  readonly code: 'missing_edge' | 'stale_revision' | 'unauthorized' | 'self_review' | 'missing_evidence' | 'rights_blocked' | 'safety_blocked' | 'already_reviewed' | 'audit_failed'
  constructor(code: CandidateEdgeReviewError['code']) {
    super(`candidate edge review rejected: ${code}`)
    this.name = 'CandidateEdgeReviewError'
    this.code = code
  }
}

const authorizedRoles = new Set(['reviewer'])
const blockedRights = new Set(['blocked', 'revoked', 'unknown'])
const auditId = (edgeId: string, revision: number): string => `audit:${edgeId}:${revision}`

export class CandidateEdgeReviewService {
  readonly #edgeStore: EdgeStore
  readonly #auditSink: ReviewAuditSink
  readonly #now: () => string
  readonly #sources?: () => readonly GraphSourceEvidence[]
  readonly #resolveReviewer?: (reviewer: Readonly<{ id: string; role: string }>) => Readonly<{ id: string; role: string }> | null
  constructor(input: Readonly<{ edgeStore: EdgeStore; auditSink: ReviewAuditSink; now: () => string; sources?: () => readonly GraphSourceEvidence[]; resolveReviewer?: (reviewer: Readonly<{ id: string; role: string }>) => Readonly<{ id: string; role: string }> | null }>) {
    this.#edgeStore = input.edgeStore
    this.#auditSink = input.auditSink
    this.#now = input.now
    this.#sources = input.sources
    this.#resolveReviewer = input.resolveReviewer
  }

  async review(command: CandidateEdgeReviewCommand): Promise<ReviewResult> {
    const edge = await this.#edgeStore.read(command.edgeId)
    if (edge === undefined) throw new CandidateEdgeReviewError('missing_edge')
    if (edge.revision !== command.expectedRevision) throw new CandidateEdgeReviewError('stale_revision')
    if (!authorizedRoles.has(command.reviewer.role)) throw new CandidateEdgeReviewError('unauthorized')
    if (this.#resolveReviewer !== undefined) {
      const reviewer = this.#resolveReviewer(command.reviewer)
      if (reviewer === null || reviewer.id !== command.reviewer.id || reviewer.role !== command.reviewer.role) throw new CandidateEdgeReviewError('unauthorized')
    }
    if (edge.proposerId === command.reviewer.id) throw new CandidateEdgeReviewError('self_review')
    if (edge.reviewState !== 'candidate') throw new CandidateEdgeReviewError('already_reviewed')
    if (edge.evidenceRefs.length === 0) throw new CandidateEdgeReviewError('missing_evidence')
    if (blockedRights.has(edge.rightsState)) throw new CandidateEdgeReviewError('rights_blocked')
    if (command.decision === 'approve' && edge.safetyState !== 'approved') throw new CandidateEdgeReviewError('safety_blocked')
    if (this.#sources !== undefined) {
      const sources = this.#sources()
      const byId = new Map(sources.map((source) => [source.sourceId, source]))
      const referenced = edge.evidenceRefs.map((ref) => byId.get(ref.sourceId))
      if (referenced.some((source) => source === undefined || !source.available)) throw new CandidateEdgeReviewError('missing_evidence')
      if (referenced.some((source) => source !== undefined && blockedRights.has(source.rightsState))) throw new CandidateEdgeReviewError('rights_blocked')
      if (referenced.some((source, index) => source === undefined || source.revision !== edge.evidenceRefs[index]!.revision)) throw new CandidateEdgeReviewError('missing_evidence')
      if (edge.evidenceRevision !== evidenceRevisionHash(referenced.filter((source): source is GraphSourceEvidence => source !== undefined))) throw new CandidateEdgeReviewError('missing_evidence')
    }
    const result = await this.#edgeStore.transact(command.expectedRevision, async (current) => {
      if (current.id !== edge.id || current.revision !== command.expectedRevision) throw new CandidateEdgeReviewError('stale_revision')
      const nextRevision = current.revision + 1
      const next: ReviewResult = Object.freeze({ ...current, revision: nextRevision, reviewState: command.decision === 'approve' ? 'approved' : 'rejected', auditId: auditId(current.id, nextRevision) })
      try {
        await this.#auditSink.append(Object.freeze({ auditId: next.auditId, occurredAt: this.#now(), edgeId: current.id, reviewerId: command.reviewer.id, decision: command.decision, from: current.reviewState, to: next.reviewState, revision: String(nextRevision) }))
      } catch {
        // The transaction callback must not return a next edge when immutable audit
        // publication fails; an atomic edge store therefore leaves the candidate intact.
        throw new CandidateEdgeReviewError('audit_failed')
      }
      return next
    })
    if (!result.committed) throw new CandidateEdgeReviewError('stale_revision')
    return result.value
  }
}

export { validateCandidateProvenance, ProvenanceError }

/** Taxonomy candidates use the same evidence and human-review gates as graph edges. */
export type ReviewNode = Readonly<Pick<CandidateNode, 'id' | 'revision' | 'proposerId' | 'reviewState' | 'promotionState' | 'evidenceRefs' | 'rightsState' | 'evidenceRevision' | 'safetyState'>>
export type CandidateNodeReviewCommand = Readonly<{
  nodeId: string
  expectedRevision: number
  reviewer: Readonly<{ id: string; role: string }>
  decision: 'approve' | 'reject'
}>
export type NodeReviewResult = Readonly<ReviewNode & { auditId: string }>
export type NodeStore = Readonly<{
  read: (nodeId: string) => Promise<ReviewNode | undefined>
  transact: <T>(expectedRevision: number, operation: (current: ReviewNode) => Promise<T>) => Promise<Readonly<{ committed: true; value: T } | { committed: false }>>
}>

export class CandidateNodeReviewError extends Error {
  readonly code: CandidateEdgeReviewError['code']
  constructor(code: CandidateNodeReviewError['code']) {
    super(`candidate node review rejected: ${code}`)
    this.name = 'CandidateNodeReviewError'
    this.code = code
  }
}

export class CandidateNodeReviewService {
  readonly #nodeStore: NodeStore
  readonly #auditSink: ReviewAuditSink
  readonly #now: () => string
  readonly #sources?: () => readonly GraphSourceEvidence[]
  readonly #resolveReviewer?: (reviewer: Readonly<{ id: string; role: string }>) => Readonly<{ id: string; role: string }> | null
  constructor(input: Readonly<{ nodeStore: NodeStore; auditSink: ReviewAuditSink; now: () => string; sources?: () => readonly GraphSourceEvidence[]; resolveReviewer?: (reviewer: Readonly<{ id: string; role: string }>) => Readonly<{ id: string; role: string }> | null }>) {
    this.#nodeStore = input.nodeStore
    this.#auditSink = input.auditSink
    this.#now = input.now
    this.#sources = input.sources
    this.#resolveReviewer = input.resolveReviewer
  }

  async review(command: CandidateNodeReviewCommand): Promise<NodeReviewResult> {
    const node = await this.#nodeStore.read(command.nodeId)
    if (node === undefined) throw new CandidateNodeReviewError('missing_edge')
    if (node.revision !== command.expectedRevision) throw new CandidateNodeReviewError('stale_revision')
    if (!authorizedRoles.has(command.reviewer.role)) throw new CandidateNodeReviewError('unauthorized')
    if (this.#resolveReviewer !== undefined) {
      const reviewer = this.#resolveReviewer(command.reviewer)
      if (reviewer === null || reviewer.id !== command.reviewer.id || reviewer.role !== command.reviewer.role) throw new CandidateNodeReviewError('unauthorized')
    }
    if (node.proposerId === command.reviewer.id) throw new CandidateNodeReviewError('self_review')
    if (node.reviewState !== 'candidate' || node.promotionState !== 'candidate') throw new CandidateNodeReviewError('already_reviewed')
    if (node.evidenceRefs.length === 0) throw new CandidateNodeReviewError('missing_evidence')
    if (blockedRights.has(node.rightsState)) throw new CandidateNodeReviewError('rights_blocked')
    if (command.decision === 'approve' && node.safetyState !== 'approved') throw new CandidateNodeReviewError('safety_blocked')
    if (this.#sources !== undefined) {
      const byId = new Map(this.#sources().map((source) => [source.sourceId, source]))
      const referenced = node.evidenceRefs.map((ref) => byId.get(ref.sourceId))
      if (referenced.some((source) => source === undefined || !source.available)) throw new CandidateNodeReviewError('missing_evidence')
      if (referenced.some((source) => source !== undefined && blockedRights.has(source.rightsState))) throw new CandidateNodeReviewError('rights_blocked')
      if (referenced.some((source, index) => source === undefined || source.revision !== node.evidenceRefs[index]!.revision)) throw new CandidateNodeReviewError('missing_evidence')
      if (node.evidenceRevision !== evidenceRevisionHash(referenced.filter((source): source is GraphSourceEvidence => source !== undefined))) throw new CandidateNodeReviewError('missing_evidence')
    }
    const result = await this.#nodeStore.transact(command.expectedRevision, async (current) => {
      if (current.id !== node.id || current.revision !== command.expectedRevision) throw new CandidateNodeReviewError('stale_revision')
      const nextRevision = current.revision + 1
      const next: NodeReviewResult = Object.freeze({
        ...current,
        revision: nextRevision,
        reviewState: command.decision === 'approve' ? 'approved' : 'rejected',
        promotionState: command.decision === 'approve' ? 'reviewed' : 'retired',
        auditId: `node-audit:${current.id}:${nextRevision}`,
      })
      try {
        await this.#auditSink.append(Object.freeze({ auditId: next.auditId, occurredAt: this.#now(), nodeId: current.id, reviewerId: command.reviewer.id, decision: command.decision, from: current.reviewState, to: next.reviewState, revision: String(nextRevision) }))
      } catch {
        throw new CandidateNodeReviewError('audit_failed')
      }
      return next
    })
    if (!result.committed) throw new CandidateNodeReviewError('stale_revision')
    return result.value
  }
}
