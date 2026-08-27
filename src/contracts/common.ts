import { z } from 'zod'

export const IMMUTABLE_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/i
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
export const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
export const VERSIONED_HASH_PATTERN = /^sha256:v1:[a-f0-9]{64}$/

export const immutableIdSchema = z
  .string()
  .regex(IMMUTABLE_ID_PATTERN, 'immutable ID must be a UUID or ULID')
export const ulidSchema = z.string().regex(ULID_PATTERN, 'audit event ID must be a ULID')
const isValidUtcTimestamp = (value: string): boolean => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/.exec(value)
  if (match === null) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString() === `${match[1]}.${match[2] ?? '000'}Z`
}

export const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN, 'timestamp must be RFC3339 UTC with Z')
  .refine(isValidUtcTimestamp, 'timestamp must be a real UTC calendar time')
export const versionedHashSchema = z
  .string()
  .regex(VERSIONED_HASH_PATTERN, 'hash must be sha256:v1:<64 lowercase hex>')
export const schemaVersionSchema = z.number().int().positive()
export const revisionSchema = z.number().int().positive()

export const RELATION_TYPES = [
  'source',
  'artifact',
  'taxonomy_node',
  'edge',
  'locale_variant',
  'page',
  'module',
  'publication_snapshot',
  'deletion_request',
  'user',
  'service',
] as const

export const relationRefSchema = z
  .object({ type: z.enum(RELATION_TYPES), id: immutableIdSchema })
  .strict()
export type RelationRef = z.infer<typeof relationRefSchema>

export const auditMetadataSchema = z
  .object({
    created_by: relationRefSchema,
    updated_by: relationRefSchema,
    correlation_id: immutableIdSchema,
  })
  .strict()

export const versionedCommandSchema = z
  .object({
    expected_revision: revisionSchema,
    current_revision: revisionSchema,
    correlation_id: immutableIdSchema,
    at: utcTimestampSchema,
  })
  .strict()

export type VersionedCommand = z.infer<typeof versionedCommandSchema>

export type TransitionDecision = Readonly<{
  allowed: boolean
  code: 'allowed' | 'guard_failed' | 'illegal_transition' | 'invalid_command' | 'version_conflict'
}>

export const allowedDecision = (): TransitionDecision => ({ allowed: true, code: 'allowed' })
export const rejectedDecision = (
  code: Exclude<TransitionDecision['code'], 'allowed'>,
): TransitionDecision => ({
  allowed: false,
  code,
})

export const hasExpectedRevision = (command: VersionedCommand): boolean =>
  command.expected_revision === command.current_revision

export class ImmutableRecordError extends Error {
  readonly code = 'immutable_record' as const

  constructor(field: string) {
    super(`${field} is immutable`)
    this.name = 'ImmutableRecordError'
  }
}

export const assertUnchanged = <T extends object, K extends keyof T>(
  current: T,
  next: T,
  fields: readonly K[],
): void => {
  for (const field of fields) {
    if (JSON.stringify(current[field]) !== JSON.stringify(next[field]))
      throw new ImmutableRecordError(String(field))
  }
}

export const auditEventSchema = z
  .object({
    event_id: ulidSchema,
    occurred_at: utcTimestampSchema,
    actor: relationRefSchema,
    correlation_id: immutableIdSchema,
    causation_id: immutableIdSchema.nullable(),
    entity: relationRefSchema,
    action: z.string().min(1),
    outcome: z.enum(['allowed', 'denied', 'failed']),
    before: z.record(z.string(), z.string()).nullable(),
    after: z.record(z.string(), z.string()).nullable(),
    reason_code: z.string().min(1).nullable(),
  })
  .strict()
export type AuditEvent = z.infer<typeof auditEventSchema>

export const assertAuditEventMutationAllowed = (_current: AuditEvent, _next: AuditEvent): never => {
  throw new ImmutableRecordError('audit_event')
}
