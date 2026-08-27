import { describe, expect, it } from 'vitest'

import { auditEventSchema } from '@/contracts/common'
import { LocalAlertRouter } from '@/observability/alerts'
import { InMemoryAuditQuerySink, AuditQueryBuilder } from '@/observability/audit-query'
import { createRootObservabilityContext, emitInstrumentationTestDoubleSpan, RedactedStructuredLogTestDouble, type InstrumentationTestDoubleSpan } from '@/observability'

const ACTOR_ID = '01J0J0J0J0J0J0J0J0J0J0J0J0'
const CORRELATION_ID = '01J0J0J0J0J0J0J0J0J0J0J0J1'
const EVENT_ID = '01J0J0J0J0J0J0J0J0J0J0J0J2'
const at = '2026-08-25T00:00:00.000Z'
const poison = 'P1-T08-DO-NOT-RETAIN'

const context = { correlation_id: CORRELATION_ID, causation_id: ACTOR_ID }
const owners = {
  'queue.oldest_age': 'ingestion-oncall',
  'queue.dlq': 'localization-oncall',
  'withdraw.trigger': 'publishing-oncall',
  'redaction.failure': 'security-oncall',
  'publish.validation_failure': 'publishing-oncall',
} as const

describe('P1-T08 security boundaries', () => {
  it('removes every §17.4 poison class from event sink records while rejecting unrelated caller fields', () => {
    const sink = new RedactedStructuredLogTestDouble()
    sink.record({
      event_name: 'security.boundary',
      ...context,
      refs: {
        entity_id: ACTOR_ID,
        authorization: `Bearer ${poison}`,
        cookie: `session=${poison}`,
        api_key: poison,
        raw_prompt: poison,
        localized_full_text: poison,
        private_r2_signed_url: `https://bucket.r2.cloudflarestorage.com/a?X-Amz-Credential=${poison}`,
      },
      metadata: {
        set_cookie: poison,
        token: poison,
        secret: poison,
        full_prompt: poison,
        email: `${poison}@example.test`,
        ip_address: '203.0.113.9',
        nested: { value: `https://bucket.r2.cloudflarestorage.com/a?X-Amz-Signature=${poison}` },
        safe: 'kept',
      },
    })

    expect(sink.records()).toEqual([expect.objectContaining({ refs: { entity_id: ACTOR_ID }, metadata: { nested: {}, safe: 'kept' } })])
    expect(JSON.stringify(sink.records())).not.toContain(poison)
    expect(() => sink.record({ event_name: 'security.boundary', ...context, refs: {}, metadata: {}, attacker_field: 'not-sensitive' })).toThrow()
  })

  it('redacts and schema-validates fired alert events at the sink boundary', () => {
    const router = new LocalAlertRouter({ owner_by_route: owners })

    expect(() => router.observe({ kind: 'queue.dlq', value: 1, context, authorization: `Bearer ${poison}` } as never)).toThrow()
    expect(router.observe({ kind: 'queue.dlq', value: 1, context })).toEqual({ fired: true, owner: 'localization-oncall' })
    expect(JSON.stringify(router.events())).not.toContain(poison)
  })

  it('removes poison attributes from instrumentation span sinks and rejects appended safe fields', () => {
    const spans: InstrumentationTestDoubleSpan[] = []
    const sink = { append: (span: InstrumentationTestDoubleSpan) => { spans.push(span) } }
    const traceContext = createRootObservabilityContext({ correlation_id: CORRELATION_ID, traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' })

    emitInstrumentationTestDoubleSpan({ sink, name: 'source.failure', context: traceContext, attributes: { raw_prompt: poison, nested: { email: `${poison}@example.test`, url: `https://bucket.r2.cloudflarestorage.com/a?X-Amz-Signature=${poison}` } } })
    expect(JSON.stringify(spans)).not.toContain(poison)
    expect(() => emitInstrumentationTestDoubleSpan({ sink, name: 'source.failure', context: traceContext, attributes: {}, attacker_field: 'not-sensitive' } as never)).toThrow()
  })

  it('requires a role-authorized audit capability at query time and never retains poison audit details', () => {
    const sink = new InMemoryAuditQuerySink([
      auditEventSchema.parse({
        event_id: EVENT_ID,
        occurred_at: at,
        actor: { type: 'service', id: ACTOR_ID },
        correlation_id: CORRELATION_ID,
        causation_id: ACTOR_ID,
        entity: { type: 'source', id: ACTOR_ID },
        action: 'source.read',
        outcome: 'allowed',
        before: { authorization: `Bearer ${poison}`, email: `${poison}@example.test` },
        after: { private_r2_signed_url: `https://bucket.r2.cloudflarestorage.com/a?X-Amz-Signature=${poison}` },
        reason_code: null,
      }),
    ])

    expect(() => sink.query({ correlation_id: CORRELATION_ID, limit: 1, requested_by: ACTOR_ID } as never)).toThrow(/capability|restricted/i)
    expect(() => new AuditQueryBuilder({ actor: { id: ACTOR_ID, roles: ['admin'] }, correlation_id: CORRELATION_ID, limit: 101 }).build()).toThrow(/limit/i)
    expect(() => new AuditQueryBuilder({ actor: { id: ACTOR_ID, roles: ['editor'] }, correlation_id: CORRELATION_ID, limit: 1 }).build()).toThrow(/role/i)

    const query = new AuditQueryBuilder({ actor: { id: ACTOR_ID, roles: ['legal'] }, correlation_id: CORRELATION_ID, limit: 1 }).build()
    expect(JSON.stringify(sink.query(query))).not.toContain(poison)
    expect(JSON.stringify(sink.accesses())).not.toContain(poison)
  })
})
