import { z } from 'zod'

import {
  allowedDecision,
  hasExpectedRevision,
  immutableIdSchema,
  rejectedDecision,
  relationRefSchema,
  revisionSchema,
  schemaVersionSchema,
  TransitionDecision,
  versionedCommandSchema,
  versionedHashSchema,
} from './common'
import { applicationLocaleSchema } from './locale'

export const PAGE_INDEX_STATES = [
  'not_generated',
  'discoverable_noindex',
  'index_candidate',
  'indexable',
  'retired',
] as const
export const pageIndexStateSchema = z.enum(PAGE_INDEX_STATES)
export const pageTypeSchema = z.enum(['hub', 'gallery', 'entity', 'detail'])
export type PageIndexState = z.infer<typeof pageIndexStateSchema>

export const pageCandidateSchema = z
  .object({
    id: immutableIdSchema,
    schema_version: schemaVersionSchema,
    revision: revisionSchema,
    page_type: pageTypeSchema,
    root_object_ref: relationRefSchema,
    locale: applicationLocaleSchema,
    intent: z.string().min(1),
    index_state: pageIndexStateSchema,
    qualification_input_hash: versionedHashSchema,
    qualification_rule_version: z.string().min(1),
    reason_codes: z.array(z.string().min(1)),
  })
  .strict()
export type PageCandidate = z.infer<typeof pageCandidateSchema>

const pageTransitionSchema = versionedCommandSchema
  .extend({
    from: pageIndexStateSchema,
    to: pageIndexStateSchema,
    actor: relationRefSchema,
    actor_role: z.enum(['editor', 'system', 'reviewer', 'publisher', 'legal']),
    reason_code: z.string().min(1),
    metrics_input_hash: versionedHashSchema,
    guard: z
      .object({
        five_gates_recorded: z.boolean().optional(),
        locale_and_rights_eligible: z.boolean().optional(),
        validators_passed: z.boolean().optional(),
        redirect_or_410_decided: z.boolean().optional(),
      })
      .strict(),
  })
  .strict()

export const decidePageTransition = (input: unknown): TransitionDecision => {
  const parsed = pageTransitionSchema.safeParse(input)
  if (!parsed.success) return rejectedDecision('invalid_command')
  const command = parsed.data
  if (!hasExpectedRevision(command)) return rejectedDecision('version_conflict')
  const { from, to, actor_role: role, guard } = command
  if (from === 'not_generated' && to === 'discoverable_noindex')
    return guard.five_gates_recorded === true && (role === 'editor' || role === 'system')
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (from === 'discoverable_noindex' && to === 'index_candidate')
    return guard.five_gates_recorded === true &&
      guard.locale_and_rights_eligible === true &&
      role === 'reviewer'
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (from === 'index_candidate' && to === 'indexable')
    return guard.validators_passed === true && role === 'publisher'
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (from === 'indexable' && to === 'discoverable_noindex')
    return ['publisher', 'legal', 'system'].includes(role)
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (['discoverable_noindex', 'index_candidate', 'indexable'].includes(from) && to === 'retired')
    return guard.redirect_or_410_decided === true && (role === 'publisher' || role === 'legal')
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  return rejectedDecision('illegal_transition')
}
