import { z } from 'zod'

import {
  allowedDecision,
  hasExpectedRevision,
  immutableIdSchema,
  rejectedDecision,
  relationRefSchema,
  TransitionDecision,
  utcTimestampSchema,
  versionedCommandSchema,
} from './common'

export const DELETION_STATES = [
  'received',
  'validated',
  'withdrawing',
  'surfaces_pending',
  'completed',
  'rejected',
  'cancelled',
] as const
export const deletionStateSchema = z.enum(DELETION_STATES)

export const deletionRequestSchema = z
  .object({
    id: immutableIdSchema,
    external_request_key: z.string().min(1),
    scope: z.enum(['source', 'artifact', 'locale', 'page', 'export']),
    requested_by: relationRefSchema,
    legal_basis: z.string().min(1),
    object_refs: z.array(relationRefSchema).min(1),
    deadline: utcTimestampSchema.nullable(),
    state: deletionStateSchema,
    reason_code: z.string().min(1),
    revision: z.number().int().positive(),
  })
  .strict()
export type DeletionRequest = z.infer<typeof deletionRequestSchema>

const deletionTransitionSchema = versionedCommandSchema
  .extend({
    from: deletionStateSchema,
    to: deletionStateSchema,
    actor: relationRefSchema,
    actor_role: z.enum(['legal', 'withdraw_service', 'publisher']),
    reason_code: z.string().min(1),
    guard: z.object({ emergency_withdraw_job_created: z.boolean().optional() }).strict(),
  })
  .strict()

export const decideDeletionTransition = (input: unknown): TransitionDecision => {
  const parsed = deletionTransitionSchema.safeParse(input)
  if (!parsed.success) return rejectedDecision('invalid_command')
  const command = parsed.data
  if (!hasExpectedRevision(command)) return rejectedDecision('version_conflict')
  const { from, to, actor_role: role, guard } = command
  if (from === 'received' && ['validated', 'rejected', 'cancelled'].includes(to))
    return role === 'legal' ? allowedDecision() : rejectedDecision('guard_failed')
  if (from === 'validated' && to === 'cancelled')
    return role === 'legal' ? allowedDecision() : rejectedDecision('guard_failed')
  if (from === 'validated' && to === 'withdrawing')
    return guard.emergency_withdraw_job_created === true && role === 'withdraw_service'
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (from === 'withdrawing' && (to === 'surfaces_pending' || to === 'completed'))
    return role === 'withdraw_service' || role === 'publisher' || role === 'legal'
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  if (from === 'surfaces_pending' && to === 'completed')
    return role === 'publisher' || role === 'legal'
      ? allowedDecision()
      : rejectedDecision('guard_failed')
  return rejectedDecision('illegal_transition')
}
