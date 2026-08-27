import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { principals } from '@/access/principals'
import { LocalObjectStore } from '@/storage/local-object-store'
import { describe, expect, it } from 'vitest'

import { InMemoryCheckpointRepository, InMemorySourceWritePlane } from '../../../src/source-adapters/checkpoint'
import { Twitter241AcquisitionOrchestrator, Twitter241PaginationTracker } from '../../../src/source-adapters/ingest'
import { buildTwitter241SourceIdempotencyKey, LocalRawEvidenceStore, Twitter241Adapter } from '../../../src/source-adapters/twitter241'
import type { DnsResolver, HttpResponse, SecretProvider } from '../../../src/source-adapters/types'

const ULID_A = '01J0J0J0J0J0J0J0J0J0J0J0J0'
const at = '2026-08-24T00:00:00.000Z'
const secret = 'rapidapi-secret-sentinel'
const body = (id = 'tweet-241'): Uint8Array => new TextEncoder().encode(JSON.stringify({
  data: {
    id,
    url: `https://x.com/synthetic/status/${id}`,
    text: 'Synthetic prompt fixture',
    author: { id: 'author-1', name: 'Synthetic Author', handle: 'synthetic' },
  },
}))

const response = (status = 200, bytes = body(), headers: Record<string, string> = {}, peer_address = '8.8.8.8'): HttpResponse => ({ status, headers, body: bytes, peer_address })
const publicDns = (addresses: readonly string[] = ['8.8.8.8']): DnsResolver => ({ resolve: async () => addresses })
const secretProvider: SecretProvider = { rapidApiKey: () => secret }

describe('P1-T06 fake Twitter241 ingestion', () => {
  it('builds a source-only Twitter241 idempotency identity without changing T05 queue keys', () => {
    expect(buildTwitter241SourceIdempotencyKey('tweet-241', `sha256:v1:${'a'.repeat(64)}`)).toBe(`twitter241:tweet-241:sha256:v1:${'a'.repeat(64)}`)
  })

  it('tracks exactly twenty pagination units, closes two no-new pages, and keeps repeated cursors partial', () => {
    const complete = new Twitter241PaginationTracker()
    for (const unit of Twitter241PaginationTracker.requiredUnits()) complete.record({ unit, cursor: null, next_cursor: null, new_provider_record_ids: ['tweet'], natural_end: true })
    expect(complete.status()).toBe('complete')
    const partial = new Twitter241PaginationTracker(); const unit = Twitter241PaginationTracker.requiredUnits()[0]!
    partial.record({ unit, cursor: null, next_cursor: 'same', new_provider_record_ids: ['first'], natural_end: false })
    partial.record({ unit, cursor: 'same', next_cursor: 'again', new_provider_record_ids: ['second'], natural_end: false })
    partial.record({ unit, cursor: 'same', next_cursor: 'same', new_provider_record_ids: ['third'], natural_end: false })
    expect(partial.status()).toBe('partial')
    expect(partial.unitStatus(unit)).toBe('partial')
    const noNew = new Twitter241PaginationTracker()
    for (const candidate of Twitter241PaginationTracker.requiredUnits()) {
      noNew.record({ unit: candidate, cursor: null, next_cursor: 'next', new_provider_record_ids: [], natural_end: false })
      noNew.record({ unit: candidate, cursor: 'next', next_cursor: null, new_provider_record_ids: [], natural_end: false })
      expect(noNew.unitStatus(candidate)).toBe('no_new_ids')
    }
    expect(noNew.status()).toBe('complete')
    expect(partial.deletionEvents()).toEqual([])
  })

  it('runs all twenty units through a real private raw store and receipt-bound page bundle commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-t06-orchestrator-'))
    const objectStore = new LocalObjectStore({ root_dir: root, signer_secret: 'test-only-signer' })
    const rawStore = new LocalRawEvidenceStore({ object_store: objectStore, principal: principals.ingestService, correlation_id: ULID_A })
    let nextId = 0
    const writePlane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => `${ULID_A.slice(0, -2)}${String(nextId++).padStart(2, '0')}` })
    const fullAdapter = new Twitter241Adapter({
      transport: { request: async (entry) => {
        const url = new URL(entry.url)
        const id = `${url.searchParams.get('query')}-${url.searchParams.get('type')}`
        return response(200, new TextEncoder().encode(JSON.stringify({ data: { records: [{ id, url: `https://x.com/a/status/${id}`, text: 'fixture', author: { id: 'a', name: 'A', handle: 'a' } }], next_cursor: null, partial: false, rate_limit: null, provider_request_id: 'fake' } })))
      } }, dns: publicDns(), secret: secretProvider,
    })
    try {
      const result = await new Twitter241AcquisitionOrchestrator({ adapter: fullAdapter, checkpoint: new InMemoryCheckpointRepository({ now: () => at }), clock: { now: () => at, sleep: async () => undefined }, queryFor: (queryId) => `fixture-${queryId}`, raw_store: rawStore, receipt_authority: rawStore.receiptAuthority(), write_plane: writePlane }).run({ identity: 'run:private-fixture', expected_revision: 0, correlation_id: ULID_A })
      expect(result).toMatchObject({ run_status: 'complete', completed_units: 20 })
      expect(writePlane.sources()).toHaveLength(20)
      expect(new Set(writePlane.sources().map((source) => source.id)).size).toBe(20)
      expect(writePlane.audits()).toHaveLength(20)
      expect(writePlane.artifacts()).toEqual([])
      expect(writePlane.deletions()).toEqual([])
      expect(result.request_ledger).toHaveLength(20)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('quarantines an invalid persisted page through the real local object store without advancing a source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-t06-quarantine-'))
    const objectStore = new LocalObjectStore({ root_dir: root, signer_secret: 'test-only-signer' })
    const rawStore = new LocalRawEvidenceStore({ object_store: objectStore, principal: principals.ingestService, correlation_id: ULID_A })
    const writePlane = new InMemorySourceWritePlane({ now: () => at, idFactory: () => ULID_A })
    const checkpoint = new InMemoryCheckpointRepository({ now: () => at })
    const invalid = new Twitter241Adapter({ transport: { request: async () => response(200, new TextEncoder().encode('{"data":{"unknown":true}}')) }, dns: publicDns(), secret: secretProvider })
    try {
      await expect(new Twitter241AcquisitionOrchestrator({ adapter: invalid, checkpoint, clock: { now: () => at, sleep: async () => undefined }, queryFor: () => 'fixture', raw_store: rawStore, receipt_authority: rawStore.receiptAuthority(), write_plane: writePlane }).run({ identity: 'run:quarantine', expected_revision: 0, correlation_id: ULID_A })).rejects.toMatchObject({ code: 'invalid_response', attempts: 1 })
      expect(writePlane.sources()).toEqual([])
      expect(writePlane.orphans()).toMatchObject([{ reason: 'provider_schema' }])
      expect(writePlane.audits()).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'source.ingest.quarantine', outcome: 'failed', reason_code: 'invalid_response' })]))
      expect(writePlane.audits()).toHaveLength(2)
      expect(checkpoint.read('run:quarantine:Q01:Latest')).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: 'invalid_response', attempt: 1 })
      expect(checkpoint.read('run:quarantine')).toMatchObject({ revision: 1, run_status: 'partial', unit_status: 'failed', stop_reason: 'invalid_response', attempt: 1 })
      await expect(writePlane.reconcileOrphans({ strategy: 'retain' })).resolves.toEqual({ retained: 1, deleted: 0 })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('accepts an exact 25MiB strict page and rejects 25MiB plus one before private-object persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p1-t06-size-'))
    const objectStore = new LocalObjectStore({ root_dir: root, signer_secret: 'test-only-signer' })
    const rawStore = new LocalRawEvidenceStore({ object_store: objectStore, principal: principals.ingestService, correlation_id: ULID_A })
    const makeBody = (size: number): Uint8Array => {
      const data = { data: { records: [{ id: 'size', url: 'https://x.com/a/status/size', text: 'x', author: { id: 'a', name: 'A', handle: 'a' } }], next_cursor: null, partial: false, rate_limit: null, provider_request_id: 'size' } }
      const base = JSON.stringify(data); return new TextEncoder().encode(`${base}${' '.repeat(size - Buffer.byteLength(base))}`)
    }
    const exact = makeBody(25 * 1024 * 1024); const over = makeBody(25 * 1024 * 1024 + 1)
    expect(exact.byteLength).toBe(25 * 1024 * 1024); expect(over.byteLength).toBe(25 * 1024 * 1024 + 1)
    const adapterFor = (bytes: Uint8Array) => new Twitter241Adapter({ transport: { request: async () => response(200, bytes) }, dns: publicDns(), secret: secretProvider })
    try {
      const exactQuarantine: string[] = []
      await expect(adapterFor(exact).fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'size', type: 'Latest', count: 1 }, cursor: null, limit: 1 }, { correlation_id: ULID_A, captured_at: at, signal: new AbortController().signal, raw_store: rawStore, quarantine: { record: async () => { exactQuarantine.push('unexpected') } } })).resolves.toMatchObject({ records: [{ provider_record_id: 'size' }] })
      expect(exactQuarantine).toEqual([])
      const quarantined: string[] = []
      await expect(adapterFor(over).fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'size', type: 'Latest', count: 1 }, cursor: null, limit: 1 }, { correlation_id: ULID_A, captured_at: at, signal: new AbortController().signal, raw_store: rawStore, quarantine: { record: async () => { quarantined.push('unexpected') } } })).rejects.toMatchObject({ code: 'invalid_response' })
      expect(quarantined).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
