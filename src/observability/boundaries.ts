import type { QueueEnvelope } from '@/contracts/queue'
import type { LocalQueue } from '@/queues/local-queue'

import { createRootObservabilityContext, resumeObservabilityContext, validateTraceparent, type ObservabilityContext } from './context'
import { emitInstrumentationTestDoubleSpan, type InstrumentationTestDoubleSink } from './events'
import type { LocalAlertRouter } from './alerts'

export type LocalQueueDelivery = Readonly<{ envelope: QueueEnvelope; context: ObservabilityContext }>

const queueInstrumentationName = (kind: QueueEnvelope['kind']): 'workflow.ingest' | 'workflow.queue' =>
  kind === 'ingest' ? 'workflow.ingest' : 'workflow.queue'

const testDoubleInstrumentationName = (kind: QueueEnvelope['kind']): 'workflow.publish' | 'workflow.export' | 'workflow.withdraw' => {
  if (kind === 'publish') return 'workflow.publish'
  if (kind === 'export') return 'workflow.export'
  if (kind === 'withdraw') return 'workflow.withdraw'
  throw new Error('only publish, export, and withdraw are local instrumentation test doubles')
}

/**
 * Local-only carrier between the actual P1 LocalQueue and P1 command/test-double boundaries.
 * It stores no payload text: only the validated trace context associated with a queued job.
 */
export class LocalPhase1ObservabilityBoundary {
  readonly #queue: LocalQueue
  readonly #sink: InstrumentationTestDoubleSink
  readonly #alerts?: LocalAlertRouter

  constructor(input: Readonly<{ queue: LocalQueue; sink: InstrumentationTestDoubleSink; alerts?: LocalAlertRouter }>) {
    this.#queue = input.queue
    this.#sink = input.sink
    this.#alerts = input.alerts
  }

  /** Used by the P1 queue runtime after its schema has accepted a ref-only envelope. */
  static contextFromQueueEnvelope(envelope: QueueEnvelope): ObservabilityContext | undefined {
    if (envelope.traceparent === undefined || envelope.causation_id === null) return undefined
    return resumeObservabilityContext({
      context: createRootObservabilityContext({ correlation_id: envelope.correlation_id, traceparent: envelope.traceparent }),
      causation_id: envelope.causation_id,
    })
  }

  static recordQueueEnqueued(sink: InstrumentationTestDoubleSink | undefined, envelope: QueueEnvelope): void {
    if (sink === undefined) return
    const context = LocalPhase1ObservabilityBoundary.contextFromQueueEnvelope(envelope)
    if (context === undefined) throw new Error('instrumented queue envelope requires traceparent and causation_id')
    emitInstrumentationTestDoubleSpan({
      sink,
      name: queueInstrumentationName(envelope.kind),
      context,
      attributes: { queue_kind: envelope.kind, attempt: envelope.attempt },
    })
  }

  static recordQueueConsumed(sink: InstrumentationTestDoubleSink | undefined, envelope: QueueEnvelope): void {
    if (sink === undefined) return
    const context = LocalPhase1ObservabilityBoundary.contextFromQueueEnvelope(envelope)
    if (context === undefined) throw new Error('instrumented queue envelope requires traceparent and causation_id')
    emitInstrumentationTestDoubleSpan({
      sink,
      name: 'workflow.queue',
      context,
      attributes: { queue_kind: envelope.kind, attempt: envelope.attempt },
    })
  }

  /** The locale staleness command is the P1 localization runtime boundary, not a remote translator. */
  static recordLocalization(input: Readonly<{
    sink: InstrumentationTestDoubleSink | undefined
    correlation_id: string
    causation_id: string | null | undefined
    traceparent: string | undefined
  }>): void {
    if (input.sink === undefined) return
    if (input.traceparent === undefined || input.causation_id === null || input.causation_id === undefined) throw new Error('instrumented localization boundary requires traceparent and causation_id')
    const context = resumeObservabilityContext({
      context: createRootObservabilityContext({ correlation_id: input.correlation_id, traceparent: input.traceparent }),
      causation_id: input.causation_id,
    })
    emitInstrumentationTestDoubleSpan({ sink: input.sink, name: 'workflow.translation', context, attributes: { boundary: 'locale_staleness' } })
  }

  enqueue(input: Readonly<{ parent: ObservabilityContext; envelope: QueueEnvelope }>): ObservabilityContext {
    if (input.envelope.correlation_id !== input.parent.correlation_id)
      throw new Error('queue envelope must retain the parent correlation id')
    if (input.envelope.causation_id === null) throw new Error('queue envelope requires a causation id')
    const context = resumeObservabilityContext({ context: input.parent, causation_id: input.envelope.causation_id })
    if (input.envelope.traceparent !== undefined && validateTraceparent(input.envelope.traceparent) !== context.traceparent)
      throw new Error('queue envelope cannot replace the parent trace')
    this.#queue.enqueue({ ...input.envelope, traceparent: context.traceparent })
    emitInstrumentationTestDoubleSpan({
      sink: this.#sink,
      name: queueInstrumentationName(input.envelope.kind),
      context,
      attributes: { queue_kind: input.envelope.kind, attempt: input.envelope.attempt },
    })
    return context
  }

  dequeue(lane: 'normal' | 'withdraw'): LocalQueueDelivery | undefined {
    const envelope = this.#queue.dequeue(lane)
    if (envelope === undefined) return undefined
    const context = LocalPhase1ObservabilityBoundary.contextFromQueueEnvelope(envelope)
    if (context === undefined) throw new Error('queued job has no observability context')
    emitInstrumentationTestDoubleSpan({
      sink: this.#sink,
      name: 'workflow.queue',
      context,
      attributes: { queue_kind: envelope.kind, attempt: envelope.attempt, lane },
    })
    return Object.freeze({ envelope, context })
  }

  translate<T>(delivery: LocalQueueDelivery, command: () => T): T {
    if (delivery.envelope.kind !== 'translate') throw new Error('translation boundary requires a translate queue job')
    emitInstrumentationTestDoubleSpan({
      sink: this.#sink,
      name: 'workflow.translation',
      context: delivery.context,
      attributes: { queue_kind: delivery.envelope.kind, attempt: delivery.envelope.attempt },
    })
    return command()
  }

  /** P1 explicitly models these as instrumentation test doubles, never P2 publish/export services. */
  instrumentTestDouble(delivery: LocalQueueDelivery, validation: Readonly<{ valid: boolean }> = { valid: true }): void {
    emitInstrumentationTestDoubleSpan({
      sink: this.#sink,
      name: testDoubleInstrumentationName(delivery.envelope.kind),
      context: delivery.context,
      attributes: { queue_kind: delivery.envelope.kind, attempt: delivery.envelope.attempt },
    })
    if (delivery.envelope.kind === 'publish' && !validation.valid) {
      this.#alerts?.observe({ kind: 'publish.validation_failure', value: 1, context: delivery.context })
      throw new Error('publish validation failed')
    }
  }
}
