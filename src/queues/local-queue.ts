import { createHash } from 'node:crypto'
import { z } from 'zod'

import { auditEventSchema, relationRefSchema, ulidSchema, utcTimestampSchema, type AuditEvent, type RelationRef } from '@/contracts/common'
import type { QueueEnvelope } from '@/contracts/queue'
import type { Principal, ServiceScope } from '@/access/principals'
import { observationContext } from '@/observability/context'
import { LocalAlertRouter } from '@/observability/alerts'
import { LocalPhase1ObservabilityBoundary } from '@/observability/boundaries'
import { recordStructuredEvent, type InstrumentationTestDoubleSink, type StructuredLogSink } from '@/observability/events'

import type { QueueClock } from './idempotency-store'
import { canonicalJson } from './idempotency-store'
import { immutableClone, parseQueueEnvelope, type TranslationKeyRegistry } from './envelope'

export type DeadLetter = Readonly<{
  id: string
  original: Readonly<QueueEnvelope>
  original_hash: string
  reason: Readonly<{ code: string }>
  created_at: string
}>
export const queueAlertEventSchema = z.object({ event_type: z.literal('queue.dlq.produced'), correlation_id: ulidSchema, causation_id: ulidSchema.nullable(), entity_ref: relationRefSchema, dlq_id: ulidSchema, occurred_at: utcTimestampSchema }).strict()
export type QueueAlertEvent = Readonly<z.infer<typeof queueAlertEventSchema>>
export type QueueAuditSink = Readonly<{ append: (event: AuditEvent) => Promise<void> }>

const domainScope: Readonly<Record<QueueEnvelope['kind'], ServiceScope>> = {
  ingest: 'ingest', translate: 'translate', browser: 'ingest', publish: 'publish', export: 'publish', withdraw: 'withdraw',
}
/** Separate normal and emergency-withdraw buffers; this local emulator never models production throughput. */
export class LocalQueue {
  readonly #normal: QueueEnvelope[] = []
  readonly #withdraw: QueueEnvelope[] = []
  readonly #dlq: DeadLetter[] = []
  readonly #alerts: QueueAlertEvent[] = []
  readonly #auditEvents: AuditEvent[] = []
  readonly #replays = new Map<string, Readonly<{ envelope: QueueEnvelope; audit: AuditEvent }>>()
  readonly #replayReservations = new Map<string, Readonly<{ fingerprint: string; promise: Promise<Readonly<{ envelope: QueueEnvelope; audit: AuditEvent }>> }>>()
  readonly #normalCapacity: number
  readonly #emergencyWithdrawCapacity: number
  readonly #clock: QueueClock
  readonly #audit?: QueueAuditSink
  readonly #observability?: StructuredLogSink
  readonly #alertRouter?: LocalAlertRouter
  readonly #instrumentation?: InstrumentationTestDoubleSink
  readonly #idFactory: () => string
  readonly #translationRegistry?: TranslationKeyRegistry
  #normalReserved = 0
  #withdrawReserved = 0

  constructor(input: Readonly<{ normalCapacity: number; emergencyWithdrawCapacity: number; clock: QueueClock; idFactory: () => string; audit?: QueueAuditSink; translationRegistry?: TranslationKeyRegistry; observability?: StructuredLogSink; instrumentation?: InstrumentationTestDoubleSink; alertRouter?: LocalAlertRouter }>) {
    this.#normalCapacity = input.normalCapacity
    this.#emergencyWithdrawCapacity = input.emergencyWithdrawCapacity
    this.#clock = input.clock
    this.#audit = input.audit
    this.#observability = input.observability
    this.#alertRouter = input.alertRouter ?? new LocalAlertRouter({ owner_by_route: {
      'queue.oldest_age': 'ingestion-oncall', 'queue.dlq': 'localization-oncall', 'withdraw.trigger': 'publishing-oncall',
      'redaction.failure': 'security-oncall', 'publish.validation_failure': 'publishing-oncall',
    } })
    this.#instrumentation = input.instrumentation
    this.#idFactory = input.idFactory
    this.#translationRegistry = input.translationRegistry
  }

  enqueue(input: unknown): void {
    const parsed = parseQueueEnvelope(input, this.#translationRegistry)
    const traceparent = parsed.traceparent ?? (() => {
      const trace = createHash('sha256').update(parsed.correlation_id).digest('hex')
      return `00-${trace}-${trace.slice(0, 16)}-01`
    })()
    const envelope = immutableClone({ ...parsed, traceparent })
    if (envelope.kind === 'withdraw' && envelope.priority === 'emergency') {
      if (this.#withdraw.length + this.#withdrawReserved >= this.#emergencyWithdrawCapacity) throw new Error('emergency withdrawal queue is full')
      this.#withdraw.push(envelope)
      this.#recordEnqueued(envelope)
      return
    }
    if (this.#normal.length + this.#normalReserved >= this.#normalCapacity) throw new Error('normal queue is full')
    this.#normal.push(envelope)
    this.#recordEnqueued(envelope)
  }

  #recordEnqueued(envelope: QueueEnvelope): void {
    recordStructuredEvent(this.#observability, {
      event_name: 'queue.enqueued', context: observationContext({ correlation_id: envelope.correlation_id, causation_id: envelope.causation_id }),
      refs: { job_id: envelope.job_id, entity_id: envelope.entity_ref.id, source_hash: envelope.expected_source_version },
      metadata: { kind: envelope.kind, priority: envelope.priority, attempt: envelope.attempt },
    })
    LocalPhase1ObservabilityBoundary.recordQueueEnqueued(this.#instrumentation, envelope)
  }

  dequeue(lane: 'normal' | 'withdraw'): QueueEnvelope | undefined {
    const envelope = lane === 'withdraw' ? this.#withdraw.shift() : this.#normal.shift()
    if (envelope !== undefined) {
      const ageSeconds = Math.max(0, (Date.parse(this.#clock.now()) - Date.parse(envelope.enqueued_at)) / 1000)
      this.#alertRouter?.observe({ kind: 'queue.oldest_age', value: ageSeconds, context: observationContext({ correlation_id: envelope.correlation_id, causation_id: envelope.causation_id }) })
      if (lane === 'withdraw') this.#alertRouter?.observe({ kind: 'withdraw.trigger', value: ageSeconds, context: observationContext({ correlation_id: envelope.correlation_id, causation_id: envelope.causation_id }) })
    }
    return envelope
  }

  toDlq(input: unknown, reason: Readonly<{ code: string; message?: string }>): DeadLetter {
    const original = immutableClone(parseQueueEnvelope(input, this.#translationRegistry))
    // Validate every generated value before mutating either durable collection.
    const id = ulidSchema.parse(this.#idFactory())
    const createdAt = utcTimestampSchema.parse(this.#clock.now())
    const alert = immutableClone(queueAlertEventSchema.parse({
      event_type: 'queue.dlq.produced',
      correlation_id: original.correlation_id,
      causation_id: original.causation_id,
      entity_ref: original.entity_ref,
      dlq_id: id,
      occurred_at: createdAt,
    }))
    const letter = Object.freeze({
      id,
      original,
      original_hash: `sha256:v1:${createHash('sha256').update(canonicalJson(original)).digest('hex')}`,
      reason: Object.freeze({ code: reason.code }),
      created_at: createdAt,
    })
    this.#dlq.push(letter)
    this.#alerts.push(alert)
    this.#alertRouter?.observe({
      kind: 'queue.dlq',
      value: 1,
      context: observationContext({ correlation_id: original.correlation_id, causation_id: original.causation_id }),
    })
    return letter
  }

  dlq(): readonly DeadLetter[] { return this.#dlq.slice() }
  /** Producer evidence only. T08 owns rerun, routing, owner and context closure. */
  alerts(): readonly QueueAlertEvent[] { return this.#alerts.slice() }
  audits(): readonly AuditEvent[] { return this.#auditEvents.slice() }

  async replay(
    id: string,
    principal: Principal,
    input: Readonly<{ jobId: string; correlationId: string; reason: string; replayIdempotencyKey: string }>,
  ): Promise<Readonly<{ envelope: QueueEnvelope; audit: AuditEvent }>> {
    // Every caller must prove access before it can observe an existing reservation/result.
    const letter = this.#dlq.find((candidate) => candidate.id === id)
    if (!letter) throw new Error('DLQ record not found')
    if (!input.reason.trim()) throw new Error('replay reason is required')
    if (!/^[A-Za-z0-9:_-]{1,512}$/.test(input.replayIdempotencyKey)) throw new Error('invalid replay idempotency key')
    const scope = domainScope[letter.original.kind]
    if (!principal.roles.includes('admin') && !principal.serviceScopes.includes(scope)) {
      await this.#appendAudit(this.#newAudit(letter, principal, input, 'denied'))
      throw new Error('forbidden')
    }
    const fingerprint = canonicalJson({ id, jobId: input.jobId, correlationId: input.correlationId, reason: input.reason, domain: scope, principal: principal.id })
    const reserved = this.#replayReservations.get(input.replayIdempotencyKey)
    if (reserved) {
      if (reserved.fingerprint !== fingerprint) throw new Error('replay idempotency fingerprint conflict')
      return reserved.promise
    }
    const promise = this.#replayOnce(letter, principal, input)
    this.#replayReservations.set(input.replayIdempotencyKey, { fingerprint, promise })
    try { return await promise } catch (error) { this.#replayReservations.delete(input.replayIdempotencyKey); throw error }
  }

  async #replayOnce(
    letter: DeadLetter,
    principal: Principal,
    input: Readonly<{ jobId: string; correlationId: string; reason: string; replayIdempotencyKey: string }>,
  ): Promise<Readonly<{ envelope: QueueEnvelope; audit: AuditEvent }>> {
    const existingReplay = this.#replays.get(input.replayIdempotencyKey)
    if (existingReplay) return existingReplay
    const envelope = immutableClone(parseQueueEnvelope({
      ...letter.original,
      job_id: input.jobId,
      correlation_id: input.correlationId,
      causation_id: letter.id,
      attempt: 0,
      idempotency_key: letter.original.idempotency_key,
      enqueued_at: this.#clock.now(),
    }, this.#translationRegistry))
    const withdrawLane = envelope.kind === 'withdraw' && envelope.priority === 'emergency'
    if (withdrawLane) {
      if (this.#withdraw.length + this.#withdrawReserved >= this.#emergencyWithdrawCapacity) throw new Error('emergency withdrawal queue is full')
      this.#withdrawReserved += 1
    } else {
      if (this.#normal.length + this.#normalReserved >= this.#normalCapacity) throw new Error('normal queue is full')
      this.#normalReserved += 1
    }
    const audit = this.#newAudit(letter, principal, input, 'allowed')
    try {
      await this.#appendAudit(audit)
      if (withdrawLane) this.#withdraw.push(envelope)
      else this.#normal.push(envelope)
    } finally {
      if (withdrawLane) this.#withdrawReserved -= 1
      else this.#normalReserved -= 1
    }
    const replay = Object.freeze({ envelope, audit })
    this.#replays.set(input.replayIdempotencyKey, replay)
    return replay
  }

  #newAudit(
    letter: DeadLetter,
    principal: Principal,
    input: Readonly<{ correlationId: string; reason: string; replayIdempotencyKey: string }>,
    outcome: 'allowed' | 'denied',
  ): AuditEvent {
    const actorType: RelationRef['type'] = principal.kind === 'service' ? 'service' : 'user'
    return immutableClone(auditEventSchema.parse({
      event_id: this.#idFactory(), occurred_at: this.#clock.now(), actor: { type: actorType, id: principal.id },
      correlation_id: input.correlationId, causation_id: letter.id, entity: letter.original.entity_ref,
      action: 'queue.dlq.replay', outcome, before: { original_hash: letter.original_hash },
      after: outcome === 'allowed' ? { replay_request: input.replayIdempotencyKey } : null,
      reason_code: input.reason,
    }))
  }

  async #appendAudit(event: AuditEvent): Promise<void> {
    if (this.#audit) await this.#audit.append(event)
    this.#auditEvents.push(event)
  }
}
