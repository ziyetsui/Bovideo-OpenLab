import { describe, expect, it } from 'vitest'

import { createPointerAuditAfterChangeHook } from '@/access/audit-hook'
import { principals } from '@/access/principals'
import { queueEnvelopeSchema, buildPublishIdempotencyKey } from '@/contracts/queue'
import { validateGoldenReplacementApproval } from '@/collections/GoldenReplacementApprovals'
import { staleLocalesForSourceHashChange } from '@/localization/source-stale'
import { RedactedStructuredLogTestDouble, type InstrumentationTestDoubleSpan } from '@/observability/events'
import { createRootObservabilityContext } from '@/observability/context'
import { QueueConsumer, InMemoryIdempotencyStore, LocalQueue } from '@/queues'
import { Twitter241Adapter } from '@/source-adapters/twitter241'
import { buildContentAddressedKey } from '@/storage/object-ref'

const ULID_A = '01J6R3W2V8W24Q10NRDBVGN3P7'
const ULID_B = '01J6R3W2V8W24Q10NRDBVGN3P8'
const ULID_C = '01J6R3W2V8W24Q10NRDBVGN3P9'
const hash = `sha256:v1:${'a'.repeat(64)}`
const now = '2026-08-25T00:00:00.000Z'
const entity = { type: 'artifact' as const, id: '1b2c3d4e-5f60-4a71-8b92-c3d4e5f60718' }

const queueEnvelope = (overrides: Record<string, unknown> = {}) => queueEnvelopeSchema.parse({
  schema_version: 1, job_id: ULID_A, kind: 'publish', entity_ref: entity,
  expected_source_version: hash, idempotency_key: buildPublishIdempotencyKey(hash),
  correlation_id: ULID_B, causation_id: ULID_C, attempt: 0, enqueued_at: now,
  priority: 'normal', ...overrides,
})

describe('P1-T08 required-local context sink', () => {
  it('retains only reference and metadata fields, recursively removing raw/full-text and credentials', () => {
    const sink = new RedactedStructuredLogTestDouble()
    sink.record({
      event_name: 'test.synthetic',
      correlation_id: ULID_B,
      causation_id: ULID_C,
      refs: { entity_id: entity.id, raw_hash: hash, raw_ref: 'private-object-ref' },
      metadata: { outcome: 'allowed', peerAddress: '203.0.113.1', nested: { full_text: 'DO-NOT-LOG', Authorization: 'Bearer DO-NOT-LOG', safe: 'kept' } },
      raw_text: 'DO-NOT-LOG', credential: 'DO-NOT-LOG',
    })
    expect(sink.records()).toEqual([expect.objectContaining({
      correlation_id: ULID_B, causation_id: ULID_C,
      refs: { entity_id: entity.id, raw_hash: hash }, metadata: { outcome: 'allowed', nested: { safe: 'kept' } },
    })])
    expect(JSON.stringify(sink.records())).not.toContain('DO-NOT-LOG')
    expect(JSON.stringify(sink.records())).not.toContain('private-object-ref')
    expect(JSON.stringify(sink.records())).not.toContain('203.0.113.1')
  })

  it('propagates queue correlation and causation without retaining a content-bearing field', async () => {
    const sink = new RedactedStructuredLogTestDouble()
    const clock = { now: () => now }
    const envelope = queueEnvelope()
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock, idFactory: () => ULID_A, observability: sink })
    queue.enqueue(envelope)
    const consumer = new QueueConsumer({ store: new InMemoryIdempotencyStore({ clock }), sourceVersion: () => hash, observability: sink })
    await expect(consumer.consume(envelope, () => ({ side_effect_version: 'v1' }))).resolves.toEqual({ status: 'processed' })
    expect(sink.records().filter((event) => event.event_name.startsWith('queue.'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_name: 'queue.enqueued', correlation_id: ULID_B, causation_id: ULID_C, refs: expect.objectContaining({ entity_id: entity.id }) }),
      expect.objectContaining({ event_name: 'queue.consumed', correlation_id: ULID_B, causation_id: ULID_C, metadata: expect.objectContaining({ outcome: 'processed' }) }),
    ]))
    expect(JSON.stringify(sink.records())).not.toContain('side_effect_version')
  })

  it('calls the runtime boundary from ingest queue/consumer and localization with one trace lineage', async () => {
    const spans: InstrumentationTestDoubleSpan[] = []
    const trace = { append: (span: InstrumentationTestDoubleSpan) => { spans.push(span) } }
    const traceparent = createRootObservabilityContext({
      correlation_id: ULID_B,
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    }).traceparent
    const envelope = queueEnvelope({ kind: 'ingest', idempotency_key: `ingest:${entity.id}:${hash}`, traceparent })
    const clock = { now: () => now }
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock, idFactory: () => ULID_A, instrumentation: trace })
    queue.enqueue(envelope)
    const consumer = new QueueConsumer({ store: new InMemoryIdempotencyStore({ clock }), sourceVersion: () => hash, instrumentation: trace })
    await expect(consumer.consume(envelope, () => ({ side_effect_version: 'v1' }))).resolves.toEqual({ status: 'processed' })

    const service = { id: 17, stable_id: ULID_A, identity_kind: 'service' as const, roles: [], service_scopes: ['translate'] }
    const payload = { find: async () => ({ docs: [{ id: 71, revision: 4, workflow_state: 'approved' }] }), update: async () => ({ id: 71 }) }
    await staleLocalesForSourceHashChange({
      payload: payload as never, req: { context: {} } as never, service, entity: { relationTo: 'prompt-artifacts', value: 42 },
      old_source_hash: hash, new_source_hash: `sha256:v1:${'b'.repeat(64)}`,
      correlation_id: ULID_B, causation_id: ULID_C, traceparent, instrumentation: trace,
    })

    expect(spans.map((span) => span.name)).toEqual(['workflow.ingest', 'workflow.queue', 'workflow.translation'])
    expect(spans.every((span) => span.context.correlation_id === ULID_B && span.context.causation_id === ULID_C && span.context.traceparent === traceparent)).toBe(true)
  })

  it('records source persistence by hash/ref metadata, never normalized source text or transport credentials', async () => {
    const sink = new RedactedStructuredLogTestDouble()
    const raw = new TextEncoder().encode(JSON.stringify({ data: { id: 'source-1', url: 'https://x.com/a/status/source-1', text: 'SOURCE-RAW-TEXT', author: { id: 'author', name: 'Author', handle: 'author' } } }))
    const responseHash = `sha256:v1:${await crypto.subtle.digest('SHA-256', raw).then((value) => Buffer.from(value).toString('hex'))}`
    const adapter = new Twitter241Adapter({
      transport: { request: async () => ({ status: 200, headers: {}, body: raw, peer_address: '93.184.216.34' }) },
      dns: { resolve: async () => ['93.184.216.34'] }, secret: { rapidApiKey: () => 'RAPIDAPI-CREDENTIAL' },
    })
    await adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'fixture', type: 'Latest', count: 1 }, cursor: null, limit: 1 }, {
      correlation_id: ULID_B, causation_id: ULID_C, captured_at: now, signal: new AbortController().signal, observability: sink,
      raw_store: { write: async () => ({ ref: { namespace: 'raw-evidence', bucket_class: 'private_raw', key: buildContentAddressedKey('raw-evidence', responseHash), content_hash: responseHash, version: 'v1', size_bytes: raw.byteLength, mime_type: 'application/json', rights_state: 'metadata_only', deletion_state: 'active' }, receipt: { receipt_id: ULID_A }, actor_id: ULID_A }), pendingRecoveryCandidates: async () => [], markDisposition: async () => undefined },
      quarantine: { record: async () => undefined },
    })
    expect(sink.records()).toContainEqual(expect.objectContaining({ event_name: 'source_adapter.page_persisted', correlation_id: ULID_B, causation_id: ULID_C, refs: expect.objectContaining({ raw_hash: responseHash }) }))
    expect(JSON.stringify(sink.records())).not.toMatch(/SOURCE-RAW-TEXT|RAPIDAPI-CREDENTIAL|raw-evidence\//)
  })

  it('threads context across locale staleness, Golden approval, and pointer audit paths', async () => {
    const sink = new RedactedStructuredLogTestDouble()
    const service = { id: 17, stable_id: ULID_A, identity_kind: 'service' as const, roles: [], service_scopes: ['translate'] }
    const payload = {
      find: async () => ({ docs: [{ id: 71, revision: 4, workflow_state: 'approved' }] }),
      update: async () => ({ id: 71 }),
      create: async () => ({}),
    }
    await staleLocalesForSourceHashChange({ payload: payload as never, req: { context: {} } as never, service, entity: { relationTo: 'prompt-artifacts', value: 42 }, old_source_hash: hash, new_source_hash: `sha256:v1:${'b'.repeat(64)}`, correlation_id: ULID_B, causation_id: ULID_C, observability: sink })
    const reviewer = { id: 42, stable_id: ULID_A, identity_kind: 'human', roles: ['reviewer'], service_scopes: [] }
    validateGoldenReplacementApproval({ operation: 'create', data: { baseline_manifest_hash: hash, candidate_manifest_hash: `sha256:v1:${'b'.repeat(64)}`, evaluator_version: 'v1', correlation_id: ULID_B }, req: { user: reviewer, context: { phase1ObservabilitySink: sink, phase1CausationId: ULID_C } } } as never)
    await createPointerAuditAfterChangeHook({ doc: { stable_id: entity.id }, operation: 'update', previousDoc: { stable_id: entity.id }, req: { user: principals.publishService, context: { phase1PointerCommand: { correlation_id: ULID_B, causation_id: ULID_C, reason_code: 'publish' }, phase1ObservabilitySink: sink }, payload } } as never)
    expect(sink.records()).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_name: 'localization.source_stale', correlation_id: ULID_B, causation_id: ULID_C, refs: expect.objectContaining({ locale_variant_id: '71' }) }),
      expect.objectContaining({ event_name: 'localization.golden_approval', correlation_id: ULID_B, causation_id: ULID_C }),
      expect.objectContaining({ event_name: 'publication.pointer_audited', correlation_id: ULID_B, causation_id: ULID_C }),
    ]))
  })
})
