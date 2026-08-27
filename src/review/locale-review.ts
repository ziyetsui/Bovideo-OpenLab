import { createHash } from 'node:crypto'

import type { ApplicationLocale } from '@/contracts/locale'

import type { LocaleTranslationVariant } from '@/pipeline/translate-locales'

export type LocaleReviewCommand = Readonly<{
  variantId: string
  expectedRevision: number
  reviewerId: string
  reviewerRole: string
  decision: 'approved' | 'rejected'
  reason: string
  sourceHash?: string
}> 

export type ReviewedLocaleVariant = Readonly<Omit<LocaleTranslationVariant, 'workflowState' | 'reviewedBy' | 'reviewedAt'> & {
  workflowState: 'approved' | 'blocked' | 'review'
  reviewedBy: string | null
  reviewedAt: string | null
  reviewReason?: string
  reviewDecision?: 'approved' | 'rejected'
}>

export type LocaleReviewResult = ReviewedLocaleVariant

export type LocaleVariantStore = Readonly<{
  read: (variantId: string) => Promise<ReviewedLocaleVariant | undefined>
  transact: (
    variantId: string,
    expectedRevision: number,
    operation: (current: ReviewedLocaleVariant) => Promise<ReviewedLocaleVariant>,
  ) => Promise<Readonly<{ committed: true; value: ReviewedLocaleVariant } | { committed: false }>>
}>

export type LocaleReviewAuditSink = Readonly<{
  append: (event: Readonly<Record<string, unknown>>) => Promise<void> | void
}>

export class LocaleReviewError extends Error {
  readonly code:
    | 'missing_variant'
    | 'stale_revision'
    | 'unauthorized'
    | 'self_review'
    | 'invalid_reason'
    | 'qa_failed'
    | 'protected_span_failed'
    | 'source_hash_stale'
    | 'invalid_state'
    | 'audit_failed'

  constructor(code: LocaleReviewError['code'], detail: string = code) {
    super(`locale review rejected: ${detail}`)
    this.name = 'LocaleReviewError'
    this.code = code
  }
}

const hashReview = (value: unknown): string =>
  `sha256:v1:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`

const isCurrentReviewable = (variant: ReviewedLocaleVariant): boolean =>
  variant.workflowState === 'review' &&
  variant.contentRevision >= 1 &&
  variant.protectedSpanResult === 'pass' &&
  variant.qa.allowed

export class LocaleReviewService {
  readonly #store: LocaleVariantStore
  readonly #audit: LocaleReviewAuditSink
  readonly #now: () => string
  readonly #reviewerRole: string
  readonly #resolveReviewer?: (reviewerId: string, reviewerRole: string) => boolean

  constructor(input: Readonly<{
    store: LocaleVariantStore
    audit: LocaleReviewAuditSink
    now: () => string
    reviewerRole?: string
    resolveReviewer?: (reviewerId: string, reviewerRole: string) => boolean
  }>) {
    this.#store = input.store
    this.#audit = input.audit
    this.#now = input.now
    this.#reviewerRole = input.reviewerRole ?? 'reviewer'
    this.#resolveReviewer = input.resolveReviewer
  }

  async review(command: LocaleReviewCommand): Promise<LocaleReviewResult> {
    const current = await this.#store.read(command.variantId)
    if (current === undefined) throw new LocaleReviewError('missing_variant')
    if (current.contentRevision !== command.expectedRevision) throw new LocaleReviewError('stale_revision')
    if (current.lastContentEditorId === command.reviewerId)
      throw new LocaleReviewError('self_review')
    if (command.reviewerRole !== this.#reviewerRole || command.reviewerId.length === 0 || this.#resolveReviewer?.(command.reviewerId, command.reviewerRole) !== true)
      throw new LocaleReviewError('unauthorized')
    if (command.reason.trim().length === 0) throw new LocaleReviewError('invalid_reason')
    if (command.sourceHash !== undefined && command.sourceHash !== current.sourceHash)
      throw new LocaleReviewError('source_hash_stale')
    if (!isCurrentReviewable(current)) {
      if (current.protectedSpanResult !== 'pass') throw new LocaleReviewError('protected_span_failed')
      if (!current.qa.allowed) throw new LocaleReviewError('qa_failed')
      throw new LocaleReviewError('invalid_state')
    }

    const committed = await this.#store.transact(command.variantId, command.expectedRevision, async (latest) => {
      if (latest.contentRevision !== command.expectedRevision) throw new LocaleReviewError('stale_revision')
      if (!isCurrentReviewable(latest)) throw new LocaleReviewError('invalid_state')
      const reviewedAt = this.#now()
      const next = Object.freeze({
        ...latest,
        contentRevision: latest.contentRevision + 1,
        workflowState: command.decision === 'approved' ? 'approved' as const : 'blocked' as const,
        reviewedBy: command.reviewerId,
        reviewedAt,
        reviewReason: command.reason,
        reviewDecision: command.decision,
      })
      try {
        await this.#audit.append(Object.freeze({
          eventId: hashReview(`${latest.id}:${next.contentRevision}:${command.reviewerId}:${command.decision}`),
          eventType: 'locale-variants.reviewed',
          variantId: latest.id,
          locale: latest.locale,
          sourceHash: latest.sourceHash,
          priorRevision: latest.contentRevision,
          revision: next.contentRevision,
          reviewerId: command.reviewerId,
          decision: command.decision,
          reason: command.reason,
          reviewedAt,
        }))
      } catch (error) {
        throw new LocaleReviewError('audit_failed', error instanceof Error ? error.message : 'audit sink failed')
      }
      return next
    })
    if (!committed.committed) throw new LocaleReviewError('stale_revision')
    return committed.value
  }
}

export const reviewLocaleVariant = (
  service: LocaleReviewService,
  command: LocaleReviewCommand,
): Promise<LocaleReviewResult> => service.review(command)

export const localeReviewUsesCurrentRevision = (variant: Readonly<{ contentRevision: number; sourceHash: string }>, input: Readonly<{ expectedRevision: number; sourceHash: string }>): boolean =>
  variant.contentRevision === input.expectedRevision && variant.sourceHash === input.sourceHash

export type ApprovedLocaleVariant = Readonly<{
  id: string
  locale: ApplicationLocale
  sourceHash: string
  revision: number
  workflowState: 'approved'
  qaResultId: string
  reviewerId: string
  reviewedAt: string
  localizedFieldsHash: string
}>

export type ApprovedLocaleBatch = Readonly<{
  artifactId: string
  sourceHash: string
  locales: readonly ApprovedLocaleVariant[]
  reviewManifestHash: string
}>
