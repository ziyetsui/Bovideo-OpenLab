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
  utcTimestampSchema,
  versionedCommandSchema,
  versionedHashSchema,
} from './common'

export const APPLICATION_LOCALES = [
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
] as const
export const applicationLocaleSchema = z.enum(APPLICATION_LOCALES)
export type ApplicationLocale = z.infer<typeof applicationLocaleSchema>

export const LOCALE_WORKFLOW_STATES = [
  'missing',
  'machine_draft',
  'review',
  'approved',
  'published',
  'blocked',
  'stale',
  'withdrawn',
] as const
export const localeWorkflowStateSchema = z.enum(LOCALE_WORKFLOW_STATES)
export type LocaleWorkflowState = z.infer<typeof localeWorkflowStateSchema>
export const localeRiskClassSchema = z.enum(['money', 'comparison', 'price', 'legal_rights'])
export const localeRiskClassesSchema = z.array(localeRiskClassSchema).max(4)

export const localeVariantSchema = z
  .object({
    id: immutableIdSchema,
    schema_version: schemaVersionSchema,
    created_at: utcTimestampSchema,
    updated_at: utcTimestampSchema,
    entity_ref: relationRefSchema,
    locale: applicationLocaleSchema,
    source_locale: applicationLocaleSchema,
    source_version: versionedHashSchema,
    translation_model: z.string().min(1),
    translation_prompt_version: z.string().min(1),
    localized_fields: z.record(z.string(), z.string()),
    risk_classes: localeRiskClassesSchema,
    workflow_state: localeWorkflowStateSchema,
    content_revision: revisionSchema,
    last_content_editor: relationRefSchema,
    reviewed_by: relationRefSchema.nullable(),
    reviewed_at: utcTimestampSchema.nullable(),
    published_version: z.number().int().positive().nullable(),
  })
  .strict()
export type LocaleVariant = z.infer<typeof localeVariantSchema>

const localeActorRoleSchema = z.enum([
  'translator_service',
  'translator',
  'editor',
  'qa_service',
  'reviewer',
  'legal',
  'publisher',
  'system',
  'withdraw_service',
])
const localeGuardSchema = z
  .object({
    protected_spans_valid: z.boolean().optional(),
    qa_result_id: immutableIdSchema.optional(),
    reason_code: z.string().min(1).optional(),
    new_content_revision: z.boolean().optional(),
    resolved_reason: z.boolean().optional(),
    last_content_editor_id: immutableIdSchema.optional(),
    money_page: z.boolean().optional(),
    approved_revision_unchanged: z.boolean().optional(),
    reviewer_id: immutableIdSchema.optional(),
    source_hash_changed: z.boolean().optional(),
    content_revision_changed: z.boolean().optional(),
    withdrawal_request_id: immutableIdSchema.optional(),
  })
  .strict()

const localeTransitionSchema = versionedCommandSchema
  .extend({
    from: localeWorkflowStateSchema,
    to: localeWorkflowStateSchema,
    actor: relationRefSchema,
    actor_role: localeActorRoleSchema,
    reason_code: z.string().min(1),
    guard: localeGuardSchema,
  })
  .strict()
export type LocaleTransitionCommand = z.infer<typeof localeTransitionSchema>

const hasRole = (
  role: LocaleTransitionCommand['actor_role'],
  expected: readonly LocaleTransitionCommand['actor_role'][],
): boolean => expected.includes(role)

export const decideLocaleTransition = (input: unknown): TransitionDecision => {
  const parsed = localeTransitionSchema.safeParse(input)
  if (!parsed.success) return rejectedDecision('invalid_command')
  const command = parsed.data
  if (!hasExpectedRevision(command)) return rejectedDecision('version_conflict')
  const { from, to, guard } = command
  if (from === 'missing' && to === 'machine_draft')
    return guard.protected_spans_valid && hasRole(command.actor_role, ['translator_service'])
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (from === 'machine_draft' && to === 'review')
    return guard.qa_result_id !== undefined && hasRole(command.actor_role, ['translator', 'editor'])
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if ((from === 'machine_draft' || from === 'review') && to === 'blocked')
    return guard.reason_code !== undefined &&
      hasRole(command.actor_role, ['qa_service', 'reviewer', 'legal'])
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if ((from === 'blocked' || from === 'stale') && to === 'review')
    return guard.new_content_revision === true &&
      guard.resolved_reason === true &&
      hasRole(command.actor_role, ['translator', 'editor'])
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (from === 'review' && to === 'approved')
    return (!guard.money_page || guard.last_content_editor_id !== command.actor.id) &&
      hasRole(command.actor_role, ['reviewer'])
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (from === 'approved' && to === 'published')
    return guard.approved_revision_unchanged === true &&
      (!guard.money_page || guard.reviewer_id !== command.actor.id) &&
      hasRole(command.actor_role, ['publisher'])
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if ((from === 'machine_draft' || from === 'review' || from === 'approved' || from === 'published') && to === 'stale')
    return (guard.source_hash_changed === true && hasRole(command.actor_role, ['system'])) ||
      (guard.content_revision_changed === true && hasRole(command.actor_role, ['translator', 'editor']))
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if ((from === 'published' || from === 'stale' || from === 'blocked') && to === 'withdrawn')
    return guard.withdrawal_request_id !== undefined &&
      hasRole(command.actor_role, ['publisher', 'legal', 'withdraw_service'])
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  return rejectedDecision('illegal_transition')
}
