import { describe, expect, it } from 'vitest'

import { Twitter241Adapter } from '../../../src/source-adapters/twitter241'
import { countSecretSentinel } from '../../../src/source-adapters/ingest'
import * as acquisition from '../../../src/source-adapters/ingest'
import { parseRetryAfter, sanitizeRetryAfter } from '../../../src/queues/retry'
import { LocalRawEvidenceStore } from '../../../src/source-adapters/twitter241'
import { LocalObjectStore } from '../../../src/storage/local-object-store'
import { principals } from '../../../src/access/principals'
import type { DnsResolver, HttpRequest, HttpResponse, RawEvidenceStore, SourceAdapterContext } from '../../../src/source-adapters/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const response = (overrides: Partial<HttpResponse> = {}): HttpResponse => ({
  status: 200, headers: {}, peer_address: '8.8.8.8', body: bytes({ data: { id: 'tweet-1', url: 'https://x.com/a/status/tweet-1', text: 'fixture', author: { id: 'a', name: 'A', handle: 'a' } } }), ...overrides,
})
const dns = (answers: readonly string[] = ['8.8.8.8']): DnsResolver => ({ resolve: async () => answers })
const rawStore: RawEvidenceStore = { write: async ({ bytes, content_hash }) => ({ ref: { namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/${content_hash.slice(10, 12)}/${content_hash.slice(10)}`, content_hash, version: 'v1', size_bytes: bytes.byteLength, mime_type: 'application/json', rights_state: 'metadata_only', deletion_state: 'active' }, receipt: { receipt_id: 'receipt' }, actor_id: 'ingest' }), pendingRecoveryCandidates: async () => [], markDisposition: async () => undefined }
const quarantineRecords: Parameters<NonNullable<SourceAdapterContext['quarantine']>['record']>[0][] = []
const quarantine: NonNullable<SourceAdapterContext['quarantine']> = { record: async (input) => { quarantineRecords.push(input) } }

describe('T06 review reproductions', () => {
  it('exposes no callable one-page public ingestion primitive', () => {
    expect('ingestTwitter241' in acquisition).toBe(false)
    expect(Object.keys(acquisition)).not.toContain('ingestTwitter241')
  })

  it('exposes the versioned SourceAdapter fetchPage contract and pins every prevalidated peer into transport', async () => {
    const calls: Array<Readonly<{ request: HttpRequest; allowedPeers: readonly string[] }>> = []
    const adapter = new Twitter241Adapter({
      transport: { request: async (request, connection) => { calls.push({ request, allowedPeers: connection.allowed_peers }); return response() } },
      dns: dns(), secret: { rapidApiKey: () => 'review-secret' },
    })
    const page = await adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'Higgsfield', type: 'Latest', count: 20 }, cursor: null, limit: 20 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore, quarantine })
    expect(page).toMatchObject({ records: [{ provider_record_id: 'tweet-1' }], next_cursor: null, partial: false, rate_limit: null, provider_request_id: null })
    expect(calls).toEqual([{ request: expect.objectContaining({ method: 'GET' }), allowedPeers: ['8.8.8.8'] }])
  })

  it('owns transport bytes across offset views and a mutating raw store', async () => {
    const original = bytes({ data: { id: 'owned', url: 'https://x.com/a/status/owned', text: 'owned fixture', author: { id: 'a', name: 'A', handle: 'a' } } })
    const backing = new Uint8Array(original.byteLength + 4); backing.set(original, 2)
    const body = new Uint8Array(backing.buffer, 2, original.byteLength)
    let writeInput: Uint8Array | undefined
    const mutatingStore: RawEvidenceStore = {
      ...rawStore,
      write: async ({ bytes: stored, content_hash }) => {
        writeInput = stored; stored[0] = 0x7b; stored[1] = 0x7d
        return rawStore.write({ bytes: original, content_hash })
      },
    }
    const adapter = new Twitter241Adapter({ transport: { request: async () => response({ body }) }, dns: dns(), secret: { rapidApiKey: () => 'review-secret' } })
    const page = await adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'owned', type: 'Latest', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: mutatingStore, quarantine })
    expect(writeInput).not.toBe(body); expect(page.records[0]).toMatchObject({ provider_record_id: 'owned' }); expect(page.records[0]?.raw_bytes).toEqual(original)
    expect(page.records[0]?.raw_hash).toBe(`sha256:v1:${createHash('sha256').update(original).digest('hex')}`)
  })

  it('returns typed sanitized abort and transport failures without putting credentials in error fields', async () => {
    const controller = new AbortController(); controller.abort()
    const adapter = new Twitter241Adapter({ transport: { request: async () => { throw new Error('review-secret transport failure') } }, dns: dns(), secret: { rapidApiKey: () => 'review-secret' } })
    await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: controller.signal, raw_store: rawStore, quarantine })).rejects.toMatchObject({ code: 'aborted', retryable: false })
  })

  it.each([
    { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal },
    { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore },
  ])('rejects a JavaScript caller without durable page dependencies before fake transport', async (unsafeContext) => {
    let networkCalls = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => { networkCalls += 1; return response() } }, dns: dns(), secret: { rapidApiKey: () => 'review-secret' } })
    await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, unsafeContext as unknown as SourceAdapterContext)).rejects.toMatchObject({ code: 'invalid_response' })
    expect(networkCalls).toBe(0)
  })

  it('rejects unknown page input or missing signal before DNS or fake transport', async () => {
    let calls = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => { calls += 1; return response() } }, dns: dns(['8.8.8.8']), secret: { rapidApiKey: () => 'review-secret' } })
    await expect(adapter.fetchPage(undefined as never, {} as never)).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: 'x', captured_at: '2026-08-24T00:00:00.000Z', raw_store: rawStore, quarantine } as never)).rejects.toMatchObject({ code: 'invalid_response' })
    expect(calls).toBe(0)
  })

  it('rejects hex IPv4-mapped and expanded IPv6 unsafe DNS answers before transport', async () => {
    let calls = 0
    for (const unsafe of ['0:0:0:0:0:ffff:7f00:1', '0:0:0:0:0:0:0:1', '2001:0db8:0:0:0:0:0:1', '2001:1::1', '2001:1::4', '2001:100::1', '2001:3::1', '2001:4:112::1', '2001:21::1', '2001:30::1', '2620:4f:8000::1', '3fff::1', '::127.0.0.1', '::192.168.1.1', '::ffff:0:127.0.0.1', '64:ff9b::127.0.0.1', '192.31.196.1', '192.52.193.1', '192.88.99.1', '192.175.48.1', '240.0.0.1', '255.255.255.255']) {
      const adapter = new Twitter241Adapter({ transport: { request: async () => { calls += 1; return response() } }, dns: dns([unsafe]), secret: { rapidApiKey: () => 'review-secret' } })
      await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore, quarantine })).rejects.toMatchObject({ code: 'unsafe_endpoint', retryable: false })
    }
    expect(calls).toBe(0)
  })

  it('rejects each unsafe IPv6 peer after connect before consuming response bytes', async () => {
    for (const unsafe of ['::127.0.0.1', '::192.168.1.1', '::ffff:0:127.0.0.1', '64:ff9b::127.0.0.1', '2001:1::4', '2001:100::1', '2001:21::1', '192.31.196.1', '192.52.193.1', '192.88.99.1', '192.175.48.1', '240.0.0.1', '255.255.255.255']) {
      let calls = 0; let writes = 0; let resolution = 0
      const adapter = new Twitter241Adapter({ transport: { request: async () => { calls += 1; return response({ peer_address: unsafe }) } }, dns: { resolve: async () => resolution++ < 2 ? ['8.8.8.8'] : [unsafe] }, secret: { rapidApiKey: () => 'review-secret' } })
      const store: RawEvidenceStore = { ...rawStore, write: async (input) => { writes += 1; return rawStore.write(input) } }
      await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: store, quarantine })).rejects.toMatchObject({ code: 'unsafe_endpoint' })
      expect(calls).toBe(1); expect(writes).toBe(0)
    }
  })

  it('drops a malicious Retry-After header before every observable sink', async () => {
    const sentinel = 'RAPIDAPI_SECRET_SENTINEL'; const adapter = new Twitter241Adapter({ transport: { request: async () => response({ status: 429, headers: { 'retry-after': `3${sentinel}` } }) }, dns: dns(), secret: { rapidApiKey: () => 'review-secret' } })
    let failure: unknown
    try { await adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore, quarantine }) } catch (error) { failure = error }
    expect(failure).toMatchObject({ code: 'rate_limited', retry_after: undefined })
    expect(countSecretSentinel({ error: failure, checkpoint: {}, audit: [], quarantine: [], queue: [], dlq: [], logs: [], snapshot: {}, export: {}, evidence: {} }, sentinel)).toBe(0)
  })

  it('accepts only Retry-After values that are future and no more than twenty-four hours from captured time', () => {
    const now = Date.parse('2026-08-24T00:00:00.000Z')
    const exact = 'Tue, 25 Aug 2026 00:00:00 GMT'
    expect(sanitizeRetryAfter(exact, now)).toBe(exact)
    expect(parseRetryAfter(exact, now)).toBe(86_400_000)
    for (const invalid of ['Mon, 24 Aug 2026 00:00:00 GMT', 'Tue, 25 Aug 2026 00:00:01 GMT', 'Thu, 01 Jan 2099 00:00:00 GMT', '86401']) {
      expect(sanitizeRetryAfter(invalid, now)).toBeUndefined()
      expect(parseRetryAfter(invalid, now)).toBeUndefined()
    }
  })

  it('rejects every malformed nested page/context shape before DNS or fake transport', async () => {
    let calls = 0; let dnsCalls = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => { calls += 1; return response() } }, dns: { resolve: async () => { dnsCalls += 1; return ['8.8.8.8'] } }, secret: { rapidApiKey: () => 'review-secret' } })
    const validInput = { provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }
    const validContext = { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore, quarantine }
    for (const [input, context] of [
      [{ ...validInput, query: undefined }, validContext],
      [{ ...validInput, query: 'not-an-object' }, validContext],
      [{ ...validInput, query: { type: 'Top', count: 1 } }, validContext],
      [{ ...validInput, provider: 'other' }, validContext],
      [validInput, { ...validContext, correlation_id: '' }],
      [validInput, { ...validContext, captured_at: 'not-a-time' }],
      [validInput, { ...validContext, signal: { aborted: false } }],
      [validInput, { ...validContext, raw_store: { write: rawStore.write } }],
      [validInput, { ...validContext, quarantine: {} }],
    ] as const) await expect(adapter.fetchPage(input as never, context as never)).rejects.toMatchObject({ code: 'invalid_response' })
    expect({ dnsCalls, calls }).toEqual({ dnsCalls: 0, calls: 0 })
  })

  it('never stores or returns provider bytes that echo the injected RapidAPI key', async () => {
    const sentinel = 'RAPIDAPI_SECRET_SENTINEL'; const root = await mkdtemp(join(tmpdir(), 'p1-echo-key-'))
    try {
      const objectStore = new LocalObjectStore({ root_dir: root, signer_secret: 'echo-key' })
      const harmless = new TextEncoder().encode('{}'); const harmlessHash = `sha256:v1:${createHash('sha256').update(harmless).digest('hex')}`
      await objectStore.write({ principal: principals.ingestService, ref: { namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/${harmlessHash.slice(10, 12)}/${harmlessHash.slice(10)}`, content_hash: harmlessHash, version: 'v1', size_bytes: harmless.byteLength, mime_type: 'application/json', rights_state: 'metadata_only', deletion_state: 'active' }, bytes: harmless })
      const store = new LocalRawEvidenceStore({ object_store: objectStore, principal: principals.ingestService, correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0' })
      const adapter = new Twitter241Adapter({ transport: { request: async () => response({ body: bytes({ data: { id: 'tweet-1', url: 'https://x.com/a/status/tweet-1', text: `contains:${sentinel}`, author: { id: 'a', name: 'A', handle: 'a' } } }) }) }, dns: dns(), secret: { rapidApiKey: () => sentinel } })
      let failure: unknown
      try { await adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: store, quarantine }) } catch (error) { failure = error }
      expect(failure).toMatchObject({ code: 'invalid_response', retryable: false })
      expect(await store.pendingRecoveryCandidates()).toEqual([])
      expect(countSecretSentinel({ error: failure, evidence: await store.pendingRecoveryCandidates(), checkpoint: {}, audit: [], quarantine: [], queue: [], dlq: [], logs: [], snapshot: {}, export: {} }, sentinel)).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects JSON-escaped RapidAPI key values and keys before evidence persistence', async () => {
    const secret = 'RAPIDAPI_SECRET_SENTINEL'; const escaped = [...secret].map((character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`).join('')
    const bodies = [
      `{"data":{"id":"tweet-1","url":"https://x.com/a/status/tweet-1","text":"${escaped}","author":{"id":"a","name":"A","handle":"a"}}}`,
      `{"data":{"id":"tweet-1","url":"https://x.com/a/status/tweet-1","text":"safe","author":{"id":"a","name":"A","handle":"a"}},"nested":{"values":["${escaped}"]}}`,
      `{"data":{"id":"tweet-1","url":"https://x.com/a/status/tweet-1","text":"safe","author":{"id":"a","name":"A","handle":"a"}},"nested":{"${escaped}":["safe"]}}`,
    ]
    for (const body of bodies) {
      let writes = 0; const quarantined: unknown[] = []
      const store: RawEvidenceStore = { ...rawStore, write: async (input) => { writes += 1; return rawStore.write(input) } }
      const adapter = new Twitter241Adapter({ transport: { request: async () => response({ body: new TextEncoder().encode(body) }) }, dns: dns(), secret: { rapidApiKey: () => secret } })
      await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: store, quarantine: { record: async (input) => { quarantined.push(input) } } })).rejects.toMatchObject({ code: 'invalid_response', retryable: false })
      expect({ writes, quarantined }).toEqual({ writes: 0, quarantined: [] })
    }
  })

  it('retains literal non-ASCII key detection at the byte evidence boundary', async () => {
    const secret = '密钥🔒'; let writes = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => response({ body: bytes({ data: { id: 'tweet-1', url: 'https://x.com/a/status/tweet-1', text: secret, author: { id: 'a', name: 'A', handle: 'a' } } }) }) }, dns: dns(), secret: { rapidApiKey: () => secret } })
    const store: RawEvidenceStore = { ...rawStore, write: async (input) => { writes += 1; return rawStore.write(input) } }
    await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: store, quarantine })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(writes).toBe(0)
  })

  it('validates canonical time and callable constructor dependencies before DNS or transport, while preserving pre-abort priority', async () => {
    let calls = 0; let dnsCalls = 0
    const input = { provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 } as const
    const context = { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-02-30T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore, quarantine }
    const badTime = new Twitter241Adapter({ transport: { request: async () => { calls += 1; return response() } }, dns: { resolve: async () => { dnsCalls += 1; return ['8.8.8.8'] } }, secret: { rapidApiKey: () => 'safe' } })
    await expect(badTime.fetchPage(input, context)).rejects.toMatchObject({ code: 'invalid_response' })
    const brokenSecret = new Twitter241Adapter({ transport: { request: async () => { calls += 1; return response() } }, dns: { resolve: async () => { dnsCalls += 1; return ['8.8.8.8'] } }, secret: { rapidApiKey: () => { throw new Error('secret provider internal sentinel') } } })
    await expect(brokenSecret.fetchPage(input, { ...context, captured_at: '2026-08-24T00:00:00.000Z' })).rejects.toMatchObject({ code: 'invalid_response' })
    let malformedConfig: unknown
    try { new Twitter241Adapter({ transport: null as never, dns: null as never, secret: { rapidApiKey: () => '' } } as never) } catch (error) { malformedConfig = error }
    expect(malformedConfig).toMatchObject({ code: 'invalid_response' })
    const controller = new AbortController(); controller.abort()
    await expect(badTime.fetchPage({} as never, { ...context, signal: controller.signal } as never)).rejects.toMatchObject({ code: 'aborted' })
    expect({ calls, dnsCalls }).toEqual({ calls: 0, dnsCalls: 0 })
  })

  it('sanitizes null and throwing adapter constructor configuration without touching I/O', () => {
    const sentinel = 'constructor-secret-sentinel'
    const throwing = ['transport', 'dns', 'secret'].map((property) => Object.defineProperty({}, property, { get: () => { throw new Error(sentinel) } }))
    for (const configuration of [null, ...throwing, { transport: { request: true }, dns: { resolve: true }, secret: { rapidApiKey: true } }]) {
      let failure: unknown
      try { new Twitter241Adapter(configuration as never) } catch (error) { failure = error }
      expect(failure).toMatchObject({ code: 'invalid_response', retryable: false })
      expect(countSecretSentinel({ failure }, sentinel)).toBe(0)
    }
  })

  it.each([
    ['IPv6 only', ['2606:4700:4700::1111'], '2606:4700:4700::1111'],
    ['safe dual stack', ['8.8.8.8', '2606:4700:4700::1111'], '2606:4700:4700::1111'],
  ])('permits %s DNS answers and the same public IPv6 connect peer', async (_name, answers, peer) => {
    const seen: readonly string[][] = []; const adapter = new Twitter241Adapter({ transport: { request: async (_request, connection) => { (seen as string[][]).push([...connection.allowed_peers]); return response({ peer_address: peer }) } }, dns: dns(answers), secret: { rapidApiKey: () => 'safe' } })
    await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore, quarantine })).resolves.toMatchObject({ records: [{ provider_record_id: 'tweet-1' }] })
    expect(seen).toEqual([answers])
  })

  it('sanitizes throwing context and response getters without materializing raw evidence', async () => {
    let dnsCalls = 0; let transportCalls = 0; let writes = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => { transportCalls += 1; return Object.defineProperty({}, 'peer_address', { get: () => { throw new Error('response-secret') } }) as never } }, dns: { resolve: async () => { dnsCalls += 1; return ['8.8.8.8'] } }, secret: { rapidApiKey: () => 'safe' } })
    const input = { provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 } as const
    const throwingContext = Object.defineProperty({ correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', raw_store: rawStore, quarantine }, 'signal', { get: () => { throw new Error('context-secret') } })
    await expect(adapter.fetchPage(input, throwingContext as never)).rejects.toMatchObject({ code: 'invalid_response' })
    expect({ dnsCalls, transportCalls }).toEqual({ dnsCalls: 0, transportCalls: 0 })
    const store: RawEvidenceStore = { ...rawStore, write: async (value) => { writes += 1; return rawStore.write(value) } }
    await expect(adapter.fetchPage(input, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: store, quarantine })).rejects.toMatchObject({ code: 'invalid_response' })
    expect({ dnsCalls, transportCalls, writes }).toEqual({ dnsCalls: 2, transportCalls: 1, writes: 0 })
  })

  it('durably writes raw response bytes before rejecting an invalid page schema', async () => {
    const order: string[] = []
    const adapter = new Twitter241Adapter({ transport: { request: async () => response({ body: new TextEncoder().encode('{"data":{"unknown":true}}') }) }, dns: dns(), secret: { rapidApiKey: () => 'review-secret' } })
    const store: RawEvidenceStore = { write: async (value) => { order.push(new TextDecoder().decode(value.bytes)); return rawStore.write(value) }, pendingRecoveryCandidates: async () => [], markDisposition: async () => undefined }
    await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: store, quarantine })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(order).toEqual(['{"data":{"unknown":true}}'])
    expect(quarantineRecords).toEqual([])
  })

  it('does not persist raw bytes when the signal aborts after transport response', async () => {
    const controller = new AbortController(); let writes = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => { controller.abort(); return response() } }, dns: dns(), secret: { rapidApiKey: () => 'review-secret' } })
    const store: RawEvidenceStore = { write: async () => { writes += 1; return rawStore.write({ bytes: new Uint8Array(), content_hash: `sha256:v1:${'a'.repeat(64)}` }) }, pendingRecoveryCandidates: async () => [], markDisposition: async () => undefined }
    await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: controller.signal, raw_store: store, quarantine })).rejects.toMatchObject({ code: 'aborted' })
    expect(writes).toBe(0)
  })

  it('does not project a malicious transport secret into any observable local sink', async () => {
    const sentinel = 'rapidapi-secret-sentinel-unique'; const prefix = 'x-rapidapi-key'
    const adapter = new Twitter241Adapter({ transport: { request: async () => { throw new Error(`${prefix}:${sentinel}`) } }, dns: dns(), secret: { rapidApiKey: () => sentinel } })
    let failure: unknown
    try { await adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore, quarantine }) } catch (error) { failure = error }
    expect(failure).toMatchObject({ code: 'transient_upstream' })
    const sinks = { sanitized_error: failure, dns_trace: { answers: ['8.8.8.8'] }, redirect_trace: [], checkpoint: {}, database: { sources: [], audits: [] }, queue: [], dlq: [], logs: [], stdout: '', stderr: '', snapshot: { pointer: 'B0' }, export: {}, evidence: { network_calls: 1 } }
    expect(countSecretSentinel(sinks, sentinel)).toBe(0)
    expect(countSecretSentinel(sinks, prefix)).toBe(0)
  })

  it('rejects an unsafe endpoint before fake transport invocation with network_calls zero', async () => {
    let network_calls = 0
    const adapter = new Twitter241Adapter({ transport: { request: async () => { network_calls += 1; return response() } }, dns: dns(['127.0.0.1']), secret: { rapidApiKey: () => 'not-observed' } })
    await expect(adapter.fetchPage({ provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: 'x', type: 'Top', count: 1 }, cursor: null, limit: 1 }, { correlation_id: '01J0J0J0J0J0J0J0J0J0J0J0J0', captured_at: '2026-08-24T00:00:00.000Z', signal: new AbortController().signal, raw_store: rawStore, quarantine })).rejects.toMatchObject({ code: 'unsafe_endpoint' })
    expect(network_calls).toBe(0)
  })
})
