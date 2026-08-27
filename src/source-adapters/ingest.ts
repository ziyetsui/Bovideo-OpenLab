import { createHash } from 'node:crypto'

import { parseRetryAfter } from '@/queues/retry'

import type { CheckpointRepository, RawReceiptAuthority, SourcePageCommitResult, SourceWritePlane } from './checkpoint'
import type { CheckpointNext, CheckpointRequestLedgerEntry, CheckpointStopReason } from './checkpoint'
import { CheckpointConflictError, SourceAdapterError } from './errors'
import type { AdapterClock, RawEvidenceStore, SourceAdapter, SourceAdapterPage, SourceAdapterPageInput } from './types'

const providerRetryDelay = (attempt: number, retryAfter: string | undefined, now: number): number => {
  const retryAfterMilliseconds = parseRetryAfter(retryAfter, now)
  return retryAfterMilliseconds !== undefined ? retryAfterMilliseconds : 2_000 * 2 ** attempt
}

const checkpointNext = (input: Readonly<{ query_identity: string; query_hash: string; cursor: string | null; seen_cursors?: readonly string[]; seen_provider_record_ids?: readonly string[]; request_ledger?: readonly CheckpointRequestLedgerEntry[]; last_source_revision?: string | null; consecutive_no_new_pages?: number; run_status: 'running' | 'complete' | 'partial'; unit_status: 'open' | 'natural_end' | 'no_new_ids' | 'failed' | 'partial'; stop_reason: CheckpointStopReason | null; attempt: number }>): CheckpointNext => Object.freeze({
  query_identity: input.query_identity, adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: input.query_hash,
  cursor: input.cursor, seen_cursors: Object.freeze([...(input.seen_cursors ?? [])]), seen_provider_record_ids: Object.freeze([...(input.seen_provider_record_ids ?? [])]), request_ledger: Object.freeze([...(input.request_ledger ?? [])]), last_source_revision: input.last_source_revision ?? null, consecutive_no_new_pages: input.consecutive_no_new_pages ?? 0, run_status: input.run_status, unit_status: input.unit_status, stop_reason: input.stop_reason, attempt: input.attempt,
})
const checkpointCommittedAs = (checkpoint: ReturnType<CheckpointRepository['read']>, expectedRevision: number, next: CheckpointNext): checkpoint is NonNullable<ReturnType<CheckpointRepository['read']>> => checkpoint !== undefined && checkpoint.revision === expectedRevision + 1 && checkpoint.query_identity === next.query_identity && checkpoint.query_hash === next.query_hash && checkpoint.cursor === next.cursor && checkpoint.last_source_revision === next.last_source_revision && checkpoint.consecutive_no_new_pages === next.consecutive_no_new_pages && checkpoint.run_status === next.run_status && checkpoint.unit_status === next.unit_status && checkpoint.stop_reason === next.stop_reason && checkpoint.attempt === next.attempt && JSON.stringify(checkpoint.seen_cursors) === JSON.stringify(next.seen_cursors) && JSON.stringify(checkpoint.seen_provider_record_ids) === JSON.stringify(next.seen_provider_record_ids) && JSON.stringify(checkpoint.request_ledger) === JSON.stringify(next.request_ledger)
const pageSideEffectsCommitted = (input: Readonly<{ write_plane: SourceWritePlane; normalized: SourceAdapterPage['records']; raw_hash: string; raw_key: string; correlation_id: string; checkpoint_revision: number }>): boolean => input.normalized.every((record) => {
  const source = input.write_plane.sources().find((candidate) => candidate.provider === record.provider && candidate.provider_record_id === record.provider_record_id && candidate.content_hash === input.raw_hash && candidate.raw_ref.key === input.raw_key)
  if (source === undefined) return false
  const needed = input.normalized.filter((candidate) => candidate.provider === record.provider && candidate.provider_record_id === record.provider_record_id).length
  const actual = input.write_plane.audits().filter((event) => event.action === 'source.ingest.commit' && event.entity.type === 'source' && event.entity.id === source.id && event.correlation_id === input.correlation_id && event.after?.content_hash === input.raw_hash && event.after?.checkpoint_revision === String(input.checkpoint_revision)).length
  return actual >= needed
})

const hash = (value: string): string => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`
const toCheckpointLedger = (ledger: readonly AcquisitionRequestLedgerEntry[]): readonly CheckpointRequestLedgerEntry[] => ledger.map((entry) => Object.freeze({ query_identity: `${entry.query_id}:${entry.type}`, input_cursor: entry.input_cursor, output_cursor: entry.output_cursor, raw_hash: entry.raw_hash!, record_count: entry.record_count, requested_at: entry.requested_at, received_at: entry.received_at, stop_reason: entry.stop_reason }))

/** Never return a foreign error object: adapters may have logged or embedded a credential in it. */
const sanitizedProviderError = (error: unknown): SourceAdapterError => {
  if (error instanceof SourceAdapterError) return new SourceAdapterError(error.code, error.retry_after, error.attempts, error.raw_persisted, error.quarantine_audited, error.quarantine_evidence)
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined
  if (code === 'auth' || code === 'entitlement' || code === 'rate_limited' || code === 'transient_upstream' || code === 'invalid_response' || code === 'unsafe_endpoint' || code === 'aborted')
    return new SourceAdapterError(code)
  return new SourceAdapterError('transient_upstream')
}

export const TWITTER241_QUERY_IDS = ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09', 'Q10'] as const
export type Twitter241PaginationUnit = Readonly<{ query_id: typeof TWITTER241_QUERY_IDS[number]; type: 'Latest' | 'Top' }>
export type PaginationRunStatus = 'running' | 'complete' | 'partial'
type PaginationUnitState = 'open' | 'natural_end' | 'no_new_ids' | 'partial'

/** Explicit 10-query × two-sort local tracker; it never infers removals from an incomplete run. */
export class Twitter241PaginationTracker {
  readonly #pages = new Map<string, Readonly<{ cursors: Set<string>; consecutive_empty: number; state: PaginationUnitState }>>()
  static requiredUnits(): readonly Twitter241PaginationUnit[] {
    return TWITTER241_QUERY_IDS.flatMap((query_id) => [{ query_id, type: 'Latest' as const }, { query_id, type: 'Top' as const }])
  }
  record(input: Readonly<{ unit: Twitter241PaginationUnit; cursor: string | null; next_cursor: string | null; new_provider_record_ids: readonly string[]; natural_end: boolean }>): PaginationRunStatus {
    const key = `${input.unit.query_id}:${input.unit.type}`
    const prior = this.#pages.get(key) ?? { cursors: new Set<string>(), consecutive_empty: 0, state: 'open' as const }
    if (prior.state !== 'open') return this.status()
    const currentCursor = input.cursor ?? '__initial__'
    const repeated = prior.cursors.has(currentCursor) || (input.next_cursor !== null && prior.cursors.has(input.next_cursor))
    const cursors = new Set(prior.cursors); cursors.add(currentCursor)
    const consecutiveEmpty = input.new_provider_record_ids.length === 0 ? prior.consecutive_empty + 1 : 0
    const state: PaginationUnitState = repeated ? 'partial' : consecutiveEmpty >= 2 ? 'no_new_ids' : input.natural_end ? 'natural_end' : 'open'
    this.#pages.set(key, Object.freeze({ cursors, consecutive_empty: consecutiveEmpty, state }))
    return this.status()
  }
  unitStatus(unit: Twitter241PaginationUnit): PaginationUnitState { return this.#pages.get(`${unit.query_id}:${unit.type}`)?.state ?? 'open' }
  status(): PaginationRunStatus {
    const units = Twitter241PaginationTracker.requiredUnits()
    if (units.some((unit) => this.#pages.get(`${unit.query_id}:${unit.type}`)?.state === 'partial')) return 'partial'
    return units.every((unit) => { const state = this.#pages.get(`${unit.query_id}:${unit.type}`)?.state; return state === 'natural_end' || state === 'no_new_ids' }) ? 'complete' : 'running'
  }
  deletionEvents(): readonly never[] { return [] }
}

export type AcquisitionRequestLedgerEntry = Readonly<{ query_id: string; type: 'Latest' | 'Top'; input_cursor: string | null; output_cursor: string | null; raw_hash: string | null; record_count: number; requested_at: string; received_at: string; stop_reason: CheckpointStopReason | null }>
export type AcquisitionRunResult = Readonly<{ run_status: PaginationRunStatus; completed_units: number; partial: boolean; deletion_events: readonly never[]; request_ledger: readonly AcquisitionRequestLedgerEntry[] }>

/**
 * Local-only page acquisition loop. Each durable page/unit transition is a strict CAS checkpoint;
 * resume reads that checkpoint and will not re-fetch a natural-end unit. Accepted pages commit
 * source revisions, audit events and their checkpoint through the injected local write plane.
 */
export class Twitter241AcquisitionOrchestrator {
  readonly #adapter: SourceAdapter
  readonly #checkpoint: CheckpointRepository
  readonly #clock: AdapterClock
  readonly #queryFor: (id: typeof TWITTER241_QUERY_IDS[number]) => string
  readonly #random: () => number
  readonly #rawStore: RawEvidenceStore
  readonly #receiptAuthority: RawReceiptAuthority
  readonly #writePlane: SourceWritePlane
  constructor(input: Readonly<{ adapter: SourceAdapter; checkpoint: CheckpointRepository; clock: AdapterClock; queryFor: (id: typeof TWITTER241_QUERY_IDS[number]) => string; raw_store: RawEvidenceStore; receipt_authority: RawReceiptAuthority; write_plane: SourceWritePlane; random?: () => number }>) {
    this.#adapter = input.adapter; this.#checkpoint = input.checkpoint; this.#clock = input.clock; this.#queryFor = input.queryFor; this.#rawStore = input.raw_store; this.#receiptAuthority = input.receipt_authority; this.#writePlane = input.write_plane; this.#random = input.random ?? (() => 0.5)
  }
  async run(input: Readonly<{ identity: string; expected_revision: number; correlation_id: string; units?: readonly Twitter241PaginationUnit[]; signal?: AbortSignal }>): Promise<AcquisitionRunResult> {
    const required = Twitter241PaginationTracker.requiredUnits()
    if (input.units !== undefined && (input.units.length !== required.length || new Set(input.units.map((unit) => `${unit.query_id}:${unit.type}`)).size !== required.length || input.units.some((unit, index) => unit.query_id !== required[index]?.query_id || unit.type !== required[index]?.type)))
      throw new Error('acquisition run must use the exact twenty-unit matrix')
    const units = required
    let runRevision = input.expected_revision
    let completed = 0
    const run = this.#checkpoint.read(input.identity)
    const globalSeenIds = new Set(run?.seen_provider_record_ids ?? [])
    let runLastSourceRevision = run?.last_source_revision ?? null
    const ledger: AcquisitionRequestLedgerEntry[] = (run?.request_ledger ?? []).map((entry) => {
      const match = /^(Q(?:0[1-9]|10)):(Latest|Top)$/.exec(entry.query_identity)
      if (!match) throw new Error('checkpoint request ledger identity is invalid')
      return Object.freeze({ query_id: match[1]! as typeof TWITTER241_QUERY_IDS[number], type: match[2]! as 'Latest' | 'Top', input_cursor: entry.input_cursor, output_cursor: entry.output_cursor, raw_hash: entry.raw_hash, record_count: entry.record_count, requested_at: entry.requested_at, received_at: entry.received_at, stop_reason: entry.stop_reason })
    })
    if (run !== undefined) {
      if (run.revision !== runRevision) throw new CheckpointConflictError()
      if (run.run_status === 'complete') return Object.freeze({ run_status: 'complete', completed_units: units.length, partial: false, deletion_events: [], request_ledger: ledger })
    }
    for (const unit of units) {
      const query = this.#queryFor(unit.query_id)
      const queryIdentity = `${unit.query_id}:${unit.type}`
      const queryHash = hash(`${queryIdentity}\n${query}`)
      const unitIdentity = `${input.identity}:${queryIdentity}`
      const persisted = this.#checkpoint.read(unitIdentity)
      if (persisted !== undefined && (persisted.query_identity !== queryIdentity || persisted.query_hash !== queryHash)) throw new Error('checkpoint query identity mismatch')
      if (persisted?.unit_status === 'natural_end' || persisted?.unit_status === 'no_new_ids') { completed += 1; continue }
      let unitRevision = persisted?.revision ?? 0
      let cursor: string | null = persisted?.cursor ?? null
      let emptyPages = persisted?.consecutive_no_new_pages ?? 0
      let lastSourceRevision = persisted?.last_source_revision ?? null
      const seenCursors = new Set(persisted?.seen_cursors ?? [])
      while (true) {
        if (cursor !== null && seenCursors.has(cursor)) {
          const pair = await this.#checkpoint.transactPair({ first: { identity: unitIdentity, expected_revision: unitRevision, next: checkpointNext({ query_identity: queryIdentity, query_hash: queryHash, cursor, seen_cursors: [...seenCursors], last_source_revision: lastSourceRevision, consecutive_no_new_pages: emptyPages, run_status: 'partial', unit_status: 'partial', stop_reason: 'repeated_cursor', attempt: 0 }) }, second: { identity: input.identity, expected_revision: runRevision, next: checkpointNext({ query_identity: `run:${input.identity}`, query_hash: hash(`run:${input.identity}`), cursor: null, seen_provider_record_ids: [...globalSeenIds], request_ledger: toCheckpointLedger(ledger), last_source_revision: runLastSourceRevision, run_status: 'partial', unit_status: 'partial', stop_reason: 'repeated_cursor', attempt: 0 }) } }, (unitCheckpoint, aggregateCheckpoint) => Object.freeze({ unitCheckpoint, aggregateCheckpoint }))
          unitRevision = pair.unitCheckpoint.revision; runRevision = pair.aggregateCheckpoint.revision
          return Object.freeze({ run_status: 'partial', completed_units: completed, partial: true, deletion_events: [], request_ledger: ledger })
        }
        if (cursor !== null) seenCursors.add(cursor)
        let page: SourceAdapterPage
        const requestedAt = this.#clock.now()
        try { page = await this.#fetchWithRetry({ query, type: unit.type, cursor, correlation_id: input.correlation_id, signal: input.signal ?? new AbortController().signal }) } catch (error) {
          const failure = sanitizedProviderError(error)
          const unitCheckpoint = { identity: unitIdentity, expected_revision: unitRevision, next: checkpointNext({ query_identity: queryIdentity, query_hash: queryHash, cursor, seen_cursors: [...seenCursors], last_source_revision: lastSourceRevision, consecutive_no_new_pages: emptyPages, run_status: 'partial', unit_status: 'failed', stop_reason: failure.code, attempt: failure.attempts }) }
          const aggregateCheckpoint = { identity: input.identity, expected_revision: runRevision, next: checkpointNext({ query_identity: `run:${input.identity}`, query_hash: hash(`run:${input.identity}`), cursor: null, seen_provider_record_ids: [...globalSeenIds], request_ledger: toCheckpointLedger(ledger), last_source_revision: runLastSourceRevision, run_status: 'partial', unit_status: 'failed', stop_reason: failure.code, attempt: failure.attempts }) }
          if (failure.code === 'invalid_response') {
            const evidence = failure.quarantine_evidence
            // Untrusted adapters may manufacture SourceAdapterError objects, but they cannot
            // advance terminal checkpoints without an authority-validated raw ingress receipt.
            if (evidence === undefined) throw failure
            try {
              await this.#writePlane.commitQuarantinedFailure({ checkpoint: this.#checkpoint, unit_checkpoint: unitCheckpoint, aggregate_checkpoint: aggregateCheckpoint, raw_ref: evidence.raw_ref, raw_hash: evidence.raw_hash, raw_receipt_id: evidence.raw_receipt_id, raw_receipt_actor_id: evidence.raw_receipt_actor_id, raw_receipt_authority: this.#receiptAuthority, correlation_id: input.correlation_id, attempts: failure.attempts })
              await this.#rawStore.markDisposition({ receipt_id: evidence.raw_receipt_id, disposition: 'quarantined' })
            } catch { throw failure }
          } else await this.#writePlane.commitTerminalFailure({ checkpoint: this.#checkpoint, unit_checkpoint: unitCheckpoint, aggregate_checkpoint: aggregateCheckpoint, correlation_id: input.correlation_id, reason: failure.code, attempts: failure.attempts })
          throw failure
        }
        const newIds = page.records.map((record) => record.provider_record_id).filter((id) => !globalSeenIds.has(id))
        page.records.forEach((record) => globalSeenIds.add(record.provider_record_id))
        emptyPages = newIds.length === 0 ? emptyPages + 1 : 0
        const naturalEnd = page.next_cursor === null && !page.partial
        const repeatedNext = page.next_cursor !== null && seenCursors.has(page.next_cursor)
        const unitStatus = emptyPages >= 2 ? 'no_new_ids' : page.partial || repeatedNext ? 'partial' : naturalEnd ? 'natural_end' : 'open'
        const stopReason = emptyPages >= 2 ? 'no_new_ids' : page.partial ? 'provider_partial' : repeatedNext ? 'repeated_cursor' : naturalEnd ? 'natural_end' : null
        ledger.push(Object.freeze({ query_id: unit.query_id, type: unit.type, input_cursor: cursor, output_cursor: page.next_cursor, raw_hash: page.raw_ref.content_hash, record_count: page.records.length, requested_at: requestedAt, received_at: this.#clock.now(), stop_reason: stopReason }))
        if (page.records.length > 0) { lastSourceRevision = page.raw_ref.content_hash; runLastSourceRevision = page.raw_ref.content_hash }
        const unitNext = checkpointNext({ query_identity: queryIdentity, query_hash: queryHash, cursor: page.next_cursor, seen_cursors: [...seenCursors], seen_provider_record_ids: [...globalSeenIds], request_ledger: ledger.map((entry) => ({ query_identity: `${entry.query_id}:${entry.type}`, input_cursor: entry.input_cursor, output_cursor: entry.output_cursor, raw_hash: entry.raw_hash ?? page.raw_ref.content_hash, record_count: entry.record_count, requested_at: entry.requested_at, received_at: entry.received_at, stop_reason: entry.stop_reason })), last_source_revision: lastSourceRevision, consecutive_no_new_pages: emptyPages, run_status: unitStatus === 'partial' ? 'partial' : 'running', unit_status: unitStatus, stop_reason: stopReason, attempt: 0 })
        const aggregateNext = checkpointNext({ query_identity: `run:${input.identity}`, query_hash: hash(`run:${input.identity}`), cursor: null, seen_provider_record_ids: [...globalSeenIds], request_ledger: unitNext.request_ledger, last_source_revision: runLastSourceRevision, run_status: unitStatus === 'partial' ? 'partial' : unitStatus !== 'open' && completed + 1 === units.length ? 'complete' : 'running', unit_status: unitStatus, stop_reason: stopReason, attempt: 0 })
        let committed: SourcePageCommitResult
        try { committed = await this.#writePlane.commitPage({ checkpoint: this.#checkpoint, checkpoint_identity: unitIdentity, expected_checkpoint_revision: unitRevision, checkpoint_next: unitNext, aggregate_checkpoint: { identity: input.identity, expected_revision: runRevision, next: aggregateNext }, normalized: page.records, raw_ref: page.raw_ref, raw_receipt_id: page.raw_receipt_id, raw_receipt_actor_id: page.raw_receipt_actor_id, raw_receipt_authority: this.#receiptAuthority, raw_hash: page.raw_ref.content_hash, correlation_id: input.correlation_id, partial: page.partial }) } catch (error) {
          const unitCheckpoint = this.#checkpoint.read(unitIdentity); const aggregateCheckpoint = this.#checkpoint.read(input.identity)
          if (checkpointCommittedAs(unitCheckpoint, unitRevision, unitNext) && checkpointCommittedAs(aggregateCheckpoint, runRevision, aggregateNext) && (page.records.length === 0 || pageSideEffectsCommitted({ write_plane: this.#writePlane, normalized: page.records, raw_hash: page.raw_ref.content_hash, raw_key: page.raw_ref.key, correlation_id: input.correlation_id, checkpoint_revision: unitCheckpoint.revision }))) {
            committed = Object.freeze({ statuses: [], source_ids: [], checkpoint: unitCheckpoint, aggregate_checkpoint: aggregateCheckpoint })
          } else {
          try { await this.#writePlane.recordOrphan({ raw_ref: page.raw_ref, raw_hash: page.raw_ref.content_hash, reason: error instanceof CheckpointConflictError ? 'checkpoint_conflict' : 'write_plane_failure' }) } catch { /* Raw evidence stays recoverable through its storage receipt even if the best-effort orphan recorder is unavailable. */ }
          throw error
          }
        }
        unitRevision = committed.checkpoint.revision
        if (committed.aggregate_checkpoint === undefined) throw new Error('page bundle did not atomically advance aggregate checkpoint')
        runRevision = committed.aggregate_checkpoint.revision
        await this.#rawStore.markDisposition({ receipt_id: page.raw_receipt_id, disposition: 'committed' })
        if (unitStatus === 'natural_end' || unitStatus === 'no_new_ids') {
          completed += 1; break
        }
        if (unitStatus === 'partial') {
          return Object.freeze({ run_status: 'partial', completed_units: completed, partial: true, deletion_events: [], request_ledger: ledger })
        }
        cursor = page.next_cursor
      }
    }
    return Object.freeze({ run_status: 'complete', completed_units: completed, partial: false, deletion_events: [], request_ledger: ledger })
  }
  async #save(identity: string, expected_revision: number, next: CheckpointNext): Promise<number> {
    return this.#checkpoint.transact({ identity, expected_revision, next }, (checkpoint) => checkpoint.revision)
  }
  async #fetchWithRetry(input: Readonly<{ query: string; type: 'Latest' | 'Top'; cursor: string | null; correlation_id: string; signal: AbortSignal }>): Promise<SourceAdapterPage> {
    for (let attempt = 0; attempt <= 5; attempt += 1) {
      try {
        const pageInput: SourceAdapterPageInput = { provider: 'twitter241', adapter_version: 'twitter241-v1', schema_version: 1, normalization_version: 1, query: { query: input.query, type: input.type, count: 20 }, cursor: input.cursor, limit: 20 }
        return await this.#adapter.fetchPage(pageInput, { correlation_id: input.correlation_id, captured_at: this.#clock.now(), signal: input.signal, raw_store: this.#rawStore, quarantine: { record: () => undefined } })
      } catch (error) {
        const failure = sanitizedProviderError(error)
        if (!failure.retryable || attempt === 5) {
          const terminal = new SourceAdapterError(failure.code, failure.retry_after, attempt + 1, failure.raw_persisted, failure.quarantine_audited, failure.quarantine_evidence)
          throw terminal
        }
        const ceiling = 2_000 * 2 ** attempt
        const delay = failure.code === 'rate_limited' ? providerRetryDelay(attempt, failure.retry_after, Date.parse(this.#clock.now())) : Math.floor(Math.max(0, Math.min(1, this.#random())) * ceiling)
        await this.#clock.sleep(delay)
      }
    }
    throw new SourceAdapterError('transient_upstream')
  }
}

/** Recursive evidence scan; callers use it over logs, checkpoints, queue/DLQ, DB dumps and task evidence. */
export const countSecretSentinel = (value: unknown, sentinel: string): number => {
  const visited = new Set<unknown>()
  const scan = (entry: unknown): number => {
    if (typeof entry === 'string') return entry.includes(sentinel) ? 1 : 0
    if (typeof entry !== 'object' || entry === null || visited.has(entry)) return 0
    visited.add(entry)
    return Array.isArray(entry) ? entry.reduce((count, child) => count + scan(child), 0) : Object.entries(entry as Record<string, unknown>).reduce((count, [key, child]) => count + scan(key) + scan(child), 0)
  }
  return scan(value)
}
