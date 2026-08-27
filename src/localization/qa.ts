import { z } from 'zod'

import { immutableIdSchema, utcTimestampSchema, versionedHashSchema } from '@/contracts/common'
import { applicationLocaleSchema } from '@/contracts/locale'

import { deriveLocaleRisk, type LocaleRiskClass } from './state-machine'

export type QaCheck = 'pass' | 'fail'
export type QaSevereDefect = 'schema_validation' | 'placeholder_integrity' | 'factual_consistency' | 'language_detection'

const qaCheckSchema = z.enum(['pass', 'fail'])
/** Strict, bounded and timestamp-validated evidence accepted from QA workers. */
export const localeQaSchema = z.object({
  schema_version: z.literal(1),
  locale_variant_id: immutableIdSchema,
  source_version: versionedHashSchema,
  golden_set_version: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(256),
  prompt_version: z.string().trim().min(1).max(128),
  cost_version: z.string().trim().min(1).max(128),
  evaluator_version: z.string().trim().min(1).max(128),
  locale: applicationLocaleSchema,
  checked_at: utcTimestampSchema,
  placeholder_integrity: qaCheckSchema,
  factual_consistency: qaCheckSchema,
  language_detection: qaCheckSchema,
  schema_valid: z.boolean(),
  scores: z.object({ schema: z.number().finite().min(0).max(1), language: z.number().finite().min(0).max(1), factual: z.number().finite().min(0).max(1), placeholder: z.number().finite().min(0).max(1) }).strict(),
  severe_defects: z.array(z.enum(['schema_validation', 'placeholder_integrity', 'factual_consistency', 'language_detection'])).max(4),
}).strict()
export type LocaleQaInput = Readonly<z.infer<typeof localeQaSchema>>

export const requiresFullHumanReview = (riskClasses: readonly string[]): boolean =>
  deriveLocaleRisk(riskClasses).length > 0

/** Produces a per-locale QA result; a failure cannot block another locale's batch. */
export const decideLocaleQa = (input: unknown): Readonly<{
  allowed: boolean
  workflow_state: 'review' | 'blocked'
  severe_defects: readonly QaSevereDefect[]
  evidence: Readonly<Pick<LocaleQaInput, 'schema_version' | 'locale_variant_id' | 'source_version' | 'golden_set_version' | 'model' | 'prompt_version' | 'cost_version' | 'evaluator_version' | 'locale'>>
}> => {
  const parsed = localeQaSchema.parse(input)
  const defects: QaSevereDefect[] = []
  if (!parsed.schema_valid) defects.push('schema_validation')
  if (parsed.placeholder_integrity !== 'pass') defects.push('placeholder_integrity')
  if (parsed.factual_consistency !== 'pass') defects.push('factual_consistency')
  if (parsed.language_detection !== 'pass') defects.push('language_detection')
  return Object.freeze({
    allowed: defects.length === 0,
    workflow_state: defects.length === 0 ? 'review' : 'blocked',
    severe_defects: Object.freeze(defects),
    evidence: Object.freeze({
      schema_version: parsed.schema_version, locale_variant_id: parsed.locale_variant_id, source_version: parsed.source_version,
      golden_set_version: parsed.golden_set_version, model: parsed.model, prompt_version: parsed.prompt_version,
      cost_version: parsed.cost_version, evaluator_version: parsed.evaluator_version, locale: parsed.locale,
    }),
  })
}

export type { LocaleRiskClass }
