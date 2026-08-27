import { auditEventSchema, immutableIdSchema, type AuditEvent } from '@/contracts/common'

import { redactStructuredValue } from './redaction'

const auditRoles = ['admin', 'legal'] as const
type AuditRole = (typeof auditRoles)[number]
type AuditReader = Readonly<{ id: string; roles: readonly string[] }>
export type RestrictedAuditQuery = Readonly<{ correlation_id: string; limit: number; requested_by: string }>

/** Query capabilities are opaque at runtime: only this builder can mint one. */
const authorizedQueries = new WeakMap<object, AuditRole>()
let auditSequence = 0
const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const nextAuditEventId = (): string => {
  let value = auditSequence++
  let suffix = ''
  for (let index = 0; index < 24; index += 1) {
    suffix = crockford[value % 32] + suffix
    value = Math.floor(value / 32)
  }
  return `01${suffix}`
}

const isAuditRole = (role: string): role is AuditRole => (auditRoles as readonly string[]).includes(role)
const validateAuditReader = (input: AuditReader): Readonly<{ id: string; role: AuditRole }> => {
  const id = immutableIdSchema.parse(input.id)
  if (!Array.isArray(input.roles) || input.roles.some((role) => typeof role !== 'string')) throw new Error('restricted audit query requires valid actor roles')
  const role = input.roles.find(isAuditRole)
  if (role === undefined) throw new Error('restricted audit query requires an audit role')
  return Object.freeze({ id, role })
}
const parseRestrictedQuery = (input: unknown): RestrictedAuditQuery => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('restricted audit query requires a capability')
  const record = input as Record<string, unknown>
  if (Object.keys(record).length !== 3 || !Object.hasOwn(record, 'correlation_id') || !Object.hasOwn(record, 'limit') || !Object.hasOwn(record, 'requested_by')) throw new Error('invalid restricted audit query')
  const correlation_id = immutableIdSchema.parse(record.correlation_id)
  const requested_by = immutableIdSchema.parse(record.requested_by)
  if (!Number.isInteger(record.limit) || (record.limit as number) < 1 || (record.limit as number) > 100) throw new Error('invalid audit query limit')
  return Object.freeze({ correlation_id, limit: record.limit as number, requested_by })
}
const sanitizeAuditEvent = (event: unknown): AuditEvent => auditEventSchema.parse(redactStructuredValue(event))

/** Builds a bounded local audit read; generic editors may not query immutable audit facts. */
export class AuditQueryBuilder {
  readonly #input: Readonly<{ actor: AuditReader; correlation_id: string; limit: number }>
  constructor(input: Readonly<{ actor: AuditReader; correlation_id: string; limit: number }>) { this.#input = input }
  build(): RestrictedAuditQuery {
    const actor = validateAuditReader(this.#input.actor)
    const query = parseRestrictedQuery({ correlation_id: this.#input.correlation_id, limit: this.#input.limit, requested_by: actor.id })
    authorizedQueries.set(query, actor.role)
    return query
  }
}

/** In-memory local test double retaining access facts separately from redacted results. */
export class InMemoryAuditQuerySink {
  readonly #events: readonly AuditEvent[]
  readonly #accesses: RestrictedAuditQuery[] = []
  readonly #accessAudits: AuditEvent[] = []
  constructor(events: readonly AuditEvent[]) { this.#events = events.map(sanitizeAuditEvent) }
  query(query: unknown): readonly AuditEvent[] {
    const parsed = parseRestrictedQuery(query)
    if (typeof query !== 'object' || query === null || authorizedQueries.get(query) === undefined) throw new Error('restricted audit query requires an authorized capability')
    this.#accesses.push(parsed)
    this.#accessAudits.push(auditEventSchema.parse({
      event_id: nextAuditEventId(),
      occurred_at: new Date().toISOString(),
      actor: { type: 'user', id: parsed.requested_by },
      correlation_id: parsed.correlation_id,
      causation_id: null,
      entity: { type: 'service', id: parsed.requested_by },
      action: 'audit.query.read',
      outcome: 'allowed',
      before: null,
      after: { limit: String(parsed.limit) },
      reason_code: null,
    }))
    return this.#events.filter((event) => event.correlation_id === parsed.correlation_id).slice(0, parsed.limit).map((event) => Object.freeze({ ...event }))
  }
  accesses(): readonly RestrictedAuditQuery[] { return this.#accesses.slice() }
  accessAudits(): readonly AuditEvent[] { return this.#accessAudits.slice().map((event) => Object.freeze({ ...event })) }
}
