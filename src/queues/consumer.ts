import type { QueueEnvelope } from '@/contracts/queue'
import { observationContext } from '@/observability/context'
import { LocalPhase1ObservabilityBoundary } from '@/observability/boundaries'
import { recordStructuredEvent, type InstrumentationTestDoubleSink, type StructuredLogSink } from '@/observability/events'

import type { QueueMessageOutcome } from './envelope'
import type { DurableEffectReceipt, InMemoryIdempotencyStore } from './idempotency-store'
import type { WithdrawalTombstones } from './withdraw'

export class QueueConsumer {
  readonly #store: InMemoryIdempotencyStore
  readonly #sourceVersion: (envelope: QueueEnvelope) => string | null
  readonly #tombstones?: WithdrawalTombstones
  readonly #observability?: StructuredLogSink
  readonly #instrumentation?: InstrumentationTestDoubleSink

  constructor(input: Readonly<{
    store: InMemoryIdempotencyStore
    sourceVersion: (envelope: QueueEnvelope) => string | null
    tombstones?: WithdrawalTombstones
    observability?: StructuredLogSink
    instrumentation?: InstrumentationTestDoubleSink
  }>) {
    this.#store = input.store
    this.#sourceVersion = input.sourceVersion
    this.#tombstones = input.tombstones
    this.#observability = input.observability
    this.#instrumentation = input.instrumentation
  }

  /** Effects must be synchronous local transaction mutations, never arbitrary async external work. */
  async consume(envelope: QueueEnvelope, sideEffect: () => DurableEffectReceipt): Promise<QueueMessageOutcome> {
    if (sideEffect.constructor.name === 'AsyncFunction')
      throw new Error('local queue effect must be synchronous')
    if (envelope.kind !== 'withdraw' && this.#tombstones?.get(envelope.entity_ref))
      return this.#recordOutcome(envelope, { status: 'stale_ignored', reason: 'withdrawn' })
    // Fast rejection is only an optimization; commit performs the authoritative in-lock recheck.
    if (envelope.expected_source_version !== null && envelope.expected_source_version !== this.#sourceVersion(envelope))
      return this.#recordOutcome(envelope, { status: 'stale_ignored', reason: 'source_version' })
    const claim = await this.#store.claim(envelope)
    if (claim.kind === 'duplicate') return this.#recordOutcome(envelope, { status: 'duplicate' })
    if (claim.kind === 'busy') return this.#recordOutcome(envelope, { status: 'duplicate' })
    if (claim.kind === 'conflict') throw new Error('idempotency key request fingerprint conflict')
    const result = await this.#store.commit(envelope, claim.token, () => this.#sourceVersion(envelope), () => {
      const receipt = sideEffect()
      if (envelope.kind === 'withdraw' && this.#tombstones) {
        const requestVersion = withdrawalRequestVersion(envelope.idempotency_key)
        this.#tombstones.record({ entityRef: envelope.entity_ref, requestVersion, correlationId: envelope.correlation_id })
      }
      return receipt
    })
    if (result === 'processed') return this.#recordOutcome(envelope, { status: 'processed' })
    if (result === 'stale_ignored') return this.#recordOutcome(envelope, { status: 'stale_ignored', reason: 'source_version' })
    throw new Error('claim token lost before effect commit')
  }

  #recordOutcome(envelope: QueueEnvelope, outcome: QueueMessageOutcome): QueueMessageOutcome {
    recordStructuredEvent(this.#observability, {
      event_name: 'queue.consumed', context: observationContext({ correlation_id: envelope.correlation_id, causation_id: envelope.causation_id }),
      refs: { job_id: envelope.job_id, entity_id: envelope.entity_ref.id, source_hash: envelope.expected_source_version },
      metadata: { kind: envelope.kind, outcome: outcome.status, reason: 'reason' in outcome ? outcome.reason : null },
    })
    LocalPhase1ObservabilityBoundary.recordQueueConsumed(this.#instrumentation, envelope)
    return outcome
  }
}

const withdrawalRequestVersion = (key: string): number => {
  const match = /^withdraw:[^:]+:([1-9][0-9]*)$/.exec(key)
  if (!match) throw new Error('withdraw envelope has no canonical request version')
  return Number(match[1])
}
