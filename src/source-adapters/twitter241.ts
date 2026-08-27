import { createHash } from 'node:crypto'

import { z } from 'zod'

import type { ObjectPrincipal } from '@/storage/policy'
import { buildContentAddressedKey, objectRefSchema, type ObjectRef } from '@/storage/object-ref'
import { LocalObjectStore } from '@/storage/local-object-store'
import { sanitizeRetryAfter } from '@/queues/retry'
import { observationContext } from '@/observability/context'
import { recordStructuredEvent } from '@/observability/events'

import { EndpointPolicyError, ProviderSchemaError, SourceAdapterError } from './errors'
import type { RawReceiptAuthority } from './checkpoint'
import { assertTwitter241ConnectPeer, resolvePinnedTwitter241Endpoint } from './endpoint-policy'
import type { DnsResolver, HttpResponse, HttpTransport, NormalizedSourceRecord, RawEvidenceStore, SecretProvider, SourceAdapter, SourceAdapterContext, SourceAdapterPage, SourceAdapterPageInput } from './types'

const MAX_REDIRECTS = 3
const ABSOLUTE_MAX_RESPONSE_BYTES = 25 * 1024 * 1024
const ownBytes = (value: Uint8Array): Uint8Array => {
  const copy = new Uint8Array(value.byteLength); copy.set(value); return copy
}
const OBJECT_REF_FIELDS = ['bucket_class', 'namespace', 'key', 'version', 'content_hash', 'size_bytes', 'mime_type', 'rights_state', 'deletion_state'] as const
const ownedObjectRef = (value: unknown): ObjectRef => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) throw new SourceAdapterError('invalid_response')
  let parsed: ReturnType<typeof objectRefSchema.safeParse>
  try { parsed = objectRefSchema.safeParse(Object.fromEntries(OBJECT_REF_FIELDS.map((field) => [field, Reflect.get(value, field)]))) } catch { throw new SourceAdapterError('invalid_response') }
  if (!parsed.success) throw new SourceAdapterError('invalid_response')
  return Object.freeze({ ...parsed.data })
}
const providerRecordSchema = z.object({
    id: z.string().min(1).max(256),
    url: z.url(),
    text: z.string().min(1).max(100_000),
    author: z.object({ id: z.string().min(1).max(256), name: z.string().min(1).max(512), handle: z.string().min(1).max(256) }).strict(),
}).strict()
const providerResponseSchema = z.object({ data: providerRecordSchema }).strict()
const providerPageSchema = z.object({
  data: z.object({ records: z.array(providerRecordSchema).max(100), next_cursor: z.string().min(1).max(2048).nullable(), partial: z.boolean().default(false), rate_limit: z.string().max(256).nullable().default(null), provider_request_id: z.string().max(256).nullable().default(null) }).strict(),
}).strict()

const header = (headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]

const UTC_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const CORRELATION_ID = /^[A-Za-z0-9:_-]{1,256}$/

/** Runtime boundary for JavaScript callers. It intentionally verifies every dependency before I/O. */
const validFetchArguments = (input: unknown, context: unknown): input is SourceAdapterPageInput => {
  try {
    if (typeof input !== 'object' || input === null || typeof context !== 'object' || context === null) return false
    const page = input as Partial<SourceAdapterPageInput>
    const dependencies = context as Partial<SourceAdapterContext>
    const query = page.query
    const signal = dependencies.signal as Partial<AbortSignal> | undefined
    const rawStore = dependencies.raw_store
    const capturedAt = dependencies.captured_at
    return page.provider === 'twitter241' && page.adapter_version === 'twitter241-v1' && page.schema_version === 1 && page.normalization_version === 1 &&
      typeof query === 'object' && query !== null && typeof query.query === 'string' && query.query.trim().length > 0 && query.query.length <= 512 &&
      (query.type === 'Latest' || query.type === 'Top') && Number.isInteger(query.count) && query.count >= 1 && query.count <= 100 &&
      (page.cursor === null || (typeof page.cursor === 'string' && page.cursor.length > 0 && page.cursor.length <= 2048)) &&
      typeof page.limit === 'number' && Number.isInteger(page.limit) && page.limit >= 1 && page.limit <= 100 && page.limit === query.count &&
      typeof dependencies.correlation_id === 'string' && CORRELATION_ID.test(dependencies.correlation_id) &&
      typeof capturedAt === 'string' && UTC_RFC3339.test(capturedAt) && Number.isFinite(Date.parse(capturedAt)) && new Date(Date.parse(capturedAt)).toISOString() === capturedAt &&
      typeof signal?.aborted === 'boolean' && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function' &&
      typeof rawStore?.write === 'function' && typeof rawStore.markDisposition === 'function' && typeof rawStore.pendingRecoveryCandidates === 'function' &&
      typeof dependencies.quarantine?.record === 'function'
  } catch { return false }
}

const validAdapterDependencies = (value: unknown): value is Readonly<{ transport: HttpTransport; dns: DnsResolver; secret: SecretProvider }> => {
  try {
    if (typeof value !== 'object' || value === null) return false
    const dependencies = value as Readonly<{ transport?: unknown; dns?: unknown; secret?: unknown }>
    return typeof (dependencies.transport as Partial<HttpTransport> | undefined)?.request === 'function' &&
      typeof (dependencies.dns as Partial<DnsResolver> | undefined)?.resolve === 'function' &&
      typeof (dependencies.secret as Partial<SecretProvider> | undefined)?.rapidApiKey === 'function'
  } catch { return false }
}

const includesBytes = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false
  for (let start = 0; start <= haystack.byteLength - needle.byteLength; start += 1) {
    let equal = true
    for (let offset = 0; offset < needle.byteLength; offset += 1) if (haystack[start + offset] !== needle[offset]) { equal = false; break }
    if (equal) return true
  }
  return false
}

const SECRET_SCAN_MAX_DEPTH = 64
const SECRET_SCAN_MAX_NODES = 10_000
/** Scans JSON-decoded keys and values so escaped key material cannot bypass the raw byte check. */
const jsonContainsSecret = (raw: Uint8Array, secret: string): boolean | 'invalid' => {
  let decoded: string; try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw) } catch { return false }
  let value: unknown; try { value = JSON.parse(decoded) } catch { return false }
  let nodes = 0
  const visit = (current: unknown, depth: number): boolean | 'invalid' => {
    if (++nodes > SECRET_SCAN_MAX_NODES || depth > SECRET_SCAN_MAX_DEPTH) return 'invalid'
    if (typeof current === 'string') return current.includes(secret)
    if (Array.isArray(current)) { for (const item of current) { const found = visit(item, depth + 1); if (found !== false) return found } return false }
    if (typeof current === 'object' && current !== null) {
      for (const [key, item] of Object.entries(current)) {
        if (key.includes(secret)) return true
        const found = visit(item, depth + 1); if (found !== false) return found
      }
    }
    return false
  }
  return visit(value, 0)
}

/** Fake-transport-only Twitter241 boundary. It does not construct or import a network client. */
export class Twitter241Adapter implements SourceAdapter {
  readonly #transport: HttpTransport
  readonly #dns: DnsResolver
  readonly #secret: SecretProvider
  readonly #maxResponseBytes: number

  constructor(input: Readonly<{ transport: HttpTransport; dns: DnsResolver; secret: SecretProvider; max_response_bytes?: number }>) {
    try {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('adapter configuration is invalid')
      const config = input as Readonly<{ transport?: unknown; dns?: unknown; secret?: unknown; max_response_bytes?: unknown }>
      const configuredCap = config.max_response_bytes
      if (!validAdapterDependencies(config)) throw new Error('adapter dependencies are invalid')
      const cap = configuredCap ?? ABSOLUTE_MAX_RESPONSE_BYTES
      if (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap < 1 || cap > ABSOLUTE_MAX_RESPONSE_BYTES) throw new Error('adapter response cap is invalid')
      this.#transport = config.transport
      this.#dns = config.dns
      this.#secret = config.secret
      this.#maxResponseBytes = cap
    } catch { throw new SourceAdapterError('invalid_response') }
  }

  async fetchPage(input: SourceAdapterPageInput, context: SourceAdapterContext): Promise<SourceAdapterPage> {
    // The static contract protects TypeScript callers. This guard preserves the same fail-closed
    // evidence boundary for JavaScript/any callers before DNS or fake transport side effects.
    let signal: Partial<AbortSignal> | undefined
    try { signal = typeof context === 'object' && context !== null ? (context as Partial<SourceAdapterContext>).signal : undefined } catch { throw new SourceAdapterError('invalid_response') }
    if (typeof signal?.aborted === 'boolean' && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function' && signal.aborted) throw new SourceAdapterError('aborted')
    if (!validFetchArguments(input, context) || !validAdapterDependencies({ transport: this.#transport, dns: this.#dns, secret: this.#secret })) throw new SourceAdapterError('invalid_response')
    const url = new URL('https://twitter241.p.rapidapi.com/search-v2')
    url.searchParams.set('query', input.query.query); url.searchParams.set('type', input.query.type); url.searchParams.set('count', String(input.limit))
    if (input.cursor !== null) url.searchParams.set('cursor', input.cursor)
    let apiKey: string
    try { apiKey = this.#secret.rapidApiKey() } catch { throw new SourceAdapterError('invalid_response') }
    if (typeof apiKey !== 'string' || apiKey.length === 0) throw new SourceAdapterError('invalid_response')
    const authorityRaw = await this.#fetchRaw(url.toString(), context.signal, apiKey, Date.parse(context.captured_at))
    if (authorityRaw.byteLength > this.#maxResponseBytes) throw new SourceAdapterError('invalid_response')
    const keyBytes = new TextEncoder().encode(apiKey)
    const secretScanRaw = ownBytes(authorityRaw)
    const jsonSecret = jsonContainsSecret(secretScanRaw, apiKey)
    if (includesBytes(secretScanRaw, keyBytes) || jsonSecret === true || jsonSecret === 'invalid') throw new SourceAdapterError('invalid_response')
    const rawHash = `sha256:v1:${createHash('sha256').update(authorityRaw).digest('hex')}`
    let persisted: Awaited<ReturnType<RawEvidenceStore['write']>>
    try { persisted = await context.raw_store.write({ bytes: ownBytes(authorityRaw), content_hash: rawHash }) } catch { throw new SourceAdapterError('invalid_response') }
    const persistedRef = ownedObjectRef(persisted.ref)
    if (persistedRef.content_hash !== rawHash || persistedRef.size_bytes !== authorityRaw.byteLength) throw new SourceAdapterError('invalid_response')
    recordStructuredEvent(context.observability, {
      event_name: 'source_adapter.page_persisted',
      context: observationContext({ correlation_id: context.correlation_id, causation_id: context.causation_id ?? null }),
      refs: { raw_hash: rawHash, receipt_id: persisted.receipt.receipt_id, provider: input.provider },
      metadata: { bytes: authorityRaw.byteLength, record_limit: input.limit },
    })
    let page: Readonly<{ records: readonly NormalizedSourceRecord[]; next_cursor: string | null; partial: boolean; rate_limit: string | null; provider_request_id: string | null }>
    try { page = this.#parsePage(ownBytes(authorityRaw), context.captured_at) } catch {
      // The adapter only establishes immutable evidence. The orchestrator alone owns terminal
      // checkpoints and passes this receipt-bound proof to one atomic write-plane command.
      throw new SourceAdapterError('invalid_response', undefined, 1, true, false, Object.freeze({ raw_ref: persistedRef, raw_hash: rawHash, raw_receipt_id: persisted.receipt.receipt_id, raw_receipt_actor_id: persisted.actor_id }))
    }
    return Object.freeze({ raw_ref: persistedRef, raw_receipt_id: persisted.receipt.receipt_id, raw_receipt_actor_id: persisted.actor_id, records: Object.freeze(page.records.map((record: NormalizedSourceRecord) => Object.freeze({ ...record, raw_bytes: ownBytes(authorityRaw), raw_hash: rawHash }))), next_cursor: page.next_cursor, partial: page.partial, rate_limit: page.rate_limit, provider_request_id: page.provider_request_id })
  }

  async #fetchRaw(endpoint: string, signal: AbortSignal, apiKey: string, capturedAt: number): Promise<Uint8Array> {
    let current = endpoint
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (signal.aborted) throw new SourceAdapterError('aborted')
      let resolved: Awaited<ReturnType<typeof resolvePinnedTwitter241Endpoint>>
      try { resolved = await resolvePinnedTwitter241Endpoint(current, this.#dns) } catch (error) { if (error instanceof EndpointPolicyError) throw new SourceAdapterError('unsafe_endpoint'); throw new SourceAdapterError('transient_upstream') }
      let response: HttpResponse
      try { response = await this.#transport.request({ url: resolved.url.toString(), method: 'GET', headers: Object.freeze({ 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'twitter241.p.rapidapi.com' }) }, { allowed_peers: resolved.allowed_peers, signal }) } catch { if (signal.aborted) throw new SourceAdapterError('aborted'); throw new SourceAdapterError('transient_upstream') }
      let safeResponse: HttpResponse
      try {
        if (typeof response !== 'object' || response === null) throw new Error('response shape')
        const status = response.status; const peer_address = response.peer_address; const body = response.body; const headers = response.headers
        if (!Number.isInteger(status) || typeof peer_address !== 'string' || typeof headers !== 'object' || headers === null || !(body instanceof Uint8Array)) throw new Error('response shape')
        const safeHeaders = Object.freeze(Object.fromEntries(Object.entries(headers).map(([key, value]) => {
          if (typeof key !== 'string' || (value !== undefined && typeof value !== 'string')) throw new Error('response headers')
          return [key, value]
        })))
        if (body.byteLength > ABSOLUTE_MAX_RESPONSE_BYTES) throw new Error('response body exceeds absolute cap')
        const authorityBody = ownBytes(body)
        safeResponse = Object.freeze({ status, peer_address, body: authorityBody, headers: safeHeaders })
      } catch { throw new SourceAdapterError('invalid_response') }
      // The transport contract reports its pinned peer; re-resolution makes a rebind fail before any response is trusted.
      try {
        if (!resolved.allowed_peers.includes(safeResponse.peer_address)) throw new EndpointPolicyError('connect peer was not prevalidated')
        await assertTwitter241ConnectPeer(resolved.url.hostname, safeResponse.peer_address, this.#dns)
      } catch { throw new SourceAdapterError('unsafe_endpoint') }
      if (signal.aborted) throw new SourceAdapterError('aborted')
      if (safeResponse.status >= 300 && safeResponse.status < 400) {
        const location = header(safeResponse.headers, 'location')
        if (!location || hop === MAX_REDIRECTS) throw new SourceAdapterError('unsafe_endpoint')
        try { current = new URL(location, resolved.url).toString() } catch { throw new SourceAdapterError('unsafe_endpoint') }
        continue
      }
      this.#throwForStatus(safeResponse, capturedAt)
      return safeResponse.body
    }
    throw new SourceAdapterError('unsafe_endpoint')
  }

  #parsePage(raw: Uint8Array, capturedAt: string): Readonly<{ records: readonly NormalizedSourceRecord[]; next_cursor: string | null; partial: boolean; rate_limit: string | null; provider_request_id: string | null }> {
    if (raw.byteLength > this.#maxResponseBytes) throw new SourceAdapterError('invalid_response')
    let decoded: string; try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw) } catch { throw new SourceAdapterError('invalid_response') }
    let json: unknown; try { json = JSON.parse(decoded) } catch { throw new SourceAdapterError('invalid_response') }
    const page = providerPageSchema.safeParse(json)
    if (page.success) return { records: page.data.data.records.map((record) => this.#normalize(record, capturedAt)), next_cursor: page.data.data.next_cursor, partial: page.data.data.partial, rate_limit: page.data.data.rate_limit, provider_request_id: page.data.data.provider_request_id }
    const single = providerResponseSchema.safeParse(json)
    if (single.success) return { records: [this.#normalize(single.data.data, capturedAt)], next_cursor: null, partial: false, rate_limit: null, provider_request_id: null }
    throw new SourceAdapterError('invalid_response')
  }

  #normalize(record: z.infer<typeof providerRecordSchema>, capturedAt: string): NormalizedSourceRecord {
    return Object.freeze({ provider: 'twitter241', provider_record_id: record.id, canonical_url: record.url, captured_at: capturedAt, title: null, text: record.text, author_id: record.author.id, author_handle: record.author.handle, rights_state: 'metadata_only', rights_basis: null })
  }

  #throwForStatus(response: HttpResponse, capturedAt: number): void {
    if (response.status === 401 || response.status === 403) throw new SourceAdapterError('auth')
    if (response.status === 402) throw new SourceAdapterError('entitlement')
    if (response.status === 429) throw new SourceAdapterError('rate_limited', sanitizeRetryAfter(header(response.headers, 'retry-after'), capturedAt))
    if (response.status >= 500 && response.status <= 599) throw new SourceAdapterError('transient_upstream')
    if (response.status < 200 || response.status >= 300) throw new SourceAdapterError('entitlement')
  }
}

/** Source-local idempotency identity; it is deliberately not a QueueEnvelope key. */
export const buildTwitter241SourceIdempotencyKey = (tweetId: string, contentHash: string): string => {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(tweetId) || !/^sha256:v1:[a-f0-9]{64}$/.test(contentHash)) throw new ProviderSchemaError('source idempotency input is invalid')
  return `twitter241:${tweetId}:${contentHash}`
}

/** T04-backed private raw writer; its only returned value is the typed private ObjectRef. */
export class LocalRawEvidenceStore implements RawEvidenceStore {
  readonly #store: LocalObjectStore
  readonly #principal: ObjectPrincipal
  readonly #correlationId: string
  constructor(input: Readonly<{ object_store: LocalObjectStore; principal: ObjectPrincipal; correlation_id: string }>) {
    this.#store = input.object_store; this.#principal = input.principal; this.#correlationId = input.correlation_id
  }
  async write(input: Readonly<{ bytes: Uint8Array; content_hash: string }>): Promise<Readonly<{ ref: ObjectRef; receipt: import('@/storage/local-object-store').ObjectIngressReceipt; actor_id: string }>> {
    const actual = `sha256:v1:${createHash('sha256').update(input.bytes).digest('hex')}`
    if (actual !== input.content_hash) throw new ProviderSchemaError('raw content hash mismatch')
    const ref: ObjectRef = Object.freeze({ namespace: 'raw-evidence', bucket_class: 'private_raw', key: buildContentAddressedKey('raw-evidence', actual), content_hash: actual, version: 'v1', size_bytes: input.bytes.byteLength, mime_type: 'application/json', rights_state: 'metadata_only', deletion_state: 'active' })
    const receipt = await this.#store.putForIngress({ principal: this.#principal, ref, bytes: input.bytes, field: 'raw_ref', actor_id: this.#principal.id, correlation_id: this.#correlationId })
    return Object.freeze({ ref, receipt, actor_id: this.#principal.id })
  }
  async pendingRecoveryCandidates(): Promise<readonly import('@/storage/local-object-store').PendingRawIngressReceipt[]> {
    return this.#store.listPendingRawIngressReceipts({ principal: this.#principal })
  }
  async markDisposition(input: Readonly<{ receipt_id: string; disposition: 'committed' | 'quarantined' }>): Promise<void> {
    await this.#store.markRawIngressReceiptDisposition({ principal: this.#principal, receipt_id: input.receipt_id, disposition: input.disposition })
  }
  /** Resolver handed to the write plane; it binds the T04 receipt to actor, correlation and exact private ref. */
  receiptAuthority(): RawReceiptAuthority {
    return Object.freeze({ resolve: async (input) => {
      if (input.actor_id !== this.#principal.id || input.correlation_id !== this.#correlationId) return null
      let supplied: ReturnType<typeof objectRefSchema.safeParse>
      try { supplied = objectRefSchema.safeParse(input.raw_ref) } catch { return null }
      if (!supplied.success) return null
      const resolved = await this.#store.resolveIngressReceipt({ receipt_id: input.receipt_id, field: 'raw_ref', actor_id: input.actor_id, correlation_id: input.correlation_id })
      return resolved !== null && resolved.namespace === supplied.data.namespace && resolved.bucket_class === supplied.data.bucket_class && resolved.key === supplied.data.key && resolved.version === supplied.data.version && resolved.content_hash === supplied.data.content_hash && resolved.size_bytes === supplied.data.size_bytes && resolved.mime_type === supplied.data.mime_type && resolved.rights_state === supplied.data.rights_state && resolved.deletion_state === supplied.data.deletion_state ? resolved : null
    } })
  }
}
