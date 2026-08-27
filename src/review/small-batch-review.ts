import { createHash } from 'node:crypto'

import { APPLICATION_LOCALES, type ApplicationLocale } from '@/contracts/locale'
import type { LocaleBatch, LocaleTranslationResult } from '@/pipeline/translate-locales'
import type { ReviewedLocaleVariant, ApprovedLocaleBatch } from './locale-review'

export type { ApprovedLocaleBatch }
export type SmallReviewBatch = LocaleBatch

const digest = (input: string): string =>
  `sha256:v1:${createHash('sha256').update(input, 'utf8').digest('hex')}`

export const createLocaleBatches = (sourceHash: string, locales: readonly ApplicationLocale[] = APPLICATION_LOCALES): readonly LocaleBatch[] => {
  if (locales.length !== APPLICATION_LOCALES.length) throw new Error('locale batches require exactly 16 locales')
  if (locales.some((locale, index) => locale !== APPLICATION_LOCALES[index]) || new Set(locales).size !== locales.length)
    throw new Error('locale batches require the frozen normative locale order')
  const batches: LocaleBatch[] = []
  for (let index = 0; index < locales.length; index += 4) {
    const batchLocales = Object.freeze(locales.slice(index, index + 4))
    const localeSetHash = digest(batchLocales.join(','))
    batches.push(Object.freeze({
      id: `p2l:${sourceHash}:${batches.length}:${localeSetHash}`,
      index: batches.length,
      locales: batchLocales,
      localeSetHash,
    }))
  }
  return Object.freeze(batches)
}

const stableManifestHash = (input: unknown): string =>
  digest(JSON.stringify(input))

export const buildApprovedLocaleBatch = (
  result: LocaleTranslationResult | Readonly<{ artifactId: string; sourceHash: string; locales: readonly ReviewedLocaleVariant[] }>,
): ApprovedLocaleBatch => {
  if (result.locales.length !== APPLICATION_LOCALES.length) throw new Error('approved locale batch requires exactly 16 locales')
  const locales = [...result.locales]
  if (locales.map((variant) => variant.locale).some((locale, index) => locale !== APPLICATION_LOCALES[index]))
    throw new Error('approved locale batch requires frozen locale order')
  if (new Set(locales.map((variant) => variant.locale)).size !== APPLICATION_LOCALES.length)
    throw new Error('approved locale batch contains duplicate locale')
  if (locales.some((variant) => variant.sourceHash !== result.sourceHash)) throw new Error('obsolete source hash')
  if (locales.some((variant) => variant.workflowState !== 'approved' || variant.contentRevision < 2 || variant.reviewedBy === null || variant.reviewedAt === null || !variant.qa.allowed || variant.protectedSpanResult !== 'pass'))
    throw new Error('all 16 locales require current explicit approval')
  const approved = locales.map((variant) => {
    if (variant.reviewedBy === null || variant.reviewedAt === null) throw new Error('missing current approval')
    return Object.freeze({
      id: variant.id,
      locale: variant.locale,
      sourceHash: variant.sourceHash,
      revision: variant.contentRevision,
      workflowState: 'approved' as const,
      qaResultId: variant.qa.evidence.locale_variant_id,
      reviewerId: variant.reviewedBy,
      reviewedAt: variant.reviewedAt,
      localizedFieldsHash: stableManifestHash(variant.localizedFields),
    })
  })
  return Object.freeze({
    artifactId: result.artifactId,
    sourceHash: result.sourceHash,
    locales: Object.freeze(approved),
    reviewManifestHash: stableManifestHash(approved),
  })
}

export const assertNoFallback = (result: Readonly<{ fallback_count: number }>): void => {
  if (result.fallback_count !== 0) throw new Error('locale fallback is prohibited')
}
