import { z } from 'zod'

import {
  allowedDecision,
  assertUnchanged,
  hasExpectedRevision,
  immutableIdSchema,
  rejectedDecision,
  revisionSchema,
  schemaVersionSchema,
  TransitionDecision,
  utcTimestampSchema,
  versionedCommandSchema,
  versionedHashSchema,
} from './common'

export const PUBLICATION_STATES = [
  'draft',
  'preparing',
  'validated',
  'active',
  'superseded',
  'rolled_back',
  'failed',
] as const
export const publicationStateSchema = z.enum(PUBLICATION_STATES)
export type PublicationState = z.infer<typeof publicationStateSchema>

export const publicationSnapshotSchema = z
  .object({
    publish_version: z.number().int().positive(),
    schema_version: schemaVersionSchema,
    created_at: utcTimestampSchema,
    route_manifest_ref: z.string().min(1),
    sitemap_manifest_ref: z.string().min(1),
    github_manifest_ref: z.string().min(1),
    content_tree_hash: versionedHashSchema,
    previous_verified_version: z.number().int().positive().nullable(),
    validation_report_ref: z.string().min(1),
  })
  .strict()
export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>

export const publicationStateRecordSchema = z
  .object({
    publish_version: z.number().int().positive(),
    revision: revisionSchema,
    status: publicationStateSchema,
    reason_code: z.string().min(1).nullable(),
    activated_at: utcTimestampSchema.nullable(),
    updated_at: utcTimestampSchema,
    correlation_id: immutableIdSchema,
  })
  .strict()
export type PublicationStateRecord = z.infer<typeof publicationStateRecordSchema>

const activePublicationPointerInitialSchema = z
  .object({
    publish_version: z.null(),
    previous_verified_version: z.null(),
    revision: z.literal(0),
  })
  .strict()

const activePublicationPointerActiveSchema = z
  .object({
    publish_version: z.number().int().positive(),
    previous_verified_version: z.number().int().positive().nullable(),
    revision: revisionSchema,
  })
  .strict()
export const activePublicationPointerSchema = z.union([
  activePublicationPointerInitialSchema,
  activePublicationPointerActiveSchema,
])
export type ActivePublicationPointer = z.infer<typeof activePublicationPointerSchema>

export const assertSnapshotMutationAllowed = (
  current: PublicationSnapshot,
  next: PublicationSnapshot,
): void => {
  assertUnchanged(current, next, [
    'publish_version',
    'schema_version',
    'created_at',
    'route_manifest_ref',
    'sitemap_manifest_ref',
    'github_manifest_ref',
    'content_tree_hash',
    'previous_verified_version',
    'validation_report_ref',
  ])
}

const publicationTransitionSchema = versionedCommandSchema
  .extend({
    from: publicationStateSchema,
    to: publicationStateSchema,
    subject_state: publicationStateRecordSchema,
    active_pointer: activePublicationPointerSchema,
    actor: z.object({ type: z.literal('service'), id: immutableIdSchema }).strict(),
    actor_role: z.literal('publisher_service'),
    reason_code: z.string().min(1),
    guard: z
      .object({
        publisher_principal_authorized: z.boolean(),
        activation_plan: z
          .discriminatedUnion('mode', [
            z
              .object({
                mode: z.literal('bootstrap'),
                current_active_state: z.null(),
                activating_state: publicationStateRecordSchema,
                previous_verified_state: z.null(),
                pointer_expected_revision: z.literal(0),
              })
              .strict(),
            z
              .object({
                mode: z.literal('replacement'),
                current_active_state: publicationStateRecordSchema,
                activating_state: publicationStateRecordSchema,
                previous_verified_state: publicationStateRecordSchema,
                pointer_expected_revision: revisionSchema,
                pointer_expected_publish_version: z.number().int().positive(),
              })
              .strict(),
          ])
          .optional(),
        atomic_rollback: z
          .object({
            failed_current_active_state: publicationStateRecordSchema,
            previous_verified_state: publicationStateRecordSchema,
            pointer_expected_revision: revisionSchema,
            pointer_expected_publish_version: z.number().int().positive(),
            pointer_expected_previous_verified_version: z.number().int().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict()

const isSamePublicationState = (
  left: PublicationStateRecord,
  right: PublicationStateRecord,
): boolean =>
  left.publish_version === right.publish_version &&
  left.revision === right.revision &&
  left.status === right.status

const matchesActivePointer = (
  pointer: ActivePublicationPointer,
  expectedRevision: number,
  expectedPublishVersion: number,
): boolean =>
  pointer.publish_version !== null &&
  pointer.revision === expectedRevision &&
  pointer.publish_version === expectedPublishVersion

const hasValidActivationPlan = (command: z.infer<typeof publicationTransitionSchema>): boolean => {
  const plan = command.guard.activation_plan
  if (plan === undefined) return false
  if (plan.mode === 'bootstrap') {
    return (
      command.active_pointer.publish_version === null &&
      command.active_pointer.previous_verified_version === null &&
      command.active_pointer.revision === plan.pointer_expected_revision
    )
  }
  return (
    plan.current_active_state.status === 'active' &&
    plan.activating_state.status === 'validated' &&
    plan.previous_verified_state.status === 'superseded' &&
    plan.current_active_state.publish_version === command.active_pointer.publish_version &&
    plan.previous_verified_state.publish_version ===
      command.active_pointer.previous_verified_version &&
    matchesActivePointer(
      command.active_pointer,
      plan.pointer_expected_revision,
      plan.pointer_expected_publish_version,
    )
  )
}

const hasValidRollbackPlan = (command: z.infer<typeof publicationTransitionSchema>): boolean => {
  const plan = command.guard.atomic_rollback
  if (plan === undefined || command.active_pointer.publish_version === null) return false
  return (
    plan.failed_current_active_state.status === 'active' &&
    plan.previous_verified_state.status === 'superseded' &&
    plan.failed_current_active_state.publish_version === command.active_pointer.publish_version &&
    plan.previous_verified_state.publish_version ===
      command.active_pointer.previous_verified_version &&
    matchesActivePointer(
      command.active_pointer,
      plan.pointer_expected_revision,
      plan.pointer_expected_publish_version,
    ) &&
    command.active_pointer.previous_verified_version ===
      plan.pointer_expected_previous_verified_version
  )
}

export const decidePublicationTransition = (input: unknown): TransitionDecision => {
  const parsed = publicationTransitionSchema.safeParse(input)
  if (!parsed.success) return rejectedDecision('invalid_command')
  const command = parsed.data
  if (!hasExpectedRevision(command)) return rejectedDecision('version_conflict')
  if (
    command.subject_state.status !== command.from ||
    command.subject_state.revision !== command.current_revision
  ) {
    return rejectedDecision('version_conflict')
  }
  const { from, to, guard } = command
  if (from === 'draft' && to === 'preparing') return allowedDecision()
  if (from === 'preparing' && (to === 'validated' || to === 'failed')) return allowedDecision()
  if (from === 'validated' && to === 'failed') return allowedDecision()
  if (from === 'validated' && to === 'active') {
    const plan = guard.activation_plan
    return guard.publisher_principal_authorized &&
      plan !== undefined &&
      hasValidActivationPlan(command) &&
      isSamePublicationState(command.subject_state, plan.activating_state)
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  }
  if (from === 'active' && to === 'superseded') {
    const plan = guard.activation_plan
    return guard.publisher_principal_authorized &&
      plan !== undefined &&
      plan.mode === 'replacement' &&
      hasValidActivationPlan(command) &&
      isSamePublicationState(command.subject_state, plan.current_active_state)
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  }
  if (from === 'active' && to === 'rolled_back') {
    const plan = guard.atomic_rollback
    return guard.publisher_principal_authorized &&
      plan !== undefined &&
      hasValidRollbackPlan(command) &&
      isSamePublicationState(command.subject_state, plan.failed_current_active_state)
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  }
  if (from === 'superseded' && to === 'active') {
    const plan = guard.atomic_rollback
    return guard.publisher_principal_authorized &&
      plan !== undefined &&
      hasValidRollbackPlan(command) &&
      isSamePublicationState(command.subject_state, plan.previous_verified_state)
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  }
  return rejectedDecision('illegal_transition')
}
