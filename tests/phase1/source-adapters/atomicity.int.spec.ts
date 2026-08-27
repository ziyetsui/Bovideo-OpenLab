import { describe, expect, it } from 'vitest'

import { InMemoryCheckpointRepository, InMemorySourceWritePlane, type CheckpointNext, type CheckpointRepository, type CheckpointStopReason } from '../../../src/source-adapters/checkpoint'
import type { NormalizedSourceRecord } from '../../../src/source-adapters/types'

const at = '2026-08-24T00:00:00.000Z'
const A = '01J0J0J0J0J0J0J0J0J0J0J0J0'
const B = '01J0J0J0J0J0J0J0J0J0J0J0J1'
const C = '01J0J0J0J0J0J0J0J0J0J0J0J2'
const hash = `sha256:v1:${'a'.repeat(64)}`
const raw = { namespace: 'raw-evidence' as const, bucket_class: 'private_raw' as const, key: `sha256/aa/${'a'.repeat(64)}`, content_hash: hash, version: 'v1', size_bytes: 2, mime_type: 'application/json', rights_state: 'metadata_only' as const, deletion_state: 'active' as const }
const next: CheckpointNext = { query_identity: 'Q01:Latest', adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: hash, cursor: null, seen_cursors: [], seen_provider_record_ids: [], request_ledger: [], last_source_revision: hash, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 }
const record = (id: string): NormalizedSourceRecord => ({ provider: 'twitter241', provider_record_id: id, canonical_url: `https://x.com/a/status/${id}`, captured_at: at, title: null, text: 'x', author_id: 'a', author_handle: 'a', rights_state: 'metadata_only', rights_basis: null })
const authority = { resolve: async () => raw }
const input = (checkpoint: InMemoryCheckpointRepository, writePlane: InMemorySourceWritePlane, normalized: readonly NormalizedSourceRecord[]) => ({ checkpoint, checkpoint_identity: 'run:atomic:Q01:Latest', expected_checkpoint_revision: 0, checkpoint_next: next, normalized, raw_ref: raw, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: authority, raw_hash: hash, correlation_id: A, partial: false })
const terminalNext = (query_identity: string, reason: CheckpointStopReason, attempts: number): CheckpointNext => ({ ...next, query_identity, query_hash: `sha256:v1:${query_identity === 'run:terminal' ? 'b'.repeat(64) : 'c'.repeat(64)}`, run_status: 'partial', unit_status: 'failed', stop_reason: reason, attempt: attempts })

describe('T06 page bundle atomicity', () => {
  it('dedupes equal business records staged in one page while committing one source and one checkpoint', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); let ids = 0
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => [A, B, C][ids++] ?? C })
    const result = await plane.commitPage(input(checkpoint, plane, [record('same'), record('same')]))
    expect(result.statuses).toEqual(['created', 'duplicate']); expect(result.source_ids).toEqual([A, A]); expect(result.checkpoint.revision).toBe(1)
    expect(plane.sources()).toHaveLength(1); expect(plane.audits()).toHaveLength(2); expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('does not deadlock when a receipt authority reenters the write plane before commit finalization', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    const reentrant = { resolve: async () => { await plane.recordOrphan({ raw_ref: { ...raw, key: `sha256/bb/${'b'.repeat(64)}`, content_hash: `sha256:v1:${'b'.repeat(64)}` }, raw_hash: `sha256:v1:${'b'.repeat(64)}`, reason: 'write_plane_failure' }); return raw } }
    await expect(plane.commitPage({ ...input(checkpoint, plane, [record('reentrant')]), raw_receipt_authority: reentrant })).resolves.toMatchObject({ statuses: ['created'] })
    expect(plane.sources()).toHaveLength(1); expect(plane.orphans()).toHaveLength(1)
  })

  it('rolls a page back when distinct records collide on a source identity', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); let audit = 0
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => C, source_id_factory: () => A, audit_id_factory: () => [B, C][audit++] ?? C })
    await expect(plane.commitPage(input(checkpoint, plane, [record('one'), record('two')]))).rejects.toThrow('source id collision')
    expect(checkpoint.read('run:atomic:Q01:Latest')).toBeUndefined(); expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([]); expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('rolls a page back when distinct audit events collide', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); let source = 0
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => C, source_id_factory: () => [A, B][source++] ?? C, audit_id_factory: () => C })
    await expect(plane.commitPage(input(checkpoint, plane, [record('one'), record('two')]))).rejects.toThrow('audit event id collision')
    expect(checkpoint.read('run:atomic:Q01:Latest')).toBeUndefined(); expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([]); expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('does not publish a partial orphan when quarantine audit creation collides', async () => {
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => C, audit_id_factory: () => A })
    await plane.recordQuarantine({ raw_ref: raw, raw_hash: hash, reason: 'provider_schema', correlation_id: A })
    const other = { ...raw, key: `sha256/bb/${'b'.repeat(64)}`, content_hash: `sha256:v1:${'b'.repeat(64)}` }
    await expect(plane.recordQuarantine({ raw_ref: other, raw_hash: other.content_hash, reason: 'provider_schema', correlation_id: A })).rejects.toThrow('audit event id collision')
    expect(plane.orphans()).toHaveLength(1); expect(plane.audits()).toHaveLength(1); expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('dedupes quarantine orphan globally but audit replay per correlation', async () => {
    let ids = 0; const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => [A, B, C][ids++] ?? C })
    await plane.recordQuarantine({ raw_ref: raw, raw_hash: hash, reason: 'provider_schema', correlation_id: A })
    await plane.recordQuarantine({ raw_ref: raw, raw_hash: hash, reason: 'provider_schema', correlation_id: A })
    await plane.recordQuarantine({ raw_ref: raw, raw_hash: hash, reason: 'provider_schema', correlation_id: B })
    expect(plane.orphans()).toHaveLength(1); expect(plane.audits()).toHaveLength(2)
    expect(plane.audits().map((event) => event.correlation_id)).toEqual([A, B])
  })

  it.each([
    ['auth', 1], ['entitlement', 1], ['rate_limited', 6], ['transient_upstream', 6],
  ] as const)('publishes both terminal checkpoints and one validated %s fetch audit together', async (reason, attempts) => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    const result = await plane.commitTerminalFailure({ checkpoint, unit_checkpoint: { identity: 'run:terminal:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', reason, attempts) }, aggregate_checkpoint: { identity: 'run:terminal', expected_revision: 0, next: terminalNext('run:terminal', reason, attempts) }, correlation_id: A, reason, attempts })
    expect(result.unit_checkpoint).toMatchObject({ revision: 1, unit_status: 'failed' })
    expect(result.aggregate_checkpoint).toMatchObject({ revision: 1, unit_status: 'failed' })
    expect(plane.audits()).toMatchObject([{ action: 'source.ingest.fetch', outcome: 'failed', entity: { type: 'service' }, reason_code: reason, after: { attempts: String(attempts) } }])
    expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('rolls back both terminal checkpoints and the audit when audit publication fails', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A, fail_audit: () => { throw new Error('audit unavailable') } })
    await expect(plane.commitTerminalFailure({ checkpoint, unit_checkpoint: { identity: 'run:terminal-fail:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'rate_limited', 6) }, aggregate_checkpoint: { identity: 'run:terminal-fail', expected_revision: 0, next: terminalNext('run:terminal', 'rate_limited', 6) }, correlation_id: A, reason: 'rate_limited', attempts: 6 })).rejects.toThrow('audit unavailable')
    expect(checkpoint.read('run:terminal-fail:Q01:Latest')).toBeUndefined(); expect(checkpoint.read('run:terminal-fail')).toBeUndefined(); expect(plane.audits()).toEqual([])
    expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('rejects the removed terminal-audit bypass as an extra command field before publication', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(plane.commitTerminalFailure({ checkpoint, unit_checkpoint: { identity: 'run:no-bypass:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'rate_limited', 6) }, aggregate_checkpoint: { identity: 'run:no-bypass', expected_revision: 0, next: terminalNext('run:terminal', 'rate_limited', 6) }, correlation_id: A, reason: 'rate_limited', attempts: 6, audit_already_recorded: true } as never)).rejects.toThrow(/write-plane input is invalid/i)
    expect(checkpoint.read('run:no-bypass:Q01:Latest')).toBeUndefined(); expect(checkpoint.read('run:no-bypass')).toBeUndefined(); expect(plane.audits()).toEqual([])
  })

  it('publishes receipt-bound quarantine evidence, both failure audits, and both checkpoints exactly once', async () => {
    let ids = 0
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => [A, B, C][ids++] ?? C })
    const command = { checkpoint, unit_checkpoint: { identity: 'run:quarantine:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'invalid_response', 1) }, aggregate_checkpoint: { identity: 'run:quarantine', expected_revision: 0, next: terminalNext('run:quarantine', 'invalid_response', 1) }, raw_ref: raw, raw_hash: hash, raw_receipt_id: 'trusted-receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: { resolve: async ({ receipt_id, raw_ref }: { receipt_id: string; raw_ref: import('../../../src/storage/object-ref').ObjectRef }) => receipt_id === 'trusted-receipt' && raw_ref.key === raw.key ? raw : null }, correlation_id: A, attempts: 1 } as const
    await expect(plane.commitQuarantinedFailure(command)).resolves.toMatchObject({ unit_checkpoint: { revision: 1 }, aggregate_checkpoint: { revision: 1 } })
    expect(plane.orphans()).toMatchObject([{ reason: 'provider_schema', raw_hash: hash }])
    expect(plane.audits()).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'source.ingest.quarantine', correlation_id: A }), expect.objectContaining({ action: 'source.ingest.fetch', correlation_id: A, after: expect.objectContaining({ attempts: '1', raw_hash: hash }) })]))
    await expect(plane.commitQuarantinedFailure(command)).rejects.toThrow(/terminally quarantined|already in flight/i)
    expect(plane.orphans()).toHaveLength(1); expect(plane.audits()).toHaveLength(2)
  })

  it('rejects forged quarantine evidence before either terminal checkpoint is visible', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(plane.commitQuarantinedFailure({ checkpoint, unit_checkpoint: { identity: 'run:forged:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'invalid_response', 1) }, aggregate_checkpoint: { identity: 'run:forged', expected_revision: 0, next: terminalNext('run:forged', 'invalid_response', 1) }, raw_ref: raw, raw_hash: hash, raw_receipt_id: 'forged', raw_receipt_actor_id: 'attacker', raw_receipt_authority: { resolve: async () => null }, correlation_id: A, attempts: 1 })).rejects.toThrow(/does not bind/i)
    expect(checkpoint.read('run:forged:Q01:Latest')).toBeUndefined(); expect(checkpoint.read('run:forged')).toBeUndefined(); expect(plane.orphans()).toEqual([]); expect(plane.audits()).toEqual([])
  })

  it.each([
    ['size_bytes', 3], ['version', 'v2'], ['mime_type', 'text/plain'], ['rights_state', 'unknown'], ['deletion_state', 'deleted'], ['content_hash', `sha256:v1:${'b'.repeat(64)}`],
  ] as const)('rejects a forged canonical raw %s from every receipt-bound command', async (field, value) => {
    const forged = { ...raw, [field]: value }
    const forgedAuthority = { resolve: async () => forged }

    const commitCheckpoint = new InMemoryCheckpointRepository({ now: () => at }); const commitPlane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(commitPlane.commit({ checkpoint: commitCheckpoint, checkpoint_identity: 'run:forged-commit:Q01:Latest', expected_checkpoint_revision: 0, checkpoint_next: next, normalized: record('forged-commit'), raw_ref: raw, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: forgedAuthority, raw_hash: hash, correlation_id: A, partial: false })).rejects.toThrow(/does not bind/i)
    expect(commitCheckpoint.read('run:forged-commit:Q01:Latest')).toBeUndefined(); expect(commitPlane.sources()).toEqual([]); expect(commitPlane.audits()).toEqual([])

    const pageCheckpoint = new InMemoryCheckpointRepository({ now: () => at }); const pagePlane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(pagePlane.commitPage({ ...input(pageCheckpoint, pagePlane, [record('forged-page')]), raw_receipt_authority: forgedAuthority })).rejects.toThrow(/does not bind/i)
    expect(pageCheckpoint.read('run:atomic:Q01:Latest')).toBeUndefined(); expect(pagePlane.sources()).toEqual([]); expect(pagePlane.audits()).toEqual([])

    const quarantineCheckpoint = new InMemoryCheckpointRepository({ now: () => at }); const quarantinePlane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(quarantinePlane.commitQuarantinedFailure({ checkpoint: quarantineCheckpoint, unit_checkpoint: { identity: 'run:forged-quarantine:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'invalid_response', 1) }, aggregate_checkpoint: { identity: 'run:forged-quarantine', expected_revision: 0, next: terminalNext('run:quarantine', 'invalid_response', 1) }, raw_ref: raw, raw_hash: hash, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: forgedAuthority, correlation_id: A, attempts: 1 })).rejects.toThrow(/does not bind/i)
    expect(quarantineCheckpoint.read('run:forged-quarantine:Q01:Latest')).toBeUndefined(); expect(quarantineCheckpoint.read('run:forged-quarantine')).toBeUndefined(); expect(quarantinePlane.orphans()).toEqual([]); expect(quarantinePlane.audits()).toEqual([])
  })

  it('rejects a callback-injectable checkpoint before any of the four write-plane commands can mutate', async () => {
    const fake: CheckpointRepository = {
      read: () => undefined,
      transact: async (_input, operation) => { operation({} as never); throw new Error('after callback') },
      transactPair: async (_input, operation) => { operation({} as never, {} as never); throw new Error('after callback') },
    }
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(plane.commit({ checkpoint: fake, checkpoint_identity: 'run:fake:Q01:Latest', expected_checkpoint_revision: 0, checkpoint_next: next, normalized: record('fake'), raw_ref: raw, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: authority, raw_hash: hash, correlation_id: A, partial: false })).rejects.toThrow(/owned local checkpoint/i)
    await expect(plane.commitPage({ ...input(fake as never, plane, [record('fake-page')]) })).rejects.toThrow(/owned local checkpoint/i)
    await expect(plane.commitTerminalFailure({ checkpoint: fake, unit_checkpoint: { identity: 'run:fake-terminal:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'rate_limited', 6) }, aggregate_checkpoint: { identity: 'run:fake-terminal', expected_revision: 0, next: terminalNext('run:terminal', 'rate_limited', 6) }, correlation_id: A, reason: 'rate_limited', attempts: 6 })).rejects.toThrow(/owned local checkpoint/i)
    await expect(plane.commitQuarantinedFailure({ checkpoint: fake, unit_checkpoint: { identity: 'run:fake-quarantine:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'invalid_response', 1) }, aggregate_checkpoint: { identity: 'run:fake-quarantine', expected_revision: 0, next: terminalNext('run:quarantine', 'invalid_response', 1) }, raw_ref: raw, raw_hash: hash, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: authority, correlation_id: A, attempts: 1 })).rejects.toThrow(/owned local checkpoint/i)
    expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([]); expect(plane.orphans()).toEqual([])
  })

  it('rejects an Object.create checkpoint forgery before every command can publish', async () => {
    const forged = Object.create(InMemoryCheckpointRepository.prototype) as CheckpointRepository
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(plane.commit({ checkpoint: forged, checkpoint_identity: 'run:proto:Q01:Latest', expected_checkpoint_revision: 0, checkpoint_next: next, normalized: record('proto'), raw_ref: raw, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: authority, raw_hash: hash, correlation_id: A, partial: false })).rejects.toThrow(/owned local checkpoint/i)
    await expect(plane.commitPage({ ...input(forged as never, plane, [record('proto-page')]) })).rejects.toThrow(/owned local checkpoint/i)
    await expect(plane.commitTerminalFailure({ checkpoint: forged, unit_checkpoint: { identity: 'run:proto-terminal:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'rate_limited', 6) }, aggregate_checkpoint: { identity: 'run:proto-terminal', expected_revision: 0, next: terminalNext('run:terminal', 'rate_limited', 6) }, correlation_id: A, reason: 'rate_limited', attempts: 6 })).rejects.toThrow(/owned local checkpoint/i)
    await expect(plane.commitQuarantinedFailure({ checkpoint: forged, unit_checkpoint: { identity: 'run:proto-quarantine:Q01:Latest', expected_revision: 0, next: terminalNext('Q01:Latest', 'invalid_response', 1) }, aggregate_checkpoint: { identity: 'run:proto-quarantine', expected_revision: 0, next: terminalNext('run:quarantine', 'invalid_response', 1) }, raw_ref: raw, raw_hash: hash, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'ingest', raw_receipt_authority: authority, correlation_id: A, attempts: 1 })).rejects.toThrow(/owned local checkpoint/i)
    expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([]); expect(plane.orphans()).toEqual([])
  })

  it('uses its private checkpoint state even when the public prototype methods are forged', async () => {
    const prototype = InMemoryCheckpointRepository.prototype
    const transact = Object.getOwnPropertyDescriptor(prototype, 'transact')!
    const transactPair = Object.getOwnPropertyDescriptor(prototype, 'transactPair')!
    Object.defineProperty(prototype, 'transact', { ...transact, value: async () => { throw new Error('forged post-callback transact') } })
    Object.defineProperty(prototype, 'transactPair', { ...transactPair, value: async () => { throw new Error('forged repeated transact pair') } })
    try {
      const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
      expect(() => Object.defineProperty(checkpoint, 'transact', { value: async () => { throw new Error('forged instance transact') } })).toThrow()
      await expect(plane.commitPage(input(checkpoint, plane, [record('private-owner')]))).resolves.toMatchObject({ checkpoint: { revision: 1 } })
      expect(checkpoint.read('run:atomic:Q01:Latest')).toMatchObject({ revision: 1 }); expect(plane.sources()).toHaveLength(1); expect(plane.audits()).toHaveLength(1)
    } finally {
      Object.defineProperty(prototype, 'transact', transact); Object.defineProperty(prototype, 'transactPair', transactPair)
    }
  })

  it.each(['namespace', 'bucket_class', 'key', 'version', 'content_hash', 'size_bytes', 'mime_type', 'rights_state', 'deletion_state'] as const)('captures the first raw %s value and never rereads the caller object after receipt resolution', async (field) => {
    const temporal = { ...raw } as Record<string, unknown>
    let reads = 0
    Object.defineProperty(temporal, field, { enumerable: true, get: () => {
      reads += 1
      if (reads === 1) return raw[field]
      throw new Error(`raw ${field} was reread`)
    } })
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(plane.commitPage({ ...input(checkpoint, plane, [record(`temporal-${field}`)]), raw_ref: temporal as unknown as import('../../../src/storage/object-ref').ObjectRef, raw_receipt_authority: { resolve: async ({ raw_ref }) => raw_ref } })).resolves.toMatchObject({ statuses: ['created'] })
    expect(reads).toBe(1); expect(plane.sources()[0]?.raw_ref).toEqual(raw)
  })

  it('rejects a throwing raw-ref getter before reserving or publishing any evidence', async () => {
    const throwing = { ...raw } as Record<string, unknown>
    Object.defineProperty(throwing, 'version', { enumerable: true, get: () => { throw new Error('untrusted raw getter') } })
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => A })
    await expect(plane.commitPage({ ...input(checkpoint, plane, [record('throwing-raw')]), raw_ref: throwing as unknown as import('../../../src/storage/object-ref').ObjectRef })).rejects.toThrow(/untrusted raw getter/i)
    expect(checkpoint.read('run:atomic:Q01:Latest')).toBeUndefined(); expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([]); expect(plane.orphans()).toEqual([])
  })

  it('does not publish either repeated-cursor checkpoint when the paired operation fails', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    await expect(checkpoint.transactPair({ first: { identity: 'run:repeat:Q01:Latest', expected_revision: 0, next: { ...next, run_status: 'partial', unit_status: 'partial', stop_reason: 'repeated_cursor' } }, second: { identity: 'run:repeat', expected_revision: 0, next: { ...next, query_identity: 'run:repeat', query_hash: `sha256:v1:${'b'.repeat(64)}`, run_status: 'partial', unit_status: 'partial', stop_reason: 'repeated_cursor' } } }, () => { throw new Error('simulated pair crash') })).rejects.toThrow('simulated pair crash')
    expect(checkpoint.read('run:repeat:Q01:Latest')).toBeUndefined(); expect(checkpoint.read('run:repeat')).toBeUndefined()
  })

  it('rejects async checkpoint callbacks and permits a synchronous callback to schedule a reentrant CAS', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); let nested: Promise<number> | undefined
    const first = await checkpoint.transact({ identity: 'run:reentrant:first', expected_revision: 0, next }, (current) => {
      nested = checkpoint.transact({ identity: 'run:reentrant:second', expected_revision: 0, next: { ...next, query_identity: 'Q02:Top', query_hash: `sha256:v1:${'b'.repeat(64)}` } }, (second) => second.revision)
      return current.revision
    })
    expect(first).toBe(1); await expect(nested).resolves.toBe(1)
    await expect(checkpoint.transact({ identity: 'run:thenable', expected_revision: 0, next }, (() => Promise.resolve(1)) as never)).rejects.toThrow('must be synchronous')
    expect(checkpoint.read('run:thenable')).toBeUndefined()
  })

  it('snapshots every checkpoint-next field once and rejects malformed nested values before CAS publication', async () => {
    const temporalNext = { ...next } as Record<string, unknown>
    let reads = 0
    Object.defineProperty(temporalNext, 'query_hash', { enumerable: true, get: () => { reads += 1; if (reads === 1) return hash; throw new Error('query hash reread') } })
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    await expect(checkpoint.transact({ identity: 'run:temporal-next', expected_revision: 0, next: temporalNext as unknown as CheckpointNext }, (current) => current)).resolves.toMatchObject({ query_hash: hash, revision: 1 })
    expect(reads).toBe(1)
    const invalids: unknown[] = [
      { identity: 'run:extra-next', expected_revision: 0, next: { ...next, extra: true } },
      { identity: 'run:function-next', expected_revision: 0, next: { ...next, seen_cursors: [() => undefined] } },
      { identity: 'run:array-next', expected_revision: 0, next: { ...next, request_ledger: [{}] } },
    ]
    for (const invalid of invalids) await expect(checkpoint.transact(invalid as never, (current) => current)).rejects.toThrow(/checkpoint input is invalid/i)
    expect(checkpoint.read('run:extra-next')).toBeUndefined(); expect(checkpoint.read('run:function-next')).toBeUndefined(); expect(checkpoint.read('run:array-next')).toBeUndefined()
  })

  it('validates initial checkpoint snapshots and canonical clock output before owning state', async () => {
    await expect(Promise.resolve().then(() => new InMemoryCheckpointRepository({ now: () => '2026-08-24T00:00:00.000Z', initial: [{ identity: 'run:bad-initial', revision: 0, ...next, extra: true } as never] }))).rejects.toThrow(/initial state is invalid/i)
    const checkpoint = new InMemoryCheckpointRepository({ now: () => 'not-a-clock' })
    await expect(checkpoint.transact({ identity: 'run:bad-clock', expected_revision: 0, next }, (current) => current)).rejects.toThrow(/clock must return/i)
    expect(checkpoint.read('run:bad-clock')).toBeUndefined()
  })
})
