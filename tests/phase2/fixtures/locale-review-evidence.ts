import type { ApplicationLocale } from '@/contracts/locale'
import type { ProtectedSpan } from '@/localization/protected-spans'

export const LOCALE_SOURCE_HASH = `sha256:v1:${'a'.repeat(64)}`
export const LOCALE_ARTIFACT_ID = 'artifact-p2l-reviewed-001'
export const LOCALE_REVIEWER_ID = 'reviewer-p2l-001'
export const LOCALE_EDITOR_ID = 'editor-p2l-001'
export const LOCALE_NOW = '2026-08-24T12:00:00.000Z'

export const LOCALE_SOURCE_TEXT = 'Use gpt-4.1 at https://bo.example.test with {{prompt}}.'
export const LOCALE_PROTECTED_SPANS: readonly ProtectedSpan[] = [
  { start: LOCALE_SOURCE_TEXT.indexOf('gpt-4.1'), end: LOCALE_SOURCE_TEXT.indexOf('gpt-4.1') + 7, kind: 'model', exact_text: 'gpt-4.1' },
  { start: LOCALE_SOURCE_TEXT.indexOf('https://'), end: LOCALE_SOURCE_TEXT.indexOf('https://') + 'https://bo.example.test'.length, kind: 'url', exact_text: 'https://bo.example.test' },
  { start: LOCALE_SOURCE_TEXT.indexOf('{{prompt}}'), end: LOCALE_SOURCE_TEXT.indexOf('{{prompt}}') + 10, kind: 'variable', exact_text: '{{prompt}}' },
]

export const makeQaEvidence = (locale: ApplicationLocale, variantId: string, overrides: Record<string, unknown> = {}) => ({
  schema_version: 1 as const,
  locale_variant_id: variantId,
  source_version: LOCALE_SOURCE_HASH,
  golden_set_version: 'p2l-golden-v1',
  model: 'p2l-local-fake-model',
  prompt_version: 'p2l-prompt-v1',
  cost_version: 'local-zero-cost-v1',
  evaluator_version: 'p2l-qa-v1',
  locale,
  checked_at: LOCALE_NOW,
  placeholder_integrity: 'pass' as const,
  factual_consistency: 'pass' as const,
  language_detection: 'pass' as const,
  schema_valid: true,
  scores: { schema: 1, language: 1, factual: 1, placeholder: 1 },
  severe_defects: [],
  ...overrides,
})

export type LocaleReviewFixture = Readonly<{
  artifactId: string
  sourceHash: string
  sourceLocale: 'en'
  sourceText: string
  protectedSpans: readonly ProtectedSpan[]
  locales: readonly ApplicationLocale[]
}>

