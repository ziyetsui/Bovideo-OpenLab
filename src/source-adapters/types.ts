import type { ObjectIngressReceipt, PendingRawIngressReceipt } from '@/storage/local-object-store'
import type { ObjectRef } from '@/storage/object-ref'
import type { StructuredLogSink } from '@/observability/events'

/** All acquisition I/O is supplied by the caller; P1 deliberately has no network default. */
export type HttpRequest = Readonly<{ url: string; method: 'GET'; headers: Readonly<Record<string, string>> }>
/** `peer_address` is mandatory: transports must expose the peer they pinned after connect. */
export type HttpResponse = Readonly<{ status: number; headers: Readonly<Record<string, string | undefined>>; body: Uint8Array; peer_address: string }>
/** Transport implementations must pin the TCP/TLS peer to `allowed_peers` before connecting. */
export type HttpTransport = Readonly<{ request: (request: HttpRequest, connection: Readonly<{ allowed_peers: readonly string[]; signal: AbortSignal }>) => Promise<HttpResponse> }>
export type DnsResolver = Readonly<{ resolve: (hostname: string) => Promise<readonly string[]> }>
export type SecretProvider = Readonly<{ rapidApiKey: () => string }>
export type AdapterClock = Readonly<{ now: () => string; sleep: (milliseconds: number) => Promise<void> }>

export type RawEvidenceStore = Readonly<{
  write: (input: Readonly<{ bytes: Uint8Array; content_hash: string }>) => Promise<Readonly<{ ref: ObjectRef; receipt: ObjectIngressReceipt; actor_id: string }>>
  pendingRecoveryCandidates: () => Promise<readonly PendingRawIngressReceipt[]>
  markDisposition: (input: Readonly<{ receipt_id: string; disposition: 'committed' | 'quarantined' }>) => Promise<void>
}>

export type NormalizedSourceRecord = Readonly<{
  provider: 'twitter241'
  provider_record_id: string
  canonical_url: string
  captured_at: string
  title: null
  text: string
  author_id: string
  author_handle: string
  rights_state: 'metadata_only'
  rights_basis: null
}>

export type AcquisitionRequest = Readonly<{
  endpoint: string
  checkpoint_identity: string
  expected_checkpoint_revision: number
  correlation_id: string
  query: string
  type?: 'Latest' | 'Top'
  count?: number
  cursor?: string
  partial?: boolean
}>

export type AcquisitionResult = Readonly<{
  status: 'created' | 'duplicate'
  source_id: string
  raw_ref: ObjectRef
  raw_hash: string
  checkpoint_revision: number
  partial: boolean
}>

export type SourceAdapterPageInput = Readonly<{ provider: 'twitter241'; adapter_version: string; schema_version: number; normalization_version: number; query: Readonly<{ query: string; type: 'Latest' | 'Top'; count: number }>; cursor: string | null; limit: number }>
/** Every page fetch is evidence-first: durable raw storage and parse-failure quarantine are mandatory. */
/** Compatibility observer shape; terminal publication is receipt-bound in the write plane, not this callback. */
export type SourceAdapterContext = Readonly<{ correlation_id: string; causation_id?: string | null; captured_at: string; signal: AbortSignal; raw_store: RawEvidenceStore; quarantine: Readonly<{ record: (input: Readonly<{ raw_ref: ObjectRef; raw_hash: string; reason: 'provider_schema' }>) => void | Promise<void> }>; observability?: StructuredLogSink }>
export type SourceAdapterPage = Readonly<{ raw_ref: ObjectRef; raw_receipt_id: string; raw_receipt_actor_id: string; records: readonly (NormalizedSourceRecord & Readonly<{ raw_bytes: Uint8Array; raw_hash: string }>)[]; next_cursor: string | null; partial: boolean; rate_limit: string | null; provider_request_id: string | null }>
export interface SourceAdapter { fetchPage(input: SourceAdapterPageInput, context: SourceAdapterContext): Promise<SourceAdapterPage> }
