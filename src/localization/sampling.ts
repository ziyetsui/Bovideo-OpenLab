import { createHash } from 'node:crypto'

import { applicationLocaleSchema, type ApplicationLocale } from '@/contracts/locale'

const MAX_IDENTIFIER_LENGTH = 256

export type SamplingCandidate = Readonly<{
  variant_id: string
  locale: ApplicationLocale
  release_batch_id: string
  /** True only after automatic QA and indexability gates have passed. */
  eligible: boolean
}>

export type ReviewSampleOptions = Readonly<{
  release_batch_id: string
  locale: ApplicationLocale
}>

export type SampleDefect = Readonly<{
  kind: string
  severity: 'minor' | 'severe'
}>

export type SampleAssessment = Readonly<{
  release_batch_id: string
  locale: ApplicationLocale
  status: 'passed' | 'blocked'
  action: 'none' | 'block-remediate-reqa-resample-locale-batch'
  affected_locales: readonly ApplicationLocale[]
}>

const assertIdentifier = (value: string, name: string): void => {
  if (value.trim().length === 0 || value.length > MAX_IDENTIFIER_LENGTH)
    throw new RangeError(`${name} must be 1-${MAX_IDENTIFIER_LENGTH} characters`)
}

/** Returns the required per-locale sample size, capped by the eligible population. */
export const calculateSampleCount = (eligiblePopulation: number): number => {
  if (!Number.isSafeInteger(eligiblePopulation) || eligiblePopulation < 0)
    throw new RangeError('eligible population must be a non-negative safe integer')
  if (eligiblePopulation === 0) return 0
  return Math.min(eligiblePopulation, Math.max(30, Math.ceil(eligiblePopulation * 0.05)))
}

/** The exact selector key required by AC-L10N-009. */
export const samplingSortHash = (releaseBatchId: string, locale: ApplicationLocale, variantId: string): string => {
  assertIdentifier(releaseBatchId, 'release batch id')
  assertIdentifier(variantId, 'variant id')
  return createHash('sha256').update(`${releaseBatchId}${locale}${variantId}`, 'utf8').digest('hex')
}

/**
 * Selects one deterministic human sample for one locale in one release batch.
 * Candidates from another batch, another locale, or a failed eligibility gate never enter the sample.
 */
export const selectReviewSample = (
  candidates: readonly SamplingCandidate[],
  options: ReviewSampleOptions,
): readonly SamplingCandidate[] => {
  assertIdentifier(options.release_batch_id, 'release batch id')
  const locale = applicationLocaleSchema.parse(options.locale)
  if (candidates.length > 100_000) throw new RangeError('sampling population exceeds resource bound')

  const eligible = candidates.filter(
    (candidate) =>
      candidate.release_batch_id === options.release_batch_id &&
      candidate.locale === locale &&
      candidate.eligible === true,
  )
  const seen = new Set<string>()
  for (const candidate of eligible) {
    assertIdentifier(candidate.variant_id, 'variant id')
    if (seen.has(candidate.variant_id)) throw new Error(`duplicate variant id: ${candidate.variant_id}`)
    seen.add(candidate.variant_id)
  }
  return [...eligible]
    .sort(
      (left, right) => {
        const leftHash = samplingSortHash(options.release_batch_id, locale, left.variant_id)
        const rightHash = samplingSortHash(options.release_batch_id, locale, right.variant_id)
        if (leftHash < rightHash) return -1
        if (leftHash > rightHash) return 1
        if (left.variant_id < right.variant_id) return -1
        if (left.variant_id > right.variant_id) return 1
        return 0
      },
    )
    .slice(0, calculateSampleCount(eligible.length))
}

/** Decides the smallest remediation scope after a sample evaluation. */
export const assessSampleResult = (input: {
  release_batch_id: string
  locale: ApplicationLocale
  defects: readonly SampleDefect[]
}): SampleAssessment => {
  assertIdentifier(input.release_batch_id, 'release batch id')
  const locale = applicationLocaleSchema.parse(input.locale)
  if (input.defects.length > 100_000) throw new RangeError('sample defect list exceeds resource bound')
  for (const defect of input.defects) {
    assertIdentifier(defect.kind, 'defect kind')
  }
  const blocked = input.defects.some((defect) => defect.severity === 'severe')
  return blocked
    ? {
        release_batch_id: input.release_batch_id,
        locale,
        status: 'blocked',
        action: 'block-remediate-reqa-resample-locale-batch',
        affected_locales: [locale],
      }
    : {
        release_batch_id: input.release_batch_id,
        locale,
        status: 'passed',
        action: 'none',
        affected_locales: [],
      }
}

export const sampleCountForPopulation = calculateSampleCount
export const selectDeterministicSample = selectReviewSample
export const evaluateSampleResult = assessSampleResult
