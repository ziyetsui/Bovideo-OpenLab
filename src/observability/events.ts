import { z } from 'zod'

import { observationContextSchema, type ObservationContext, type ObservabilityContext, validateTraceparent } from './context'
import { redactStructuredValue } from './redaction'
import { LocalAlertRouter } from './alerts'

const eventNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/)
const refValueSchema = z.string().min(1).max(512)
const scalarMetadataSchema = z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()])
const metadataSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  scalarMetadataSchema,
  z.array(metadataSchema).max(32),
  z.record(z.string().min(1).max(96), metadataSchema),
]))

export type StructuredLogEvent = Readonly<{
  schema_version: 1
  occurred_at: string
  environment: string
  version: string
  service: string
  entity_type: string
  entity_id: string
  outcome: string
  error_class: string | null
  duration_ms: number | null
  event_name: string
  correlation_id: string
  causation_id: string | null
  refs: Readonly<Record<string, string>>
  metadata: Readonly<Record<string, unknown>>
}>

export type StructuredLogSink = Readonly<{ record: (input: unknown) => void }>

const eventSchema = z.object({
  occurred_at: z.string().datetime({ offset: true }),
  environment: z.string().min(1).max(32),
  version: z.string().min(1).max(64),
  service: z.string().min(1).max(64),
  entity_type: z.string().min(1).max(64),
  entity_id: z.string().min(1).max(256),
  outcome: z.string().min(1).max(64),
  error_class: z.string().min(1).max(64).nullable(),
  duration_ms: z.number().finite().nonnegative().nullable(),
  event_name: eventNameSchema,
  correlation_id: observationContextSchema.shape.correlation_id,
  causation_id: observationContextSchema.shape.causation_id,
  refs: z.record(z.string().min(1).max(96), refValueSchema),
  metadata: z.record(z.string().min(1).max(96), metadataSchema),
}).strict()

const sanitizedRecord = (input: unknown): StructuredLogEvent => {
  const redacted = redactStructuredValue(input)
  if (typeof redacted !== 'object' || redacted === null || Array.isArray(redacted)) throw new Error('invalid structured event')
  const candidate = redacted as Record<string, unknown>
  const parsed = eventSchema.parse({
    occurred_at: candidate.occurred_at ?? new Date().toISOString(),
    environment: candidate.environment ?? 'local',
    version: candidate.version ?? 'p1-t08',
    service: candidate.service ?? 'bo-pseo-platform',
    entity_type: candidate.entity_type ?? 'unknown',
    entity_id: candidate.entity_id ?? candidate.correlation_id,
    outcome: candidate.outcome ?? 'observed',
    error_class: candidate.error_class ?? null,
    duration_ms: candidate.duration_ms ?? null,
    ...candidate,
  })
  return Object.freeze({ schema_version: 1, ...parsed })
}

/**
 * Local-only sink used by P1 contract tests. It has no transport, persistence
 * or network dependency and only retains the redacted event projection.
 */
export class RedactedStructuredLogTestDouble implements StructuredLogSink {
  readonly #records: StructuredLogEvent[] = []
  readonly #alerts = new LocalAlertRouter({ owner_by_route: {
    'queue.oldest_age': 'ingestion-oncall', 'queue.dlq': 'localization-oncall', 'withdraw.trigger': 'publishing-oncall',
    'redaction.failure': 'security-oncall', 'publish.validation_failure': 'publishing-oncall',
  } })

  record(input: unknown): void {
    try {
      this.#records.push(sanitizedRecord(input))
    } catch (error) {
      const candidate = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
      const correlation_id = typeof candidate.correlation_id === 'string' ? candidate.correlation_id : undefined
      const causation_id = typeof candidate.causation_id === 'string' ? candidate.causation_id : null
      if (correlation_id !== undefined) {
        this.#alerts.observe({ kind: 'redaction.failure', value: 1, context: { correlation_id, causation_id } })
      }
      throw error
    }
  }
  records(): readonly StructuredLogEvent[] { return this.#records.slice() }
  alerts(): readonly ReturnType<LocalAlertRouter['events']>[number][] { return this.#alerts.events() }
}

export const recordStructuredEvent = (
  sink: StructuredLogSink | undefined,
  input: Readonly<{ event_name: string; context: ObservationContext; refs: Record<string, string | null | undefined>; metadata: Record<string, unknown> }>,
): void => {
  if (sink === undefined) return
  const refs = Object.fromEntries(Object.entries(input.refs).flatMap(([key, value]) => value === undefined || value === null ? [] : [[key, value]]))
  sink.record({ event_name: input.event_name, ...input.context, refs, metadata: input.metadata })
}

/** Request context is intentionally optional: only tests inject this local sink. */
export const structuredLogSinkFromRequest = (request: unknown): StructuredLogSink | undefined => {
  const context = typeof request === 'object' && request !== null ? (request as { context?: unknown }).context : undefined
  const candidate = typeof context === 'object' && context !== null ? (context as { phase1ObservabilitySink?: unknown }).phase1ObservabilitySink : undefined
  return typeof candidate === 'object' && candidate !== null && typeof (candidate as { record?: unknown }).record === 'function'
    ? candidate as StructuredLogSink
    : undefined
}

export const requestObservationContext = (request: unknown, correlation_id: string): ObservationContext => {
  const context = typeof request === 'object' && request !== null ? (request as { context?: unknown }).context : undefined
  const causation_id = typeof context === 'object' && context !== null && typeof (context as { phase1CausationId?: unknown }).phase1CausationId === 'string'
    ? (context as { phase1CausationId: string }).phase1CausationId
    : null
  return observationContextSchema.parse({ correlation_id, causation_id })
}

const instrumentationNames = [
  'source.failure',
  'localization.qa_denied',
  'localization.review_denied',
  'publish.denied',
  'publication.pointer_cas_conflict',
  'queue.dlq.produced',
  'workflow.ingest',
  'workflow.queue',
  'workflow.translation',
  'workflow.publish',
  'workflow.export',
  'workflow.withdraw',
] as const
type InstrumentationName = (typeof instrumentationNames)[number]

export type InstrumentationTestDoubleSpan = Readonly<{
  kind: 'instrumentation-test-double'
  name: InstrumentationName
  context: ObservabilityContext
  attributes: Readonly<Record<string, unknown>>
}>
export type InstrumentationTestDoubleSink = Readonly<{ append: (span: InstrumentationTestDoubleSpan) => void }>

/** Compatibility test-double only; it has no telemetry backend or transport. */
export const emitInstrumentationTestDoubleSpan = (input: Readonly<{
  sink: InstrumentationTestDoubleSink
  name: InstrumentationName
  context: ObservabilityContext
  attributes: Readonly<Record<string, unknown>>
}>): void => {
  const redacted = redactStructuredValue(input)
  if (typeof redacted !== 'object' || redacted === null || Array.isArray(redacted)) throw new Error('invalid instrumentation test-double span')
  const record = redacted as Record<string, unknown>
  if (Object.keys(record).length !== 4 || Object.keys(record).some((key) => !['sink', 'name', 'context', 'attributes'].includes(key))) throw new Error('invalid instrumentation test-double span')
  if (typeof record.sink !== 'object' || record.sink === null || typeof (record.sink as { append?: unknown }).append !== 'function') throw new Error('invalid instrumentation test-double span sink')
  if (!(instrumentationNames as readonly string[]).includes(record.name as string)) throw new Error('unknown instrumentation test-double span')
  if (typeof record.context !== 'object' || record.context === null || Array.isArray(record.context)) throw new Error('invalid instrumentation test-double span context')
  const contextRecord = record.context as Record<string, unknown>
  if (Object.keys(contextRecord).some((key) => !['correlation_id', 'causation_id', 'traceparent'].includes(key))) throw new Error('invalid instrumentation test-double span context')
  const context = Object.freeze({
    ...observationContextSchema.parse({ correlation_id: contextRecord.correlation_id, causation_id: contextRecord.causation_id }),
    traceparent: validateTraceparent(contextRecord.traceparent),
  })
  if (typeof record.attributes !== 'object' || record.attributes === null || Array.isArray(record.attributes)) throw new Error('invalid instrumentation test-double span attributes')
  input.sink.append(Object.freeze({
    kind: 'instrumentation-test-double',
    name: record.name as InstrumentationName,
    context,
    attributes: Object.freeze(record.attributes as Record<string, unknown>),
  }))
}
