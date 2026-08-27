import { buildPublishIdempotencyKey, queueEnvelopeSchema } from '@/contracts/queue'
import {
  InMemoryIdempotencyStore,
  LocalQueue,
  QueueConsumer,
  NormalExecutor,
  WithdrawalTombstones,
  WithdrawalExecutor,
  type QueueClock,
} from '@/queues'
import { principals } from '@/access/principals'
import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_A, CONTENT_HASH_B, UTC_NOW, UUID_A, UUID_B } from '../fixtures/contracts'

const JOB_A = '01J123456789ABCDEFGHJKMNPQ'
const JOB_B = '01J123456789ABCDEFGHJKMNPR'
const CORRELATION_A = '01J123456789ABCDEFGHJKMNPS'
const admin = { ...principals.admin, id: UUID_B }
const editor = { ...principals.editor, id: UUID_B }

const clock = (): QueueClock & { advance: (milliseconds: number) => void } => {
  let value = Date.parse(UTC_NOW)
  return {
    now: () => new Date(value).toISOString(),
    advance: (milliseconds) => { value += milliseconds },
  }
}

const envelope = (overrides: Record<string, unknown> = {}) =>
  queueEnvelopeSchema.parse({
    schema_version: 1,
    job_id: JOB_A,
    kind: 'publish',
    entity_ref: { type: 'artifact', id: UUID_B },
    expected_source_version: CONTENT_HASH_A,
    idempotency_key: buildPublishIdempotencyKey(CONTENT_HASH_A),
    correlation_id: CORRELATION_A,
    causation_id: null,
    attempt: 0,
    enqueued_at: UTC_NOW,
    priority: 'normal',
    ...overrides,
  })

describe('P1-T05 local queue consumer', () => {
  it('rejects unknown and content-bearing envelope fields at the strict boundary', () => {
    expect(() => envelope({ raw_content: 'forbidden' })).toThrow()
    expect(() => envelope({ credential: 'forbidden' })).toThrow()
    expect(() => envelope({ full_text: 'forbidden' })).toThrow()
  })

  it.each([1, 3, 10])('returns duplicate or stale_ignored without side effects under %ix delivery', async (deliveries) => {
    const testClock = clock()
    const store = new InMemoryIdempotencyStore({ clock: testClock })
    const consumer = new QueueConsumer({ store, sourceVersion: () => CONTENT_HASH_A })
    let effects = 0
    const messages = Array.from({ length: deliveries }, () => envelope())
    const results = await Promise.all(messages.map((message) => consumer.consume(message, () => { effects += 1; return { side_effect_version: 'v1' } })))
    expect(effects).toBe(1)
    expect(results.filter((result) => result.status === 'processed').length).toBe(1)
    expect(results.filter((result) => result.status === 'duplicate').length).toBe(deliveries - 1)

    const stale = await consumer.consume(envelope({ job_id: JOB_B, expected_source_version: CONTENT_HASH_B }), () => { effects += 1; return { side_effect_version: 'v1' } })
    expect(stale.status).toBe('stale_ignored')
    expect(effects).toBe(1)
  })

  it('atomically permits one claimant and allows a crashed lease to be taken over', async () => {
    const testClock = clock()
    const store = new InMemoryIdempotencyStore({ clock: testClock, leaseMilliseconds: 15 * 60_000 })
    const message = envelope()
    const claims = await Promise.all(Array.from({ length: 10 }, () => store.claim(message)))
    expect(claims.filter((claim) => claim.kind === 'acquired')).toHaveLength(1)
    expect(claims.filter((claim) => claim.kind === 'busy')).toHaveLength(9)
    testClock.advance(15 * 60_000 - 1)
    expect(await store.claim(envelope({ attempt: 1 }))).toMatchObject({ kind: 'busy' })
    testClock.advance(1)
    expect(await store.claim(envelope({ attempt: 1 }))).toMatchObject({ kind: 'acquired', takeover: true })
  })

  it('uses a permanently retained withdrawal tombstone so old jobs cannot reverse the withdrawal', async () => {
    const testClock = clock()
    const tombstones = new WithdrawalTombstones({ clock: testClock })
    tombstones.record({ entityRef: { type: 'artifact', id: UUID_B }, requestVersion: 4, correlationId: CORRELATION_A })
    const consumer = new QueueConsumer({
      store: new InMemoryIdempotencyStore({ clock: testClock }),
      sourceVersion: () => CONTENT_HASH_A,
      tombstones,
    })
    let effects = 0
    await expect(consumer.consume(envelope(), () => { effects += 1; return { side_effect_version: 'v1' } })).resolves.toMatchObject({ status: 'stale_ignored' })
    expect(effects).toBe(0)
    expect(tombstones.get({ type: 'artifact', id: UUID_B })).toMatchObject({ requestVersion: 4 })
  })

  it('commits a successful withdrawal effect and permanent tombstone together', async () => {
    const testClock = clock(); const tombstones = new WithdrawalTombstones({ clock: testClock })
    const consumer = new QueueConsumer({ store: new InMemoryIdempotencyStore({ clock: testClock }), sourceVersion: () => CONTENT_HASH_A, tombstones })
    const withdraw = envelope({ job_id: JOB_B, kind: 'withdraw', priority: 'emergency', idempotency_key: `withdraw:${UUID_B}:4` })
    await expect(consumer.consume(withdraw, () => ({ side_effect_version: 'withdraw-v4' }))).resolves.toMatchObject({ status: 'processed' })
    expect(tombstones.get(withdraw.entity_ref)).toMatchObject({ requestVersion: 4 })
    let effects = 0
    const oldDeliveries = await Promise.all([1, 3, 10].map(() => consumer.consume(envelope({ job_id: JOB_A }), () => { effects += 1; return { side_effect_version: 'must-not-run' } })))
    expect(oldDeliveries.every((result) => result.status === 'stale_ignored' && result.reason === 'withdrawn')).toBe(true)
    expect(effects).toBe(0)
  })

  it('keeps emergency withdrawals runnable when normal translation capacity is saturated', async () => {
    const testClock = clock()
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A, translationRegistry: { promptVersions: new Set(['v1']), modelSnapshots: new Set(['model']) } })
    const translateKey = `translate:${UUID_B}:en:${CONTENT_HASH_A}:v1:model`
    queue.enqueue(envelope({ kind: 'translate', priority: 'normal', idempotency_key: translateKey }))
    expect(() => queue.enqueue(envelope({ job_id: JOB_B, kind: 'translate', priority: 'normal', idempotency_key: translateKey }))).toThrow('normal queue is full')
    queue.enqueue(envelope({ job_id: JOB_B, kind: 'withdraw', priority: 'emergency', idempotency_key: `withdraw:${UUID_B}:4` }))
    expect(queue.dequeue('withdraw')).toMatchObject({ kind: 'withdraw', priority: 'emergency' })
    expect(queue.dequeue('normal')).toMatchObject({ kind: 'translate' })
  })

  it('only permits authorized audited immutable DLQ replay and preserves replay lineage', async () => {
    const testClock = clock()
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A })
    const poison = queue.toDlq(envelope(), { code: 'schema', message: 'invalid envelope' })
    await expect(queue.replay(poison.id, editor, { jobId: JOB_B, correlationId: JOB_A, reason: 'operator correction', replayIdempotencyKey: 'replay:t05:denied' })).rejects.toThrow('forbidden')
    expect(queue.audits()).toMatchObject([{ outcome: 'denied', action: 'queue.dlq.replay' }])
    const replay = await queue.replay(poison.id, admin, { jobId: JOB_B, correlationId: JOB_A, reason: 'operator correction', replayIdempotencyKey: 'replay:t05:allowed' })
    expect(replay.envelope).toMatchObject({ job_id: JOB_B, causation_id: poison.id })
    expect(queue.dlq()).toEqual([poison])
    expect(replay.audit).toMatchObject({ action: 'queue.dlq.replay', outcome: 'allowed' })
  })

  it('authorizes every replay read before returning a stable idempotent result', async () => {
    const testClock = clock()
    const queue = new LocalQueue({ normalCapacity: 2, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A })
    const poison = queue.toDlq(envelope(), { code: 'poison' })
    const request = { jobId: JOB_B, correlationId: JOB_A, reason: 'repair', replayIdempotencyKey: 'replay:authorization' }
    const adminA = { ...principals.admin, id: UUID_A }
    const replay = await queue.replay(poison.id, adminA, request)
    await expect(queue.replay(poison.id, adminA, request)).resolves.toEqual(replay)
    const ownerB = { ...principals.publishService, id: UUID_B }
    await expect(queue.replay(poison.id, ownerB, request)).rejects.toThrow('fingerprint conflict')
    expect(queue.audits().map((event) => event.outcome)).toEqual(['allowed'])
    const unprivilegedSameIdentity = { ...adminA, roles: [], serviceScopes: [] } as const
    await expect(queue.replay(poison.id, unprivilegedSameIdentity, request)).rejects.toThrow('forbidden')
    expect(queue.audits().map((event) => event.outcome)).toEqual(['allowed', 'denied'])
    expect(queue.dequeue('normal')).toEqual(replay.envelope)
    expect(queue.dequeue('normal')).toBeUndefined()
  })

  it('fails DLQ replay closed when the immutable audit append fails', async () => {
    const testClock = clock()
    const queue = new LocalQueue({
      normalCapacity: 1,
      emergencyWithdrawCapacity: 1,
      clock: testClock,
      idFactory: () => JOB_A,
      audit: { append: async () => { throw new Error('audit unavailable') } },
    })
    const poison = queue.toDlq(envelope(), { code: 'schema' })
    await expect(queue.replay(poison.id, admin, { jobId: JOB_B, correlationId: JOB_A, reason: 'operator correction', replayIdempotencyKey: 'replay:t05:audit' })).rejects.toThrow('audit unavailable')
    expect(queue.dequeue('normal')).toBeUndefined()
  })

  it('does not allow an expired worker to finish after a token-CAS takeover, and expires success at the 90-day boundary', async () => {
    const testClock = clock()
    const store = new InMemoryIdempotencyStore({ clock: testClock, leaseMilliseconds: 1 })
    const first = await store.claim(envelope())
    if (first.kind !== 'acquired') throw new Error('test setup')
    testClock.advance(1)
    const takeover = await store.claim(envelope({ attempt: 1 }))
    if (takeover.kind !== 'acquired') throw new Error('test setup')
    expect(await store.commit(envelope(), first.token, () => CONTENT_HASH_A, () => ({ side_effect_version: 'v1' }))).toBe('lost_claim')
    expect(await store.commit(envelope({ attempt: 1 }), takeover.token, () => CONTENT_HASH_A, () => ({ side_effect_version: 'v1' }))).toBe('processed')
    const result = store.successResult(envelope().idempotency_key)
    expect(result).toMatchObject({ side_effect_version: 'v1', committed_at: new Date(Date.parse(UTC_NOW) + 1).toISOString() })
    expect(result?.retain_until).toBe(new Date(Date.parse(UTC_NOW) + 1 + 90 * 24 * 60 * 60_000).toISOString())
    testClock.advance(90 * 24 * 60 * 60_000 - 1)
    expect(await store.claim(envelope({ attempt: 1 }))).toMatchObject({ kind: 'duplicate', result })
    expect(store.successResult(envelope().idempotency_key)).toEqual(result)
    testClock.advance(1)
    expect(await store.claim(envelope({ attempt: 0 }))).toMatchObject({ kind: 'acquired' })
    expect(store.successResult(envelope().idempotency_key)).toBeUndefined()
  })

  it('clones and freezes unknown runtime inputs before DLQ hashing and alert emission', () => {
    const testClock = clock()
    const queue = new LocalQueue({ normalCapacity: 2, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A })
    const input = envelope() as { entity_ref: { type: 'artifact'; id: string } }
    const letter = queue.toDlq(input, { code: 'poison' })
    input.entity_ref.id = '018f8f41-6dc0-7b5e-8d93-22d8f7a64b6e'
    expect(letter.original.entity_ref.id).toBe(UUID_B)
    expect(letter.original_hash).toMatch(/^sha256:v1:/)
    expect(Object.isFrozen(queue.alerts()[0]!.entity_ref)).toBe(true)
  })

  it('reserves replay capacity before audit and serializes same replay key concurrent callers', async () => {
    const testClock = clock(); let audits = 0
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A, audit: { append: async () => { audits += 1 } } })
    const poison = queue.toDlq(envelope(), { code: 'poison' })
    const request = { jobId: JOB_B, correlationId: JOB_A, reason: 'repair', replayIdempotencyKey: 'replay:concurrent' }
    const [left, right] = await Promise.all([queue.replay(poison.id, admin, request), queue.replay(poison.id, admin, request)])
    expect(left).toEqual(right); expect(audits).toBe(1); expect(queue.dequeue('normal')).toBeDefined()
    await expect(queue.replay(poison.id, admin, { ...request, reason: 'different' })).rejects.toThrow('fingerprint conflict')
  })

  it('does not append an allowed replay audit when queue capacity is already full', async () => {
    const testClock = clock(); let audits = 0
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A, audit: { append: async () => { audits += 1 } } })
    queue.enqueue(envelope())
    const poison = queue.toDlq(envelope({ job_id: JOB_B }), { code: 'poison' })
    await expect(queue.replay(poison.id, admin, { jobId: JOB_B, correlationId: JOB_A, reason: 'repair', replayIdempotencyKey: 'replay:full' })).rejects.toThrow('normal queue is full')
    expect(audits).toBe(0)
  })

  it('runs an emergency withdrawal while the independent normal worker is blocked', async () => {
    const testClock = clock()
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A })
    queue.enqueue(envelope())
    const tombstones = new WithdrawalTombstones({ clock: testClock })
    const withdraw = envelope({ job_id: JOB_B, kind: 'withdraw', priority: 'emergency', idempotency_key: `withdraw:${UUID_B}:4` })
    tombstones.recordRightsRevocation({ entityRef: withdraw.entity_ref, requestVersion: 4, correlationId: CORRELATION_A, job: withdraw, queue })
    let releaseNormal!: () => void
    const normalBlocked = new Promise<void>((resolve) => { releaseNormal = resolve })
    const normal = new NormalExecutor().runNext(queue, async () => { await normalBlocked })
    await Promise.resolve()
    let ran = false
    expect(await new WithdrawalExecutor().runNext(queue, async () => { ran = true })).toBe(true)
    expect(ran).toBe(true)
    releaseNormal()
    await expect(normal).resolves.toBe(true)
  })

  it('uses an injected translation snapshot registry at the local ingress boundary', () => {
    const testClock = clock()
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A, translationRegistry: { promptVersions: new Set(['v1']), modelSnapshots: new Set(['model']) } })
    expect(() => queue.enqueue(envelope({ kind: 'translate', idempotency_key: `translate:${UUID_B}:en:${CONTENT_HASH_A}:v1:this-is-natural-language` }))).toThrow('snapshot registry')
  })

  it('rejects async effects before recording success or a durable effect', async () => {
    const testClock = clock(); const store = new InMemoryIdempotencyStore({ clock: testClock })
    const consumer = new QueueConsumer({ store, sourceVersion: () => CONTENT_HASH_A })
    let effects = 0
    const asyncEffect = async () => { effects += 1; return { side_effect_version: 'wrong' } }
    // @ts-expect-error queue effects are explicitly non-Promise receipts.
    await expect(consumer.consume(envelope(), asyncEffect)).rejects.toThrow('synchronous')
    expect(effects).toBe(0)
    await expect(consumer.consume(envelope(), () => ({ side_effect_version: 'v1' }))).resolves.toMatchObject({ status: 'processed' })
  })

  it.each([1, 3, 10])('ignores genuinely out-of-order old source version delivery %ix after new version commits', async (deliveries) => {
    const testClock = clock(); let source = CONTENT_HASH_B; let effects = 0
    const consumer = new QueueConsumer({ store: new InMemoryIdempotencyStore({ clock: testClock }), sourceVersion: () => source })
    const newer = envelope({ expected_source_version: CONTENT_HASH_B, idempotency_key: buildPublishIdempotencyKey(CONTENT_HASH_B) })
    await expect(consumer.consume(newer, () => { effects += 1; return { side_effect_version: 'new' } })).resolves.toMatchObject({ status: 'processed' })
    const old = await Promise.all(Array.from({ length: deliveries }, () => consumer.consume(envelope({ job_id: JOB_A, idempotency_key: buildPublishIdempotencyKey(CONTENT_HASH_A) }), () => { effects += 1; return { side_effect_version: 'old' } })))
    expect(old.every((result) => result.status === 'stale_ignored')).toBe(true)
    expect(effects).toBe(1)
    source = CONTENT_HASH_A // proves commit-time source read is not captured before atomic commit.
  })

  it('validates every DLQ id and alert before mutating either collection', () => {
    const testClock = clock()
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => 'invalid-id' })
    expect(() => queue.toDlq(envelope(), { code: 'poison' })).toThrow()
    expect(queue.dlq()).toHaveLength(0)
    expect(queue.alerts()).toHaveLength(0)
  })

  it('fails invalid audit identities or replay correlation before audit or enqueue mutation', async () => {
    const testClock = clock()
    const queue = new LocalQueue({ normalCapacity: 1, emergencyWithdrawCapacity: 1, clock: testClock, idFactory: () => JOB_A })
    const poison = queue.toDlq(envelope(), { code: 'poison' })
    const request = { jobId: JOB_B, correlationId: JOB_A, reason: 'repair', replayIdempotencyKey: 'replay:audit-validation' }
    await expect(queue.replay(poison.id, { ...admin, id: 'invalid-principal' }, request)).rejects.toThrow()
    await expect(queue.replay(poison.id, admin, { ...request, correlationId: 'invalid-correlation', replayIdempotencyKey: 'replay:audit-correlation' })).rejects.toThrow()
    expect(queue.audits()).toHaveLength(0)
    expect(queue.dequeue('normal')).toBeUndefined()
  })
})
