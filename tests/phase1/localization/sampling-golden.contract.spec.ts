import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  assessSampleResult,
  calculateSampleCount,
  selectReviewSample,
  type SamplingCandidate,
} from '@/localization/sampling'
import {
  compareGoldenSetManifests,
  createGoldenSetManifest,
  getFrozenGoldenSetManifest,
  hashGoldenSetManifest,
  validateGoldenSetManifest,
  type GoldenSetManifestInput,
} from '@/localization/golden-set'
import { FROZEN_GOLDEN_FIXTURE, makeGoldenManifestInput } from '../fixtures/localization/frozen-golden-set'

const candidate = (overrides: Partial<SamplingCandidate> = {}): SamplingCandidate => ({
  variant_id: overrides.variant_id ?? 'variant-001',
  locale: overrides.locale ?? 'en',
  release_batch_id: overrides.release_batch_id ?? 'release-2026-08-25',
  eligible: overrides.eligible ?? true,
})

describe('locale review sampling', () => {
  it.each([
    [0, 0],
    [29, 29],
    [30, 30],
    [31, 30],
    [600, 30],
    [601, 31],
  ])('uses max(30, ceil(5%%)) capped by population for %i variants', (population, expected) => {
    expect(calculateSampleCount(population)).toBe(expected)
  })

  it('sorts by sha256(batch + locale + variant) and selects only eligible variants in the release batch', () => {
    const variants = [
      candidate({ variant_id: 'other-batch', release_batch_id: 'release-old' }),
      candidate({ variant_id: 'ineligible', eligible: false }),
      candidate({ variant_id: 'zh-only', locale: 'zh-CN' }),
      candidate({ variant_id: 'variant-003' }),
      candidate({ variant_id: 'variant-002' }),
      candidate({ variant_id: 'variant-001' }),
    ]
    const selected = selectReviewSample(variants, {
      release_batch_id: 'release-2026-08-25',
      locale: 'en',
    })
    const expected = variants
      .filter((item) => item.release_batch_id === 'release-2026-08-25' && item.locale === 'en' && item.eligible)
      .sort((left, right) => {
        const leftHash = createHash('sha256')
          .update(`release-2026-08-25en${left.variant_id}`)
          .digest('hex')
        const rightHash = createHash('sha256')
          .update(`release-2026-08-25en${right.variant_id}`)
          .digest('hex')
        return leftHash.localeCompare(rightHash) || left.variant_id.localeCompare(right.variant_id)
      })
      .map((item) => item.variant_id)
    expect(selected.map((item) => item.variant_id)).toEqual(expected)
    expect(selected.every((item) => item.eligible && item.locale === 'en')).toBe(true)
  })

  it('blocks and remediates only the locale batch with a severe sample defect', () => {
    const result = assessSampleResult({
      release_batch_id: 'release-2026-08-25',
      locale: 'ja-JP',
      defects: [{ kind: 'factual_reversal', severity: 'severe' }],
    })
    expect(result).toEqual({
      release_batch_id: 'release-2026-08-25',
      locale: 'ja-JP',
      status: 'blocked',
      action: 'block-remediate-reqa-resample-locale-batch',
      affected_locales: ['ja-JP'],
    })
  })

  it('does not block a locale batch for non-severe sample findings', () => {
    expect(
      assessSampleResult({
        release_batch_id: 'release-2026-08-25',
        locale: 'en',
        defects: [{ kind: 'style', severity: 'minor' }],
      }),
    ).toMatchObject({ status: 'passed', affected_locales: [] })
  })
})

describe('frozen golden-set manifests', () => {
  it('accepts exactly the frozen 16-locale synthetic manifest and computes a deterministic hash', () => {
    const first = createGoldenSetManifest(FROZEN_GOLDEN_FIXTURE)
    const second = createGoldenSetManifest(makeGoldenManifestInput())
    expect(first.locales.map((entry) => entry.locale)).toEqual([
      'en',
      'zh-CN',
      'zh-TW',
      'ja-JP',
      'ko-KR',
      'de-DE',
      'fr-FR',
      'it-IT',
      'es-ES',
      'es-419',
      'pt-BR',
      'pt-PT',
      'hi-IN',
      'th-TH',
      'tr-TR',
      'vi-VN',
    ])
    expect(first.manifest_hash).toMatch(/^sha256:v1:[a-f0-9]{64}$/)
    expect(first.manifest_hash).toBe(second.manifest_hash)
    expect(hashGoldenSetManifest(first)).toBe(first.manifest_hash)
    expect(validateGoldenSetManifest(first)).toEqual(first)
  })

  it('rejects missing, duplicate, extra, or reordered locale cases', () => {
    const valid = makeGoldenManifestInput()
    expect(() => createGoldenSetManifest({ ...valid, locales: valid.locales.slice(0, 15) })).toThrow(/16|too small/i)
    expect(() => createGoldenSetManifest({ ...valid, locales: [...valid.locales, valid.locales[0]] })).toThrow(
      /16|duplicate|too big/i,
    )
    expect(() => createGoldenSetManifest({ ...valid, locales: valid.locales.map((entry, index) => (index === 0 ? { ...entry, locale: 'xx' } : entry)) as never })).toThrow()
    expect(() => createGoldenSetManifest({ ...valid, locales: [...valid.locales].reverse() })).toThrow(/order/i)
  })

  it('requires model, prompt, source, cost and evaluator metadata and rejects invalid temporal/resource values', () => {
    const valid = makeGoldenManifestInput()
    expect(() => createGoldenSetManifest({ ...valid, model_snapshot: '' })).toThrow()
    expect(() => createGoldenSetManifest({ ...valid, prompt_version: '' })).toThrow()
    expect(() => createGoldenSetManifest({ ...valid, source_hash: 'not-a-hash' })).toThrow()
    expect(() => createGoldenSetManifest({ ...valid, cost_usd: -1 })).toThrow()
    expect(() => createGoldenSetManifest({ ...valid, evaluator_version: '' })).toThrow()
    expect(() => createGoldenSetManifest({ ...valid, evaluated_at: '2099-01-01T00:00:00.000Z' })).toThrow(/future|temporal/i)
    expect(() => createGoldenSetManifest({ ...valid, model_snapshot: 'x'.repeat(257) })).toThrow()
    expect(() => createGoldenSetManifest({ ...valid, severe_defect_limit: 1 } as GoldenSetManifestInput)).toThrow()
  })

  it('returns a frozen manifest through the getter without exposing mutable state', () => {
    const manifest = getFrozenGoldenSetManifest()
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(manifest.locales).toHaveLength(16)
    expect(() => {
      ;(manifest as { version: string }).version = 'mutated'
    }).toThrow()
    expect(getFrozenGoldenSetManifest().version).toBe(manifest.version)
  })

  it('requires an explicit approved baseline before evaluator, model, or cost metadata changes', () => {
    const baseline = createGoldenSetManifest(FROZEN_GOLDEN_FIXTURE)
    const candidateInput = makeGoldenManifestInput({ model_snapshot: 'candidate-model' })
    const candidate = createGoldenSetManifest(candidateInput)
    expect(compareGoldenSetManifests(baseline, candidate)).toMatchObject({ passed: false })
    expect(compareGoldenSetManifests(baseline, createGoldenSetManifest(makeGoldenManifestInput({ cost_usd: 999 })))).toMatchObject({ passed: false })

    const regressedInput = makeGoldenManifestInput({
      model_snapshot: 'candidate-model',
      locales: candidateInput.locales.map((entry, index) =>
        index === 5 ? { ...entry, score: 0.1 } : entry,
      ),
    })
    const regressed = createGoldenSetManifest(regressedInput)
    expect(compareGoldenSetManifests(baseline, regressed)).toMatchObject({ passed: false })
    expect(compareGoldenSetManifests(baseline, regressed).regressions).toContainEqual(
      expect.objectContaining({ locale: 'de-DE' }),
    )
  })
})
