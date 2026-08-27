import { describe, expect, it } from 'vitest'

import { decideLocaleContentRevision } from '@/localization/state-machine'
import { LocalQueue } from '@/queues'
import {
  LocalPhase1ObservabilityBoundary,
  createRootObservabilityContext,
  type InstrumentationTestDoubleSpan,
} from '@/observability'

const ID_A = '01J0J0J0J0J0J0J0J0J0J0J0J0'
const ID_B = '01J0J0J0J0J0J0J0J0J0J0J0J1'
const ID_C = '01J0J0J0J0J0J0J0J0J0J0J0J2'
const ID_D = '01J0J0J0J0J0J0J0J0J0J0J0J3'
const ID_E = '01J0J0J0J0J0J0J0J0J0J0J0J4'
const ID_F = '01J0J0J0J0J0J0J0J0J0J0J0J5'
const HASH = `sha256:v1:${'a'.repeat(64)}`
const at = '2026-08-25T00:00:00.000Z'

const root = () => createRootObservabilityContext({
  correlation_id: ID_A,
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
})

describe('P1-T08 local boundary context threading', () => {
  it('threads one validated trace and correlation/causation through the actual local queue and translation command', () => {
    const spans: InstrumentationTestDoubleSpan[] = []
    const queue = new LocalQueue({
      normalCapacity: 5,
      emergencyWithdrawCapacity: 1,
      clock: { now: () => at },
      idFactory: () => ID_F,
      translationRegistry: { promptVersions: new Set(['prompt-v1']), modelSnapshots: new Set(['model-v1']) },
    })
    const boundary = new LocalPhase1ObservabilityBoundary({ queue, sink: { append: (span) => spans.push(span) } })

    boundary.enqueue({
      parent: root(),
      envelope: {
        schema_version: 1, job_id: ID_B, kind: 'ingest', entity_ref: { type: 'source', id: ID_A }, expected_source_version: HASH,
        idempotency_key: `ingest:${ID_A}:${HASH}`, correlation_id: ID_A, causation_id: ID_B, attempt: 0, enqueued_at: at, priority: 'normal',
      },
    })
    const ingest = boundary.dequeue('normal')
    expect(ingest?.envelope.kind).toBe('ingest')
    expect(ingest?.envelope.traceparent).toBe(root().traceparent)

    boundary.enqueue({
      parent: ingest!.context,
      envelope: {
        schema_version: 1, job_id: ID_C, kind: 'translate', entity_ref: { type: 'artifact', id: ID_A }, expected_source_version: HASH,
        idempotency_key: `translate:${ID_A}:ja-JP:${HASH}:prompt-v1:model-v1`, correlation_id: ID_A, causation_id: ID_C, attempt: 0, enqueued_at: at, priority: 'normal',
      },
    })
    const translation = boundary.dequeue('normal')
    const decision = boundary.translate(translation!, () => decideLocaleContentRevision({
      record: {
        id: ID_A, revision: 1, content_revision: 1, workflow_state: 'machine_draft', localized_fields: { title: 'before' }, reviewed_revision: null,
        reviewed_by_stable_id: null, reviewed_at: null, published_version: null, is_money_page: false, risk_classes: [],
      },
      command: {
        expected_revision: 1, expected_content_revision: 1, actor_id: ID_B, correlation_id: ID_A, reason_code: 'translation_completed', localized_fields: { title: 'after' }, risk_classes: [],
      },
    }))
    expect(decision).toMatchObject({ allowed: true })

    for (const [kind, job_id, causation_id] of [
      ['publish', ID_D, ID_D],
      ['export', ID_E, ID_E],
      ['withdraw', ID_F, ID_F],
    ] as const) {
      boundary.enqueue({
        parent: translation!.context,
        envelope: {
          schema_version: 1, job_id, kind, entity_ref: { type: 'page', id: ID_A }, expected_source_version: null,
          idempotency_key: kind === 'publish' ? `publish:${HASH}` : kind === 'export' ? `github:1:${HASH}` : `withdraw:${ID_A}:1`,
          correlation_id: ID_A, causation_id, attempt: 0, enqueued_at: at, priority: kind === 'withdraw' ? 'emergency' : 'normal',
        },
      })
      const delivery = boundary.dequeue(kind === 'withdraw' ? 'withdraw' : 'normal')
      boundary.instrumentTestDouble(delivery!)
    }

    expect(spans.map((span) => span.name)).toEqual([
      'workflow.ingest', 'workflow.queue', 'workflow.queue', 'workflow.queue', 'workflow.translation', 'workflow.queue', 'workflow.queue', 'workflow.publish', 'workflow.queue', 'workflow.queue', 'workflow.export', 'workflow.queue', 'workflow.queue', 'workflow.withdraw',
    ])
    expect(spans.every((span) => span.context.correlation_id === ID_A && span.context.traceparent === root().traceparent)).toBe(true)
    expect(spans.filter((span) => span.name.startsWith('workflow.')).map((span) => span.context.causation_id)).toEqual([
      ID_B, ID_B, ID_C, ID_C, ID_C, ID_D, ID_D, ID_D, ID_E, ID_E, ID_E, ID_F, ID_F, ID_F,
    ])
    expect(spans.filter((span) => ['workflow.publish', 'workflow.export', 'workflow.withdraw'].includes(span.name)).every((span) => span.kind === 'instrumentation-test-double')).toBe(true)
  })
})
