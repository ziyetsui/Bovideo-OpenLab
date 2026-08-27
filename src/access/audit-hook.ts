import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'

import { createUlid } from './ulid'
import type { Principal } from './principals'
import { principalFromPayloadUser } from './principals'
import { observationContext } from '@/observability/context'
import { recordStructuredEvent, structuredLogSinkFromRequest } from '@/observability/events'

export type AuditOutcome = 'allowed' | 'denied' | 'failed'

export type AuditEventInput = Readonly<{
  action: string
  actor: Principal
  entity: Readonly<{ type: string; id: string }>
  correlationId: string
  causationId?: string | null
  outcome: AuditOutcome
  reasonCode: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}>

export type StoredAuditEvent = Readonly<{
  event_id: string
  stable_id: string
  schema_version: number
  source_version: string
  status: 'recorded'
  actor_service: string | null
  actor_user: number | null
  actor_type: 'user' | 'service' | 'anonymous'
  actor_stable_id: string
  correlation_id: string
  causation_id: string | null
  event_type: string
  entity_type: string
  entity_stable_id: string
  outcome: AuditOutcome
  prior_state: Record<string, unknown> | null
  new_state: Record<string, unknown> | null
  reason_code: string | null
  occurred_at: string
}>

const allowedDiffFields = new Set([
  'status',
  'workflow_state',
  'index_state',
  'rights_state',
  'safety_state',
  'evidence_state',
  'deletion_state',
  'review_state',
  'promotion_state',
  'published_version',
  'schema_version',
  'source_version',
  'qualification_input_hash',
  'metrics_input_hash',
  'reviewed_by_stable_id',
  'reviewed_revision',
  'identity_kind',
  'roles',
  'service_scopes',
  'reason_code',
  'revision',
  'publish_version',
  'previous_verified_version',
  'singleton_key',
])

const sensitiveField = /(authorization|cookie|api[_-]?key|token|secret|password|prompt|original_text|localized|email|ip|header|raw_ref|private)/i
const sensitiveValue = /(bearer\s+|(?:api[_-]?key|token|secret|cookie|session|password)\s*[=:]|@)/i

/** Removes both disallowed field names and recursively sensitive nested values. */
const redactNestedValue = (value: unknown): unknown | undefined => {
  if (typeof value === 'string' && sensitiveValue.test(value)) return undefined
  if (Array.isArray(value)) return value.flatMap((entry) => {
    const redacted = redactNestedValue(entry)
    return redacted === undefined ? [] : [redacted]
  })
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      if (sensitiveField.test(key)) return []
      const redacted = redactNestedValue(child)
      return redacted === undefined ? [] : [[key, redacted]]
    }),
  )
}

export const redactAuditValue = (value: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (value === null) return null
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (!allowedDiffFields.has(key) || sensitiveField.test(key)) return []
      const redacted = redactNestedValue(child)
      return redacted === undefined ? [] : [[key, redacted]]
    }),
  )
}

const now = (): string => new Date().toISOString()
export const buildAuditEvent = (input: AuditEventInput): StoredAuditEvent => ({
  event_id: createUlid(),
  stable_id: createUlid(),
  schema_version: 1,
  source_version: `audit:${input.action}`,
  status: 'recorded',
  actor_service: input.actor.kind === 'service' ? input.actor.id : null,
  actor_user:
    input.actor.kind === 'user' && typeof input.actor.payloadUserId === 'number'
      ? input.actor.payloadUserId
      : null,
  actor_type: input.actor.kind === 'anonymous' ? 'anonymous' : input.actor.kind,
  actor_stable_id: input.actor.id,
  correlation_id: input.correlationId,
  causation_id: input.causationId ?? null,
  event_type: input.action,
  entity_type: input.entity.type,
  entity_stable_id: input.entity.id,
  outcome: input.outcome,
  prior_state: redactAuditValue(input.before),
  new_state: redactAuditValue(input.after),
  reason_code: input.reasonCode,
  occurred_at: now(),
})

const recordData = (doc: unknown): Record<string, unknown> =>
  typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : {}

const correlationIDFrom = (record: Record<string, unknown>): string =>
  typeof record.audit === 'object' &&
  record.audit !== null &&
  typeof (record.audit as Record<string, unknown>).correlation_id === 'string'
    ? String((record.audit as Record<string, unknown>).correlation_id)
    : globalThis.crypto.randomUUID()

const appendAuditEvent = async (
  collection: string,
  operation: string,
  req: PayloadRequest,
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): Promise<void> => {
  const entity = Object.keys(current).length > 0 ? current : previous
  await req.payload.create({
    collection: 'audit-events',
    data: buildAuditEvent({
      action: `${collection}.${operation}`,
      actor: principalFromPayloadUser(req.user),
      entity: { type: collection, id: String(entity.stable_id ?? entity.id) },
      correlationId: correlationIDFrom(entity),
      outcome: 'allowed',
      reasonCode: null,
      before: Object.keys(previous).length > 0 ? previous : null,
      after: Object.keys(current).length > 0 ? current : null,
    }) as never,
    req,
    overrideAccess: true,
  })
}

/** Emits an immutable event in the caller's transaction. An audit failure aborts the mutation. */
export const createAuditAfterChangeHook = (collection: string): CollectionAfterChangeHook =>
  async ({ doc, operation, previousDoc, req }) => {
    if (collection === 'audit-events') return doc
    const current = recordData(doc)
    const previous = recordData(previousDoc)
    await appendAuditEvent(collection, operation, req, previous, current)
    return doc
  }

/** Emits deletion evidence before the caller's transaction commits. */
export const createAuditAfterDeleteHook = (collection: string): CollectionAfterDeleteHook =>
  async ({ doc, req }) => {
    if (collection === 'audit-events') return doc
    await appendAuditEvent(collection, 'delete', req, recordData(doc), {})
    return doc
  }

/** Emits the one immutable audit event for an accepted private pointer command. */
export const createPointerAuditAfterChangeHook: CollectionAfterChangeHook = async ({
  doc,
  operation,
  previousDoc,
  req,
}) => {
  const context = req.context as Record<string, unknown> | undefined
  const command = context?.phase1PointerCommand
  if (typeof command !== 'object' || command === null) {
    throw new Error('accepted publication pointer mutation is missing its private command')
  }
  const commandValue = command as Record<string, unknown>
  if (typeof commandValue.correlation_id !== 'string' || typeof commandValue.reason_code !== 'string') {
    throw new Error('accepted publication pointer mutation has an invalid private command')
  }
  const current = recordData(doc)
  const previous = recordData(previousDoc)
  await req.payload.create({
    collection: 'audit-events',
    data: buildAuditEvent({
      action: 'active-publication-pointers.publish',
      actor: principalFromPayloadUser(req.user),
      entity: { type: 'active-publication-pointers', id: String(current.stable_id ?? current.id) },
      correlationId: commandValue.correlation_id,
      outcome: 'allowed',
      reasonCode: commandValue.reason_code,
      before: operation === 'create' ? null : previous,
      after: current,
    }) as never,
    req,
    overrideAccess: true,
  })
  recordStructuredEvent(structuredLogSinkFromRequest(req), {
    event_name: 'publication.pointer_audited',
    context: observationContext({ correlation_id: commandValue.correlation_id, causation_id: typeof commandValue.causation_id === 'string' ? commandValue.causation_id : null }),
    refs: { pointer_id: String(current.stable_id ?? current.id) },
    metadata: { operation, outcome: 'allowed', reason_code: commandValue.reason_code },
  })
  return doc
}
