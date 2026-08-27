import { queueEnvelopeSchema } from '@/contracts/queue'
import { classifyQueueFailure, nextRetry, type QueueClock } from '@/queues'
import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_A, UTC_NOW, UUID_B } from '../fixtures/contracts'

const envelope = queueEnvelopeSchema.parse({
  schema_version: 1, job_id: '01J123456789ABCDEFGHJKMNPQ', kind: 'ingest', entity_ref: { type: 'source', id: UUID_B },
  expected_source_version: CONTENT_HASH_A, idempotency_key: `ingest:${UUID_B}:${CONTENT_HASH_A}`, correlation_id: '01J123456789ABCDEFGHJKMNPR',
  causation_id: null, attempt: 0, enqueued_at: UTC_NOW, priority: 'normal',
})
const fixedClock: QueueClock = { now: () => UTC_NOW }

describe('P1-T05 retry budget and poison path', () => {
  it('classifies auth/schema/rights errors as permanent and rate limits/transients as retryable', () => {
    expect(classifyQueueFailure({ code: 'auth' }).kind).toBe('permanent')
    expect(classifyQueueFailure({ code: 'schema' }).kind).toBe('permanent')
    expect(classifyQueueFailure({ code: 'rights' }).kind).toBe('permanent')
    expect(classifyQueueFailure({ code: 'rate_limited', retryAfterMilliseconds: 6_000 })).toMatchObject({ kind: 'retryable', retryAfterMilliseconds: 6_000 })
    expect(classifyQueueFailure({ code: 'transient' }).kind).toBe('retryable')
  })

  it('honors Retry-After, uses injected full jitter and enforces the 8 attempts / 24h budget', () => {
    expect(nextRetry(envelope, { code: 'rate_limited', retryAfter: '6' }, { clock: fixedClock, random: () => 0.5 })).toMatchObject({ kind: 'retry', delayMilliseconds: 6_000 })
    expect(nextRetry(envelope, { code: 'rate_limited', retryAfter: 'Sun, 23 Aug 2026 12:35:06 GMT' }, { clock: fixedClock, random: () => 0.5 })).toMatchObject({ kind: 'retry', delayMilliseconds: 10_000 })
    expect(nextRetry(envelope, { code: 'rate_limited', retryAfter: 'invalid' }, { clock: fixedClock, random: () => 0.5 })).toMatchObject({ kind: 'retry', delayMilliseconds: 500 })
    expect(nextRetry(envelope, { code: 'transient' }, { clock: fixedClock, random: () => 0.5 })).toMatchObject({ kind: 'retry', delayMilliseconds: 500 })
    expect(nextRetry({ ...envelope, attempt: 8 }, { code: 'transient' }, { clock: fixedClock, random: () => 0.5 })).toMatchObject({ kind: 'dlq', reason: 'retry_budget_exhausted' })
    expect(nextRetry({ ...envelope, enqueued_at: '2026-08-22T00:00:00.000Z' }, { code: 'transient' }, { clock: fixedClock, random: () => 0.5 })).toMatchObject({ kind: 'dlq', reason: 'retry_window_exhausted' })
    // Existing `>` policy accepts a retry scheduled exactly at the hard deadline.
    expect(nextRetry({ ...envelope, enqueued_at: '2026-08-22T12:34:57.000Z' }, { code: 'transient' }, { clock: fixedClock, random: () => 1 })).toMatchObject({ kind: 'retry', delayMilliseconds: 1_000 })
    expect(nextRetry({ ...envelope, enqueued_at: '2026-08-22T12:34:56.999Z' }, { code: 'transient' }, { clock: fixedClock, random: () => 1 })).toMatchObject({ kind: 'dlq', reason: 'retry_window_exhausted' })
  })
})
