import { describe, expect, it } from 'vitest'

import { auditEventSchema } from '@/contracts/common'
import { LocalQueue } from '@/queues/local-queue'
import {
  AuditQueryBuilder,
  InMemoryAuditQuerySink,
  InMemoryMetricSink,
  LocalAlertRouter,
  createRootObservabilityContext,
  emitInstrumentationTestDoubleSpan,
  redactObservabilityValue,
  resumeObservabilityContext,
  type InstrumentationTestDoubleSpan,
} from '@/observability'

const ID_A = '01J0J0J0J0J0J0J0J0J0J0J0J0'
const ID_B = '01J0J0J0J0J0J0J0J0J0J0J0J1'
const ID_C = '01J0J0J0J0J0J0J0J0J0J0J0J2'
const HASH = `sha256:v1:${'a'.repeat(64)}`
const at = '2026-08-25T00:00:00.000Z'

const context = () => createRootObservabilityContext({
  correlation_id: ID_A,
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
})

describe('P1-T08 local observability foundation', () => {
  it('continues trusted correlation and causation across queue, translation, test-double publish/export, and withdrawal', () => {
    const ingest = context()
    const queue = resumeObservabilityContext({ context: ingest, causation_id: ID_B })
    const translation = resumeObservabilityContext({ context: queue, causation_id: ID_C })
    const publish = resumeObservabilityContext({ context: translation, causation_id: ID_B })
    const withdrawal = resumeObservabilityContext({ context: publish, causation_id: ID_C })

    expect([queue, translation, publish, withdrawal]).toEqual(expect.arrayContaining([
      expect.objectContaining({ correlation_id: ID_A }),
    ]))
    expect(withdrawal.causation_id).toBe(ID_C)
    expect(() => resumeObservabilityContext({ context: ingest, causation_id: ID_B, external_traceparent: '00-00000000000000000000000000000000-0000000000000000-01' })).toThrow(/trace/i)
  })

  it('redacts case-insensitive nested credential poison before every local sink receives it', () => {
    const poison = 'rapidapi-secret-sentinel'
    const redacted = redactObservabilityValue({ Authorization: `Bearer ${poison}`, nested: [{ api_KEY: poison, prompt: 'full restricted content' }], safe: ID_A })

    expect(JSON.stringify(redacted)).not.toContain(poison)
    expect(redacted).toEqual({ Authorization: '[REDACTED]', nested: [{ api_KEY: '[REDACTED]', prompt: '[REDACTED]' }], safe: ID_A })
  })

  it('accepts only schema-defined bo_ metrics and low-cardinality labels', () => {
    const metrics = new InMemoryMetricSink()
    metrics.increment('bo_queue_retry_total', { environment: 'local', version: 'p1-t08', service: 'localization', kind: 'translate', outcome: 'retry_scheduled', error_class: 'transient', locale: 'ja-JP' })
    metrics.record('bo_queue_backlog', { environment: 'local', version: 'p1-t08', service: 'localization', kind: 'translate', outcome: 'observed', error_class: 'none', locale: 'none' }, 4)
    metrics.record('bo_queue_oldest_age_seconds', { environment: 'local', version: 'p1-t08', service: 'localization', kind: 'translate', outcome: 'observed', error_class: 'none', locale: 'none' }, 300)
    metrics.increment('bo_queue_attempt_total', { environment: 'local', version: 'p1-t08', service: 'localization', kind: 'translate', outcome: 'retry_scheduled', error_class: 'transient', locale: 'ja-JP' })

    expect(metrics.samples()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'bo_queue_retry_total', value: 1 }),
      expect.objectContaining({ name: 'bo_queue_backlog', value: 4 }),
      expect.objectContaining({ name: 'bo_queue_oldest_age_seconds', value: 300 }),
      expect.objectContaining({ name: 'bo_queue_attempt_total', value: 1 }),
    ]))
    expect(() => metrics.increment('bo_queue_retry_total', { environment: 'local', version: 'p1-t08', service: 'localization', kind: `raw-${HASH}`, outcome: 'retry_scheduled', error_class: 'transient', locale: 'ja-JP' } as never)).toThrow(/label/i)
    expect(() => metrics.increment('user_prompt_total' as never, { environment: 'local', version: 'p1-t08', workflow: 'translate', outcome: 'retry_scheduled' } as never)).toThrow(/metric/i)
  })

  it('routes required local alerts only when their strict specification threshold is exceeded', () => {
    const alerts = new LocalAlertRouter({
      owner_by_route: {
        'queue.oldest_age': 'ingestion-oncall',
        'queue.dlq': 'localization-oncall',
        'withdraw.trigger': 'publishing-oncall',
        'redaction.failure': 'security-oncall',
        'publish.validation_failure': 'publishing-oncall',
      },
    })
    const atThreshold = [
      alerts.observe({ kind: 'queue.oldest_age', value: 300, context: context() }),
      alerts.observe({ kind: 'queue.dlq', value: 0, context: context() }),
      alerts.observe({ kind: 'withdraw.trigger', value: 60, context: context() }),
      alerts.observe({ kind: 'redaction.failure', value: 0, context: context() }),
      alerts.observe({ kind: 'publish.validation_failure', value: 0, context: context() }),
    ]
    const fired = [
      alerts.observe({ kind: 'queue.oldest_age', value: 300.001, context: context() }),
      alerts.observe({ kind: 'queue.dlq', value: 1, context: context() }),
      alerts.observe({ kind: 'withdraw.trigger', value: 60.001, context: context() }),
      alerts.observe({ kind: 'redaction.failure', value: 1, context: context() }),
      alerts.observe({ kind: 'publish.validation_failure', value: 1, context: context() }),
    ]

    expect(atThreshold).toEqual(Array.from({ length: 5 }, () => ({ fired: false })))
    expect(fired).toEqual(expect.arrayContaining([
      expect.objectContaining({ fired: true, owner: 'ingestion-oncall' }),
      expect.objectContaining({ fired: true, owner: 'localization-oncall' }),
      expect.objectContaining({ fired: true, owner: 'publishing-oncall' }),
      expect.objectContaining({ fired: true, owner: 'security-oncall' }),
    ]))
    expect(alerts.events()).toHaveLength(5)
  })

  it('records source failure, localization QA/review denial, publish denial, pointer CAS conflict, and T05 DLQ as redacted test-double spans', () => {
    const spans: InstrumentationTestDoubleSpan[] = []
    const sink = { append: (span: InstrumentationTestDoubleSpan) => { spans.push(span) } }
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: { now: () => at }, idFactory: () => ID_C })
    const envelope = {
      schema_version: 1 as const, job_id: ID_B, kind: 'withdraw' as const, entity_ref: { type: 'source' as const, id: ID_A }, expected_source_version: null,
      idempotency_key: `withdraw:${ID_A}:1`, correlation_id: ID_A, causation_id: ID_B, attempt: 7, enqueued_at: at, priority: 'emergency' as const,
    }
    const letter = queue.toDlq(envelope, { code: 'poison', message: 'Authorization: rapidapi-secret-sentinel' })
    const failures = [
      ['source.failure', { provider: 'twitter241', error: 'rapidapi-secret-sentinel' }],
      ['localization.qa_denied', { locale: 'ja-JP', reason: 'language_detection' }],
      ['localization.review_denied', { locale: 'ja-JP', reason: 'reviewer_missing' }],
      ['publish.denied', { reason: 'validators_failed' }],
      ['publication.pointer_cas_conflict', { expected_revision: 4, actual_revision: 5 }],
      ['queue.dlq.produced', { dlq_id: letter.id, original_hash: letter.original_hash }],
    ] as const
    failures.forEach(([name, attributes]) => emitInstrumentationTestDoubleSpan({ sink, name, context: resumeObservabilityContext({ context: context(), causation_id: ID_B }), attributes }))

    expect(spans.map((span) => span.name)).toEqual(failures.map(([name]) => name))
    expect(spans.every((span) => span.context.correlation_id === ID_A)).toBe(true)
    expect(JSON.stringify(spans)).not.toContain('rapidapi-secret-sentinel')
    expect(spans.find((span) => span.name === 'publication.pointer_cas_conflict')).toMatchObject({ kind: 'instrumentation-test-double' })
    expect(() => emitInstrumentationTestDoubleSpan({ sink, name: 'unbounded.event' as never, context: context(), attributes: {} })).toThrow(/span/i)
  })

  it('permits only audited restricted audit queries and redacts detail fields in their result', () => {
    const events = new InMemoryAuditQuerySink([
      auditEventSchema.parse({ event_id: ID_C, occurred_at: at, actor: { type: 'service', id: ID_B }, correlation_id: ID_A, causation_id: ID_B, entity: { type: 'source', id: ID_A }, action: 'source.ingest.failed', outcome: 'failed', before: { token: 'rapidapi-secret-sentinel' }, after: { prompt: 'restricted prompt' }, reason_code: 'auth' }),
    ])
    const query = new AuditQueryBuilder({ actor: { id: ID_B, roles: ['admin'] }, correlation_id: ID_A, limit: 10 }).build()

    expect(events.query(query)).toEqual([expect.objectContaining({ correlation_id: ID_A, before: {}, after: {} })])
    expect(() => new AuditQueryBuilder({ actor: { id: ID_B, roles: ['editor'] }, correlation_id: ID_A, limit: 10 }).build()).toThrow(/restricted/i)
  })
})
