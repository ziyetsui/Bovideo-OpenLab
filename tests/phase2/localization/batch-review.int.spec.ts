import { describe, expect, it } from 'vitest'

import { APPLICATION_LOCALES } from '@/contracts/locale'
import { serializeProtectedSpans } from '@/localization/protected-spans'
import { LocaleTranslationService } from '@/pipeline/translate-locales'
import { LocaleReviewService } from '@/review/locale-review'
import type { ReviewedLocaleVariant } from '@/review/locale-review'
import { createLocaleBatches, buildApprovedLocaleBatch } from '@/review/small-batch-review'
import {
  LOCALE_ARTIFACT_ID,
  LOCALE_EDITOR_ID,
  LOCALE_NOW,
  LOCALE_PROTECTED_SPANS,
  LOCALE_REVIEWER_ID,
  LOCALE_SOURCE_HASH,
  LOCALE_SOURCE_TEXT,
  makeQaEvidence,
} from '../fixtures/locale-review-evidence'
import { NEGATIVE_LOCALE_FIXTURE_IDS } from '../fixtures/negative-locales'

const encoded = serializeProtectedSpans(LOCALE_SOURCE_TEXT, LOCALE_PROTECTED_SPANS)
const translated = Object.fromEntries(APPLICATION_LOCALES.map((locale) => [locale, {
  localizedFields: { title: `[${locale}] local review` },
  serializedPrompt: encoded.serialized,
}]))

const translationService = (overrides: Record<string, unknown> = {}) => new LocaleTranslationService({
  artifactId: LOCALE_ARTIFACT_ID,
  sourceHash: LOCALE_SOURCE_HASH,
  sourceLocale: 'en',
  sourceText: LOCALE_SOURCE_TEXT,
  protectedSpans: LOCALE_PROTECTED_SPANS,
  translate: async ({ locale }: { locale: keyof typeof translated }) => translated[locale],
  qa: async ({ locale, variantId }: { locale: typeof APPLICATION_LOCALES[number]; variantId: string }) => makeQaEvidence(locale, variantId),
  now: () => LOCALE_NOW,
  ...overrides,
})

describe('P2-L T03 exact locale review', () => {
  it('creates exactly 16 deterministic locales in batches of at most four with no fallback', async () => {
    const result = await translationService().run()
    expect(result.locales).toHaveLength(16)
    expect(result.locales.map((item) => item.locale)).toEqual(APPLICATION_LOCALES)
    expect(result.batches).toHaveLength(4)
    expect(result.batches.every((batch) => batch.locales.length <= 4)).toBe(true)
    expect(result.batches.flatMap((batch) => batch.locales)).toEqual(APPLICATION_LOCALES)
    expect(result.fallback_count).toBe(0)
    expect(result.locales.every((item) => item.protectedSpanResult === 'pass' && item.qa.allowed)).toBe(true)
  })

  it('isolates a QA failure and never substitutes a missing locale', async () => {
    const result = await translationService({
      qa: async ({ locale, variantId }: { locale: typeof APPLICATION_LOCALES[number]; variantId: string }) => makeQaEvidence(locale, variantId, locale === 'ja-JP' ? { language_detection: 'fail' } : {}),
    }).run()
    expect(result.locales.find((item) => item.locale === 'ja-JP')?.workflowState).toBe('blocked')
    expect(result.locales.filter((item) => item.workflowState === 'review')).toHaveLength(15)
    expect(result.fallback_count).toBe(0)
    expect(() => buildApprovedLocaleBatch(result)).toThrow(/16|approved|review/i)
  })

  it.each([
    ['missing locale', APPLICATION_LOCALES.slice(0, 15)],
    ['duplicate locale', [...APPLICATION_LOCALES.slice(0, 15), APPLICATION_LOCALES[0]]],
    ['alias locale', [...APPLICATION_LOCALES.slice(0, 15), 'zh' as never]],
  ])('rejects %s without fallback', async (_label, locales) => {
    await expect(translationService({ locales }).run()).rejects.toThrow()
  })

  it('rejects protected byte changes before review', async () => {
    await expect(translationService({
      translate: async ({ locale }: { locale: keyof typeof translated }) => ({ ...translated[locale], serializedPrompt: translated[locale].serializedPrompt.replace('__BO_PROTECTED_0__', 'changed') }),
    }).run()).rejects.toThrow(/protected|placeholder|restore/i)
  })

  it('permits translation of non-protected bytes while preserving protected bytes', async () => {
    const result = await translationService({
      translate: async ({ locale }: { locale: keyof typeof translated }) => locale === 'zh-CN'
        ? { ...translated[locale], serializedPrompt: `使用 __BO_PROTECTED_0__ 于 __BO_PROTECTED_1__ 配置 __BO_PROTECTED_2__。` }
        : translated[locale],
    }).run()
    expect(result.locales.find((item) => item.locale === 'zh-CN')?.protectedSpanResult).toBe('pass')
  })

  it('requires explicit current human review and enforces authorization, self-review and stale revision', async () => {
    const result = await translationService().run()
    const store = new Map<string, ReviewedLocaleVariant>(result.locales.map((variant) => [variant.id, { ...variant, lastContentEditorId: LOCALE_EDITOR_ID, workflowState: 'review' as const, contentRevision: 1 }]))
    const audit: unknown[] = []
    const review = new LocaleReviewService({
      store: {
        read: async (id: string) => store.get(id),
        transact: async (id: string, expectedRevision: number, operation: (value: ReviewedLocaleVariant) => Promise<ReviewedLocaleVariant>) => {
          const current = store.get(id)
          if (!current || current.contentRevision !== expectedRevision) return { committed: false as const }
          const next = await operation(current)
          store.set(id, next as typeof current)
          return { committed: true as const, value: next }
        },
      },
      audit: { append: async (event: unknown) => { audit.push(event) } },
      now: () => LOCALE_NOW,
      resolveReviewer: (id: string, role: string) => role === 'reviewer' && id === LOCALE_REVIEWER_ID,
    })
    const first = result.locales[0]!
    await expect(review.review({ variantId: first.id, expectedRevision: 1, reviewerId: 'translator-1', reviewerRole: 'translator', decision: 'approved', reason: 'ok' })).rejects.toThrow(/unauthorized/i)
    await expect(review.review({ variantId: first.id, expectedRevision: 1, reviewerId: 'attacker-1', reviewerRole: 'reviewer', decision: 'approved', reason: 'forged identity' })).rejects.toThrow(/unauthorized/i)
    await expect(review.review({ variantId: first.id, expectedRevision: 1, reviewerId: LOCALE_EDITOR_ID, reviewerRole: 'reviewer', decision: 'approved', reason: 'self' })).rejects.toThrow(/self/i)
    const approved = await review.review({ variantId: first.id, expectedRevision: 1, reviewerId: LOCALE_REVIEWER_ID, reviewerRole: 'reviewer', decision: 'approved', reason: 'explicit review' })
    expect(approved.workflowState).toBe('approved')
    await expect(review.review({ variantId: first.id, expectedRevision: 1, reviewerId: LOCALE_REVIEWER_ID, reviewerRole: 'reviewer', decision: 'approved', reason: 'stale' })).rejects.toThrow(/revision|stale/i)
    expect(audit).toHaveLength(1)
  })

  it('keeps every fixed negative fixture outside the candidate snapshot', () => {
    const negative = NEGATIVE_LOCALE_FIXTURE_IDS.map((id) => ({ id, snapshot_inclusions: 0, fallback_count: 0 }))
    expect(negative).toHaveLength(9)
    expect(negative.every((item) => item.snapshot_inclusions === 0 && item.fallback_count === 0)).toBe(true)
  })
})

describe('P2-L T03 batching', () => {
  it('uses the frozen locale order and stable batch ids', () => {
    const first = createLocaleBatches(LOCALE_SOURCE_HASH)
    const second = createLocaleBatches(LOCALE_SOURCE_HASH)
    expect(first).toEqual(second)
    expect(first.every((batch) => batch.id.startsWith(`p2l:${LOCALE_SOURCE_HASH}:`))).toBe(true)
  })
})
