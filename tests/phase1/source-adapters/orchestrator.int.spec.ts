import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { InMemoryCheckpointRepository, InMemorySourceWritePlane, type CheckpointNext } from '../../../src/source-adapters/checkpoint'
import { SourceAdapterError } from '../../../src/source-adapters/errors'
import { Twitter241AcquisitionOrchestrator } from '../../../src/source-adapters/ingest'
import { Twitter241Adapter } from '../../../src/source-adapters/twitter241'
import { InMemoryVerifiedSnapshotReader } from '../../../src/source-adapters/verified-snapshot'
import type { RawEvidenceStore, SourceAdapter, SourceAdapterPage } from '../../../src/source-adapters/types'
import type { SourceWritePlane } from '../../../src/source-adapters/checkpoint'

const at = '2026-08-24T00:00:00.000Z'
const correlation = '01J0J0J0J0J0J0J0J0J0J0J0J0'

const page = (id: string, next_cursor: string | null = null): SourceAdapterPage => ({
  raw_ref: { namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/aa/${'a'.repeat(64)}`, content_hash: `sha256:v1:${'a'.repeat(64)}`, version: 'v1', size_bytes: 2, mime_type: 'application/json', rights_state: 'metadata_only', deletion_state: 'active' }, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'test-ingest',
  records: [{ provider: 'twitter241', provider_record_id: id, canonical_url: `https://x.com/a/status/${id}`, captured_at: at, title: null, text: 'fixture', author_id: 'a', author_handle: 'a', rights_state: 'metadata_only', rights_basis: null, raw_bytes: new TextEncoder().encode('{}'), raw_hash: `sha256:v1:${'a'.repeat(64)}` }],
  next_cursor, partial: false, rate_limit: null, provider_request_id: 'fake-request',
})
const emptyPage = (content_hash: string, next_cursor: string | null): SourceAdapterPage => ({
  raw_ref: { namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/bb/${content_hash.slice(-64)}`, content_hash, version: 'v1', size_bytes: 2, mime_type: 'application/json', rights_state: 'metadata_only', deletion_state: 'active' }, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'test-ingest',
  records: [], next_cursor, partial: false, rate_limit: null, provider_request_id: 'fake-request',
})
const rawStore: RawEvidenceStore = { write: async () => { throw new Error('fake SourceAdapter already persists its raw page') }, pendingRecoveryCandidates: async () => [], markDisposition: async () => undefined }
const orchestrator = (adapter: SourceAdapter, checkpoint: InMemoryCheckpointRepository, options: Readonly<{ clock?: { now: () => string; sleep: (milliseconds: number) => Promise<void> }; random?: () => number }> = {}) => { let id = 0; return new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: options.clock ?? { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: rawStore, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane: new InMemorySourceWritePlane({ now: () => at, idFactory: () => `${correlation.slice(0, -2)}${String(id++).padStart(2, '0')}` }), random: options.random }) }
const seedNext = (query_identity: string): CheckpointNext => ({ query_identity, adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: `sha256:v1:${'d'.repeat(64)}`, cursor: null, seen_cursors: [], seen_provider_record_ids: [], request_ledger: [], last_source_revision: null, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 })
const seedPlane = async (plane: InMemorySourceWritePlane, checkpoint: InMemoryCheckpointRepository): Promise<void> => {
  const source = page('seed').records[0]!
  await plane.commit({ checkpoint, checkpoint_identity: 'seed:checkpoint', expected_checkpoint_revision: 0, checkpoint_next: seedNext('seed:query'), normalized: source, raw_ref: page('seed').raw_ref, raw_receipt_id: 'receipt', raw_receipt_actor_id: 'test-ingest', raw_receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, raw_hash: page('seed').raw_ref.content_hash, correlation_id: correlation, partial: false })
}

describe('T06 twenty-unit local acquisition', () => {
  it('persists complete strict checkpoint metadata only after all 20 natural ends', async () => {
    const calls: string[] = []
    const adapter: SourceAdapter = { fetchPage: async (input) => { calls.push(`${input.query.query}:${input.query.type}`); return page(`${input.query.query}-${input.query.type}`) } }
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const result = await orchestrator(adapter, checkpoint).run({ identity: 'run:fixture', expected_revision: 0, correlation_id: correlation })
    expect(result).toMatchObject({ run_status: 'complete', completed_units: 20, partial: false })
    expect(calls).toHaveLength(20)
    expect(checkpoint.read('run:fixture')).toMatchObject({ revision: 20, adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: expect.stringMatching(/^sha256:v1:/), cursor: null, last_source_revision: `sha256:v1:${'a'.repeat(64)}`, run_status: 'complete', unit_status: 'natural_end', stop_reason: 'natural_end', attempt: 0, updated_at: at })
  })

  it('records terminal provider failure as a CAS checkpoint without raw/source writes', async () => {
    const adapter: SourceAdapter = { fetchPage: async () => { throw Object.assign(new Error('private key must not leak'), { code: 'auth', retryable: false }) } }
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    await expect(orchestrator(adapter, checkpoint).run({ identity: 'run:failure', expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'auth' })
    expect(checkpoint.read('run:failure')).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: 'auth', attempt: 1 })
  })

  it('does not trust a provider-forged quarantine_audited boolean without the internal audit capability', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation })
    const adapter: SourceAdapter = { fetchPage: async () => { throw new SourceAdapterError('invalid_response', undefined, 1, true, true) } }
    const acquisition = new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: rawStore, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane: plane })
    await expect(acquisition.run({ identity: 'run:forged-quarantine', expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(checkpoint.read('run:forged-quarantine')).toBeUndefined(); expect(checkpoint.read('run:forged-quarantine:Q01:Latest')).toBeUndefined(); expect(plane.audits()).toEqual([])
  })

  it('wraps a malicious adapter error without retaining its secret-bearing message', async () => {
    const adapter: SourceAdapter = { fetchPage: async () => { throw Object.assign(new Error('rapidapi-secret-sentinel'), { code: 'auth', retryable: false }) } }
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    await expect(orchestrator(adapter, checkpoint).run({ identity: 'run:secret', expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'auth', message: 'provider authentication rejected' })
  })

  it.each([
    ['commit hook', () => new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation, fail_commit: () => { throw new Error('commit unavailable') } })],
    ['source hook', () => new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation, fail_source: () => { throw new Error('source unavailable') } })],
    ['audit hook', () => new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation, fail_audit: () => { throw new Error('audit unavailable') } })],
  ] as const)('retains exactly one recoverable orphan without retrying provider fetch after a %s page-bundle failure', async (_kind, makePlane) => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = makePlane(); let calls = 0
    const adapter: SourceAdapter = { fetchPage: async () => { calls += 1; return page('bundle-failure') } }
    const acquisition = new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: rawStore, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane: plane })
    await expect(acquisition.run({ identity: `run:bundle-failure:${_kind.replaceAll(' ', '-')}`, expected_revision: 0, correlation_id: correlation })).rejects.toBeInstanceOf(Error)
    expect(calls).toBe(1); expect(plane.orphans()).toMatchObject([{ reason: 'write_plane_failure', retained: true }]); expect(plane.orphans()).toHaveLength(1)
    expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([]); expect(checkpoint.read(`run:bundle-failure:${_kind.replaceAll(' ', '-')}`)).toBeUndefined()
    expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('compensates a real aggregate CAS race with one checkpoint-conflict orphan and no provider retry', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation }); let calls = 0
    const identity = 'run:bundle-cas'
    const adapter: SourceAdapter = { fetchPage: async () => {
      calls += 1
      await checkpoint.transact({ identity, expected_revision: 0, next: { query_identity: `run:${identity}`, adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: `sha256:v1:${createHash('sha256').update(`run:${identity}`).digest('hex')}`, cursor: null, seen_cursors: [], seen_provider_record_ids: [], request_ledger: [], last_source_revision: null, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 } }, () => undefined)
      return page('cas-race')
    } }
    const acquisition = new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: rawStore, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane: plane })
    await expect(acquisition.run({ identity, expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'checkpoint_conflict' })
    expect(calls).toBe(1); expect(plane.orphans()).toMatchObject([{ reason: 'checkpoint_conflict' }]); expect(plane.orphans()).toHaveLength(1)
    expect(plane.sources()).toEqual([]); expect(plane.audits()).toEqual([]); expect(checkpoint.read(identity)?.revision).toBe(1)
    expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('compensates a real source-ID collision with one orphan and no second provider call', async () => {
    let audit = 0; const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation, source_id_factory: () => correlation, audit_id_factory: () => [correlation, `${correlation.slice(0, -1)}1`][audit++] ?? `${correlation.slice(0, -1)}2` })
    const seedCheckpoint = new InMemoryCheckpointRepository({ now: () => at }); await seedPlane(plane, seedCheckpoint)
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); let calls = 0
    const adapter: SourceAdapter = { fetchPage: async () => { calls += 1; return page('source-collision') } }
    const acquisition = new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: rawStore, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane: plane })
    await expect(acquisition.run({ identity: 'run:source-collision', expected_revision: 0, correlation_id: correlation })).rejects.toThrow('source id collision')
    expect(calls).toBe(1); expect(plane.orphans()).toMatchObject([{ reason: 'write_plane_failure' }]); expect(plane.orphans()).toHaveLength(1); expect(checkpoint.read('run:source-collision')).toBeUndefined()
    expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('compensates a real audit-ID collision with one orphan and no second provider call', async () => {
    let source = 0; const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation, source_id_factory: () => [correlation, `${correlation.slice(0, -1)}1`][source++] ?? `${correlation.slice(0, -1)}2`, audit_id_factory: () => correlation })
    const seedCheckpoint = new InMemoryCheckpointRepository({ now: () => at }); await seedPlane(plane, seedCheckpoint)
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); let calls = 0
    const adapter: SourceAdapter = { fetchPage: async () => { calls += 1; return page('audit-collision') } }
    const acquisition = new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: rawStore, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane: plane })
    await expect(acquisition.run({ identity: 'run:audit-collision', expected_revision: 0, correlation_id: correlation })).rejects.toThrow('audit event id collision')
    expect(calls).toBe(1); expect(plane.orphans()).toMatchObject([{ reason: 'write_plane_failure' }]); expect(plane.orphans()).toHaveLength(1); expect(checkpoint.read('run:audit-collision')).toBeUndefined()
    expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('publishes no quarantine evidence or terminal checkpoints when the atomic quarantine audit fails', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation, fail_audit: () => { throw new Error('audit unavailable') } }); let calls = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => { calls += 1; return { status: 200, headers: {}, body: new TextEncoder().encode('{"data":{"invalid":true}}'), peer_address: '8.8.8.8' } } }, dns: { resolve: async () => ['8.8.8.8'] }, secret: { rapidApiKey: () => 'test-only-secret' } })
    const persistedRaw: RawEvidenceStore = { write: async () => ({ ref: page('quarantine').raw_ref, receipt: { receipt_id: 'receipt', actor_id: 'test-ingest', field: 'raw_ref', correlation_id: correlation, ref_key: page('quarantine').raw_ref.key, content_hash: page('quarantine').raw_ref.content_hash }, actor_id: 'test-ingest' }), pendingRecoveryCandidates: async () => [], markDisposition: async () => undefined }
    const acquisition = new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: persistedRaw, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane: plane })
    await expect(acquisition.run({ identity: 'run:quarantine-fallback', expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(calls).toBe(1); expect(plane.orphans()).toEqual([])
    expect(plane.audits()).toEqual([]); expect(plane.sources()).toEqual([]); expect(checkpoint.read('run:quarantine-fallback')).toBeUndefined()
    expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('publishes no quarantine evidence or terminal checkpoints when the atomic audit ID collides', async () => {
    const plane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => correlation, audit_id_factory: () => correlation })
    await seedPlane(plane, new InMemoryCheckpointRepository({ now: () => at }))
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); let calls = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => { calls += 1; return { status: 200, headers: {}, body: new TextEncoder().encode('{"data":{"invalid":true}}'), peer_address: '8.8.8.8' } } }, dns: { resolve: async () => ['8.8.8.8'] }, secret: { rapidApiKey: () => 'test-only-secret' } })
    const persistedRaw: RawEvidenceStore = { write: async () => ({ ref: page('quarantine-id').raw_ref, receipt: { receipt_id: 'receipt' }, actor_id: 'test-ingest' }), pendingRecoveryCandidates: async () => [], markDisposition: async () => undefined }
    const acquisition = new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: persistedRaw, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane: plane })
    await expect(acquisition.run({ identity: 'run:quarantine-id-fallback', expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(calls).toBe(1); expect(plane.orphans()).toEqual([])
    expect(plane.audits()).toHaveLength(1); expect(plane.sources()).toHaveLength(1); expect(checkpoint.read('run:quarantine-id-fallback')).toBeUndefined()
    expect(plane.artifacts()).toEqual([]); expect(plane.deletions()).toEqual([])
  })

  it('honours a valid 429 Retry-After delta exactly and resets a recovered page checkpoint attempt', async () => {
    const sleeps: number[] = []; let calls = 0
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const rateLimited: SourceAdapter = { fetchPage: async () => {
      calls += 1
      if (calls === 1) throw new SourceAdapterError('rate_limited', '3')
      return page(`rate-${calls}`)
    } }
    const result = await orchestrator(rateLimited, checkpoint, { clock: { now: () => at, sleep: async (delay) => { sleeps.push(delay) } } }).run({ identity: 'run:429-header', expected_revision: 0, correlation_id: correlation })
    expect(result).toMatchObject({ run_status: 'complete', completed_units: 20 })
    expect(calls).toBe(21)
    expect(sleeps).toEqual([3000])
    expect(checkpoint.read('run:429-header')).toMatchObject({ revision: 20, run_status: 'complete', unit_status: 'natural_end', stop_reason: 'natural_end', attempt: 0 })
    expect(checkpoint.read('run:429-header:Q01:Latest')).toMatchObject({ revision: 1, unit_status: 'natural_end', stop_reason: 'natural_end', attempt: 0 })
  })

  it.each([undefined, 'not-a-valid-retry-after'])('exhausts 429 with %s Retry-After on the fixed schedule and checkpoints rate_limited', async (retryAfter) => {
    const sleeps: number[] = []; let calls = 0
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const adapter: SourceAdapter = { fetchPage: async () => { calls += 1; throw new SourceAdapterError('rate_limited', retryAfter) } }
    const identity = `run:429-fixed:${retryAfter ?? 'missing'}`
    await expect(orchestrator(adapter, checkpoint, { clock: { now: () => at, sleep: async (delay) => { sleeps.push(delay) } } }).run({ identity, expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'rate_limited', attempts: 6 })
    expect(calls).toBe(6)
    expect(sleeps).toEqual([2000, 4000, 8000, 16000, 32000])
    expect(checkpoint.read(`${identity}:Q01:Latest`)).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: 'rate_limited', attempt: 6 })
    expect(checkpoint.read(identity)).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: 'rate_limited', attempt: 6 })
  })

  it('uses deterministic full jitter for exhausted 5xx retries and checkpoints transient_upstream', async () => {
    const sleeps: number[] = []; let calls = 0
    const randoms = [0, 0.25, 0.5, 0.75, 1]
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const adapter: SourceAdapter = { fetchPage: async () => { calls += 1; throw new SourceAdapterError('transient_upstream') } }
    await expect(orchestrator(adapter, checkpoint, { clock: { now: () => at, sleep: async (delay) => { sleeps.push(delay) } }, random: () => randoms.shift() ?? 1 }).run({ identity: 'run:5xx-jitter', expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'transient_upstream', attempts: 6 })
    expect(calls).toBe(6)
    expect(sleeps).toEqual([0, 1000, 4000, 12000, 32000])
    expect(checkpoint.read('run:5xx-jitter:Q01:Latest')).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: 'transient_upstream', attempt: 6 })
    expect(checkpoint.read('run:5xx-jitter')).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: 'transient_upstream', attempt: 6 })
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'entitlement'],
  ] as const)('does not retry terminal HTTP %i (%s) and checkpoints the canonical failure once', async (status, code) => {
    let calls = 0; const sleeps: number[] = []
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const adapter = new Twitter241Adapter({
      transport: { request: async () => { calls += 1; return { status, headers: {}, body: new Uint8Array(), peer_address: '8.8.8.8' } } },
      dns: { resolve: async () => ['8.8.8.8'] },
      secret: { rapidApiKey: () => 'test-only-secret' },
    })
    const identity = `run:terminal:${status}`
    await expect(orchestrator(adapter, checkpoint, { clock: { now: () => at, sleep: async (delay) => { sleeps.push(delay) } } }).run({ identity, expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code, attempts: 1 })
    expect(calls).toBe(1)
    expect(sleeps).toEqual([])
    expect(checkpoint.read(`${identity}:Q01:Latest`)).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: code, attempt: 1 })
    expect(checkpoint.read(identity)).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: code, attempt: 1 })
  })

  it('keeps a verified B0 snapshot reader byte-identical through sixty minutes of acquisition outages', async () => {
    let now = Date.parse(at); const payload = new TextEncoder().encode('verified-b0-bytes')
    const crypto = await import('node:crypto'); const tree_hash = `sha256:v1:${crypto.createHash('sha256').update(payload).digest('hex')}`
    const reader = new InMemoryVerifiedSnapshotReader({ pointer: 'b0-pointer', version: 'P2L-B0', tree_hash, payload, audit_prefix_hash: `sha256:v1:${'b'.repeat(64)}` })
    const outage: SourceAdapter = { fetchPage: async () => { throw new SourceAdapterError('transient_upstream') } }
    for (let minute = 0; minute <= 60; minute += 5) {
      const before = reader.read()
      await expect(orchestrator(outage, new InMemoryCheckpointRepository({ now: () => new Date(now).toISOString() }), { clock: { now: () => new Date(now).toISOString(), sleep: async (delay) => { now += delay } }, random: () => 1 }).run({ identity: `run:outage:${minute}`, expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'transient_upstream', attempts: 6 })
      const after = reader.read()
      expect(after).toMatchObject({ pointer: before.pointer, version: before.version, tree_hash: before.tree_hash, audit_prefix_hash: before.audit_prefix_hash })
      expect([...after.payload]).toEqual([...before.payload])
      now = Date.parse(at) + (minute + 5) * 60_000
    }
  })

  it('stops a unit before fetching a cursor which was already seen and never emits deletion', async () => {
    let calls = 0
    const adapter: SourceAdapter = { fetchPage: async () => { calls += 1; return page(`id-${calls}`, calls === 1 ? 'again' : 'again') } }
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const result = await orchestrator(adapter, checkpoint).run({ identity: 'run:repeat', expected_revision: 0, correlation_id: correlation })
    expect(result).toMatchObject({ run_status: 'partial', completed_units: 0, deletion_events: [] })
    expect(calls).toBe(2)
  })

  it('resumes a persisted natural-end unit instead of fetching it again', async () => {
    let calls = 0
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const failing: SourceAdapter = { fetchPage: async () => { calls += 1; if (calls === 2) throw Object.assign(new Error('offline'), { code: 'auth' }); return page('first') } }
    await expect(orchestrator(failing, checkpoint).run({ identity: 'run:resume', expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'auth' })
    const recovered: SourceAdapter = { fetchPage: async () => { calls += 1; return page('second') } }
    const resumed = await orchestrator(recovered, checkpoint).run({ identity: 'run:resume', expected_revision: 2, correlation_id: correlation })
    expect(calls).toBe(21)
    expect(checkpoint.read('run:resume')).toMatchObject({ revision: 21, run_status: 'complete' })
    expect(resumed.request_ledger).toHaveLength(20)
    expect(resumed.request_ledger[0]?.raw_hash).toBe(`sha256:v1:${'a'.repeat(64)}`)
  })

  it('resumes a persisted first no-new page as the second no-new page without fetching its next cursor', async () => {
    const identity = 'run:no-new-resume'; const queryIdentity = 'Q01:Latest'; const query = 'fixture-Q01'
    const hash = (value: string) => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at, initial: [
      { identity, query_identity: `run:${identity}`, revision: 1, adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: hash(`run:${identity}`), cursor: null, seen_cursors: [], seen_provider_record_ids: ['same'], request_ledger: [], last_source_revision: null, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0, consecutive_no_new_pages: 0 },
      { identity: `${identity}:${queryIdentity}`, query_identity: queryIdentity, revision: 1, adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: hash(`${queryIdentity}\n${query}`), cursor: 'c1', seen_cursors: [], seen_provider_record_ids: ['same'], request_ledger: [], last_source_revision: `sha256:v1:${'a'.repeat(64)}`, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0, consecutive_no_new_pages: 1 },
    ] })
    const calls: string[] = []
    const adapter: SourceAdapter = { fetchPage: async (input) => {
      calls.push(`${input.query.query}:${input.query.type}:${input.cursor ?? 'null'}`)
      if (input.query.query === query && input.query.type === 'Latest' && input.cursor === 'c1') return page('same', 'c2')
      if (input.cursor === 'c2') throw new Error('must not request c2 after the second no-new page')
      throw new SourceAdapterError('auth')
    } }
    await expect(orchestrator(adapter, checkpoint).run({ identity, expected_revision: 1, correlation_id: correlation })).rejects.toMatchObject({ code: 'auth', attempts: 1 })
    expect(calls).toEqual([`${query}:Latest:c1`, `${query}:Top:null`])
    expect(checkpoint.read(`${identity}:${queryIdentity}`)).toMatchObject({ revision: 2, cursor: 'c2', unit_status: 'no_new_ids', stop_reason: 'no_new_ids', consecutive_no_new_pages: 2 })
    expect(checkpoint.read(identity)).toMatchObject({ revision: 3, run_status: 'partial', unit_status: 'failed', stop_reason: 'auth', request_ledger: [{ query_identity: queryIdentity, input_cursor: 'c1', output_cursor: 'c2', raw_hash: `sha256:v1:${'a'.repeat(64)}`, record_count: 1, stop_reason: 'no_new_ids' }] })
  })

  it('atomically checkpoints every page before the next fetch so a crash resume keeps seen IDs, ledger, and last source revision', async () => {
    const identity = 'run:crash-page'; const queryIdentity = 'Q01:Latest'; const query = 'fixture-Q01'; const rawHash = `sha256:v1:${'a'.repeat(64)}`
    const hash = (value: string) => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at, initial: [{ identity, query_identity: `run:${identity}`, revision: 1, adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: hash(`run:${identity}`), cursor: null, seen_cursors: [], seen_provider_record_ids: ['same'], request_ledger: [], last_source_revision: null, consecutive_no_new_pages: 0, run_status: 'running', unit_status: 'open', stop_reason: null, attempt: 0 }] })
    let ids = 0
    const durablePlane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => `${correlation.slice(0, -2)}${String(ids += 1).padStart(2, '0')}` })
    const crashingPlane: SourceWritePlane = {
      commit: (input) => durablePlane.commit(input),
      commitPage: async (input) => { await durablePlane.commitPage(input); throw new Error('simulated crash after durable page bundle') },
      recordOrphan: (input) => durablePlane.recordOrphan(input),
      recordQuarantine: (input) => durablePlane.recordQuarantine(input),
      commitQuarantinedFailure: (input) => durablePlane.commitQuarantinedFailure(input),
      reconcilePendingRaw: (input) => durablePlane.reconcilePendingRaw(input),
      commitTerminalFailure: (input) => durablePlane.commitTerminalFailure(input),
      reconcileOrphans: (input) => durablePlane.reconcileOrphans(input),
      sources: () => durablePlane.sources(), audits: () => durablePlane.audits(), orphans: () => durablePlane.orphans(), artifacts: () => durablePlane.artifacts(), deletions: () => durablePlane.deletions(),
    }
    const firstCalls: string[] = []
    const first: SourceAdapter = { fetchPage: async (input) => { firstCalls.push(`${input.query.query}:${input.query.type}:${input.cursor ?? 'null'}`); if (input.query.query === query && input.query.type === 'Latest') return page('same', 'c1'); throw new SourceAdapterError('auth') } }
    const create = (adapter: SourceAdapter, write_plane: SourceWritePlane) => new Twitter241AcquisitionOrchestrator({ adapter, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: (entry) => `fixture-${entry}`, raw_store: rawStore, receipt_authority: { resolve: async ({ raw_ref }) => raw_ref }, write_plane })
    await expect(create(first, crashingPlane).run({ identity, expected_revision: 1, correlation_id: correlation })).rejects.toMatchObject({ code: 'auth', attempts: 1 })
    expect(firstCalls).toEqual([`${query}:Latest:null`, `${query}:Latest:c1`, `${query}:Top:null`])
    expect(durablePlane.orphans()).toEqual([])
    expect(checkpoint.read(identity)).toMatchObject({ revision: 4, seen_provider_record_ids: ['same'], request_ledger: [{ query_identity: queryIdentity, input_cursor: null, output_cursor: 'c1', raw_hash: rawHash }, { query_identity: queryIdentity, input_cursor: 'c1', output_cursor: 'c1', raw_hash: rawHash, stop_reason: 'no_new_ids' }], last_source_revision: rawHash })
    expect(checkpoint.read(`${identity}:${queryIdentity}`)).toMatchObject({ revision: 2, cursor: 'c1', unit_status: 'no_new_ids', stop_reason: 'no_new_ids' })
  })

  it('carries the last accepted source revision across a later empty page', async () => {
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at }); const emptyHash = `sha256:v1:${'b'.repeat(64)}`
    const adapter: SourceAdapter = { fetchPage: async (input) => {
      if (input.query.query === 'fixture-Q01' && input.query.type === 'Latest' && input.cursor === null) return page('fresh', 'c1')
      if (input.query.query === 'fixture-Q01' && input.query.type === 'Latest' && input.cursor === 'c1') return emptyPage(emptyHash, null)
      throw new SourceAdapterError('auth')
    } }
    await expect(orchestrator(adapter, checkpoint).run({ identity: 'run:last-source', expected_revision: 0, correlation_id: correlation })).rejects.toMatchObject({ code: 'auth', attempts: 1 })
    expect(checkpoint.read('run:last-source:Q01:Latest')).toMatchObject({ revision: 2, last_source_revision: `sha256:v1:${'a'.repeat(64)}`, request_ledger: [
      { raw_hash: `sha256:v1:${'a'.repeat(64)}` }, { raw_hash: emptyHash },
    ] })
    expect(checkpoint.read('run:last-source')).toMatchObject({ revision: 3, last_source_revision: `sha256:v1:${'a'.repeat(64)}` })
  })
})
