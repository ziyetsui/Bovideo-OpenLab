import { describe, expect, it } from 'vitest'

import { decideLocaleQa, requiresFullHumanReview } from '@/localization/qa'

const evidence = {
  schema_version: 1 as const,
  locale_variant_id: '01J6R3W2V8W24Q10NRDBVGN3P8',
  source_version: 'sha256:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  golden_set_version: 't07-synthetic-v1',
  model: 'local-fake-model',
  prompt_version: 't07-local-v1',
  cost_version: 'not-run-remote',
  evaluator_version: 't07-qa-v1',
  checked_at: '2026-08-23T00:00:00.000Z',
  scores: { schema: 1, language: 1, factual: 1, placeholder: 1 },
  severe_defects: [],
}

describe('T07 locale QA', () => {
  it('blocks only the failing locale with an auditable severe-defect result', () => {
    const failed = decideLocaleQa({ ...evidence, locale: 'ja-JP', language_detection: 'fail', placeholder_integrity: 'pass', factual_consistency: 'pass', schema_valid: true })
    const passed = decideLocaleQa({ ...evidence, locale: 'fr-FR', language_detection: 'pass', placeholder_integrity: 'pass', factual_consistency: 'pass', schema_valid: true })
    expect(failed).toMatchObject({ allowed: false, workflow_state: 'blocked', severe_defects: ['language_detection'] })
    expect(passed).toMatchObject({ allowed: true, workflow_state: 'review', severe_defects: [] })
  })

  it('requires 100 percent human review for every persisted risk class', () => {
    expect(requiresFullHumanReview(['money'])).toBe(true)
    expect(requiresFullHumanReview(['comparison'])).toBe(true)
    expect(requiresFullHumanReview(['price'])).toBe(true)
    expect(requiresFullHumanReview(['legal_rights'])).toBe(true)
    expect(requiresFullHumanReview([])).toBe(false)
  })

  it('rejects malformed, incomplete, and non-canonical QA evidence at runtime', () => {
    expect(() => decideLocaleQa({ ...evidence, locale: 'en-US', language_detection: 'pass', placeholder_integrity: 'pass', factual_consistency: 'pass', schema_valid: true })).toThrow()
    expect(() => decideLocaleQa({ ...evidence, checked_at: '2026-08-23T00:00:00+08:00', language_detection: 'pass', placeholder_integrity: 'pass', factual_consistency: 'pass', schema_valid: true })).toThrow()
    expect(() => decideLocaleQa({ ...evidence, scores: { schema: 2, language: 1, factual: 1, placeholder: 1 }, language_detection: 'pass', placeholder_integrity: 'pass', factual_consistency: 'pass', schema_valid: true })).toThrow()
  })
})
