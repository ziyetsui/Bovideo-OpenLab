import type { Source } from '@/contracts/source'
import { sourceSchema } from '@/contracts/source'
import { auditEventSchema, type AuditEvent } from '@/contracts/common'

import { CheckpointConflictError } from './errors'
import type { NormalizedSourceRecord } from './types'
import { objectRefSchema, type ObjectRef } from '@/storage/object-ref'

const INGEST_SERVICE_ID = '01J0J0J0J0J0J0J0J0J0J0J0J0'
const thenable = (value: unknown): boolean => {
  try { return (typeof value === 'object' && value !== null || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function' } catch { return true }
}
const deepImmutable = <T>(value: T): T => {
  const clone = structuredClone(value)
  const freeze = (entry: unknown): unknown => {
    if (typeof entry !== 'object' || entry === null || Object.isFrozen(entry)) return entry
    for (const child of Object.values(entry as Record<string, unknown>)) freeze(child)
    return Object.freeze(entry)
  }
  return freeze(clone) as T
}
const checkpointImmutable = (value: AcquisitionCheckpoint): AcquisitionCheckpoint => deepImmutable(value)
type OwnedCheckpointState = { values: Map<string, AcquisitionCheckpoint>; now: () => string; serial: Promise<void> }
const ownedCheckpointStates = new WeakMap<object, OwnedCheckpointState>()
const RAW_REF_FIELDS = ['bucket_class', 'namespace', 'key', 'version', 'content_hash', 'size_bytes', 'mime_type', 'rights_state', 'deletion_state'] as const satisfies readonly (keyof ObjectRef)[]
const sameRawIdentity = (left: ObjectRef, right: ObjectRef): boolean =>
  left.namespace === right.namespace && left.bucket_class === right.bucket_class && left.key === right.key && left.version === right.version && left.content_hash === right.content_hash && left.size_bytes === right.size_bytes && left.mime_type === right.mime_type && left.rights_state === right.rights_state && left.deletion_state === right.deletion_state
/** Authority output is canonical; every immutable ObjectRef field must bind exactly. */
const canonicalRawReceipt = (candidate: unknown, supplied: ObjectRef, rawHash: string): ObjectRef | null => {
  let parsed: ObjectRef
  try { parsed = parsedRawRef(candidate) } catch { return null }
  return rawHash === supplied.content_hash && rawHash === parsed.content_hash && parsed.namespace === 'raw-evidence' && sameRawIdentity(parsed, supplied) ? parsed : null
}
const parsedRawRef = (candidate: unknown): ObjectRef => {
  if (!isPlainRecord(candidate)) throw new Error('raw evidence reference is invalid')
  const keys = Reflect.ownKeys(candidate)
  if (keys.length !== RAW_REF_FIELDS.length || keys.some((key) => typeof key !== 'string' || !RAW_REF_FIELDS.includes(key as typeof RAW_REF_FIELDS[number]))) throw new Error('raw evidence reference is invalid')
  // Read each allowed field once, before schema validation. This rejects temporal getters and
  // excludes all extra caller-controlled properties from the canonical object.
  const snapshot = Object.fromEntries(RAW_REF_FIELDS.map((field) => [field, Reflect.get(candidate, field)]))
  const parsed = objectRefSchema.safeParse(snapshot)
  if (!parsed.success) throw new Error('raw evidence reference is invalid')
  return deepImmutable(parsed.data)
}

export type CheckpointRunStatus = 'running' | 'complete' | 'partial'
export type CheckpointUnitStatus = 'open' | 'natural_end' | 'no_new_ids' | 'failed' | 'partial'
export type CheckpointStopReason = 'natural_end' | 'no_new_ids' | 'repeated_cursor' | 'provider_partial' | 'rate_limited' | 'transient_upstream' | 'auth' | 'entitlement' | 'invalid_response' | 'unsafe_endpoint' | 'aborted'
export type CheckpointRequestLedgerEntry = Readonly<{ query_identity: string; input_cursor: string | null; output_cursor: string | null; raw_hash: string; record_count: number; requested_at: string; received_at: string; stop_reason: CheckpointStopReason | null }>
export type AcquisitionCheckpoint = Readonly<{
  identity: string; query_identity: string; revision: number; adapter: 'twitter241'; schema_version: 1; normalization_version: 1; query_hash: string
  cursor: string | null; seen_cursors: readonly string[]; seen_provider_record_ids: readonly string[]; request_ledger: readonly CheckpointRequestLedgerEntry[]; last_source_revision: string | null; consecutive_no_new_pages: number; run_status: CheckpointRunStatus; unit_status: CheckpointUnitStatus; stop_reason: CheckpointStopReason | null; attempt: number; updated_at: string
}>
export type CheckpointNext = Omit<AcquisitionCheckpoint, 'identity' | 'revision' | 'updated_at'>
export type CheckpointMutation = Readonly<{ identity: string; expected_revision: number; next: CheckpointNext }>
export type CheckpointPairMutation = Readonly<{ first: CheckpointMutation; second: CheckpointMutation }>
export type CheckpointRepository = Readonly<{
  /** Operation is deliberately synchronous: async/reentrant callbacks cannot hold the CAS lock. */
  transact: <T>(input: CheckpointMutation, operation: (next: AcquisitionCheckpoint) => T) => Promise<T>
  /** Both CAS rows publish together, or neither becomes visible. Identities must differ. */
  transactPair: <T>(input: CheckpointPairMutation, operation: (first: AcquisitionCheckpoint, second: AcquisitionCheckpoint) => T) => Promise<T>
  read: (identity: string) => AcquisitionCheckpoint | undefined
}>
export type SourceCommitResult = Readonly<{ status: 'created' | 'duplicate'; source: Source; checkpoint: AcquisitionCheckpoint }>
export type SourcePageCommitResult = Readonly<{ statuses: readonly ('created' | 'duplicate')[]; source_ids: readonly string[]; checkpoint: AcquisitionCheckpoint; aggregate_checkpoint?: AcquisitionCheckpoint }>
export type RawReceiptAuthority = Readonly<{ resolve: (input: Readonly<{ receipt_id: string; actor_id: string; correlation_id: string; raw_ref: ObjectRef }>) => Promise<ObjectRef | null> }>
export type OrphanRecord = Readonly<{ raw_ref: ObjectRef; raw_hash: string; reason: 'checkpoint_conflict' | 'write_plane_failure' | 'provider_schema'; retained: boolean; created_at: string }>

const UTC_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const CHECKPOINT_NEXT_FIELDS = ['query_identity', 'adapter', 'schema_version', 'normalization_version', 'query_hash', 'cursor', 'seen_cursors', 'seen_provider_record_ids', 'request_ledger', 'last_source_revision', 'consecutive_no_new_pages', 'run_status', 'unit_status', 'stop_reason', 'attempt'] as const
const LEDGER_FIELDS = ['query_identity', 'input_cursor', 'output_cursor', 'raw_hash', 'record_count', 'requested_at', 'received_at', 'stop_reason'] as const
const STOP_REASONS = new Set<CheckpointStopReason>(['natural_end', 'no_new_ids', 'repeated_cursor', 'provider_partial', 'rate_limited', 'transient_upstream', 'auth', 'entitlement', 'invalid_response', 'unsafe_endpoint', 'aborted'])
const UNIT_STATUSES = new Set<CheckpointUnitStatus>(['open', 'natural_end', 'no_new_ids', 'failed', 'partial'])
const RUN_STATUSES = new Set<CheckpointRunStatus>(['running', 'complete', 'partial'])
const isPlainRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const strictFields = <T extends readonly string[]>(value: unknown, fields: T, error: string): Record<T[number], unknown> => {
  if (!isPlainRecord(value)) throw new Error(error)
  const keys = Reflect.ownKeys(value)
  if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) throw new Error(error)
  return Object.fromEntries(fields.map((field) => [field, Reflect.get(value, field)])) as Record<T[number], unknown>
}
const strictArray = (value: unknown, error: string): readonly unknown[] => {
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) throw new Error(error)
  return Object.freeze(Array.from({ length: value.length }, (_, index) => Reflect.get(value, String(index))))
}
const canonicalUtc = (value: unknown, error = 'checkpoint clock must return RFC3339 UTC'): string => {
  if (typeof value !== 'string' || !UTC_RFC3339.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw new Error(error)
  return value
}
const checkpointString = (value: unknown, error = 'checkpoint input is invalid'): string => { if (typeof value !== 'string') throw new Error(error); return value }
const checkpointNullableString = (value: unknown, error = 'checkpoint input is invalid'): string | null => value === null ? null : checkpointString(value, error)
const checkpointHash = (value: unknown): string => { const result = checkpointString(value); if (!/^sha256:v1:[a-f0-9]{64}$/.test(result)) throw new Error('checkpoint input is invalid'); return result }
const checkpointIdentity = (value: unknown): string => { const result = checkpointString(value); if (!/^[A-Za-z0-9:_-]{1,512}$/.test(result)) throw new Error('checkpoint input is invalid'); return result }
const checkpointInteger = (value: unknown): number => { if (!Number.isInteger(value) || (value as number) < 0) throw new Error('checkpoint input is invalid'); return value as number }
const snapshotStringArray = (value: unknown): readonly string[] => Object.freeze(strictArray(value, 'checkpoint input is invalid').map((entry) => checkpointString(entry)))
const snapshotLedger = (value: unknown): readonly CheckpointRequestLedgerEntry[] => Object.freeze(strictArray(value, 'checkpoint input is invalid').map((entry) => {
  const fields = strictFields(entry, LEDGER_FIELDS, 'checkpoint input is invalid')
  const stop = fields.stop_reason === null ? null : checkpointString(fields.stop_reason)
  if (stop !== null && !STOP_REASONS.has(stop as CheckpointStopReason)) throw new Error('checkpoint input is invalid')
  return deepImmutable({ query_identity: checkpointIdentity(fields.query_identity), input_cursor: checkpointNullableString(fields.input_cursor), output_cursor: checkpointNullableString(fields.output_cursor), raw_hash: checkpointHash(fields.raw_hash), record_count: checkpointInteger(fields.record_count), requested_at: canonicalUtc(fields.requested_at, 'checkpoint input is invalid'), received_at: canonicalUtc(fields.received_at, 'checkpoint input is invalid'), stop_reason: stop as CheckpointStopReason | null })
}))
const snapshotCheckpointNext = (value: unknown): CheckpointNext => {
  const fields = strictFields(value, CHECKPOINT_NEXT_FIELDS, 'checkpoint input is invalid')
  const run = checkpointString(fields.run_status); const unit = checkpointString(fields.unit_status); const stop = fields.stop_reason === null ? null : checkpointString(fields.stop_reason)
  if (fields.adapter !== 'twitter241' || fields.schema_version !== 1 || fields.normalization_version !== 1 || !RUN_STATUSES.has(run as CheckpointRunStatus) || !UNIT_STATUSES.has(unit as CheckpointUnitStatus) || (stop !== null && !STOP_REASONS.has(stop as CheckpointStopReason))) throw new Error('checkpoint input is invalid')
  return deepImmutable({ query_identity: checkpointIdentity(fields.query_identity), adapter: 'twitter241', schema_version: 1, normalization_version: 1, query_hash: checkpointHash(fields.query_hash), cursor: checkpointNullableString(fields.cursor), seen_cursors: snapshotStringArray(fields.seen_cursors), seen_provider_record_ids: snapshotStringArray(fields.seen_provider_record_ids), request_ledger: snapshotLedger(fields.request_ledger), last_source_revision: checkpointNullableString(fields.last_source_revision), consecutive_no_new_pages: checkpointInteger(fields.consecutive_no_new_pages), run_status: run as CheckpointRunStatus, unit_status: unit as CheckpointUnitStatus, stop_reason: stop as CheckpointStopReason | null, attempt: checkpointInteger(fields.attempt) })
}
const snapshotCheckpointMutation = (value: unknown): CheckpointMutation => {
  const fields = strictFields(value, ['identity', 'expected_revision', 'next'] as const, 'checkpoint input is invalid')
  return deepImmutable({ identity: checkpointIdentity(fields.identity), expected_revision: checkpointInteger(fields.expected_revision), next: snapshotCheckpointNext(fields.next) })
}
const snapshotInitialCheckpoint = (value: unknown, now: () => string): AcquisitionCheckpoint => {
  const fields = strictFields(value, ['identity', 'revision', ...CHECKPOINT_NEXT_FIELDS] as const, 'checkpoint initial state is invalid')
  const next = snapshotCheckpointNext(Object.fromEntries(CHECKPOINT_NEXT_FIELDS.map((field) => [field, fields[field]])))
  return checkpointImmutable({ identity: checkpointIdentity(fields.identity), revision: checkpointInteger(fields.revision), query_identity: next.query_identity, adapter: next.adapter, schema_version: next.schema_version, normalization_version: next.normalization_version, query_hash: next.query_hash, cursor: next.cursor, seen_cursors: next.seen_cursors, seen_provider_record_ids: next.seen_provider_record_ids, request_ledger: next.request_ledger, last_source_revision: next.last_source_revision, consecutive_no_new_pages: next.consecutive_no_new_pages, run_status: next.run_status, unit_status: next.unit_status, stop_reason: next.stop_reason, attempt: next.attempt, updated_at: canonicalUtc(now()) })
}
const NORMALIZED_FIELDS = ['provider', 'provider_record_id', 'canonical_url', 'captured_at', 'title', 'text', 'author_id', 'author_handle', 'rights_state', 'rights_basis'] as const
const ADAPTER_RECORD_FIELDS = [...NORMALIZED_FIELDS, 'raw_bytes', 'raw_hash'] as const
const snapshotNormalizedRecord = (value: unknown): NormalizedSourceRecord => {
  const fields = strictFields(value, isPlainRecord(value) && Reflect.ownKeys(value).length === ADAPTER_RECORD_FIELDS.length ? ADAPTER_RECORD_FIELDS : NORMALIZED_FIELDS, 'write-plane input is invalid')
  if (fields.provider !== 'twitter241' || fields.title !== null || fields.rights_state !== 'metadata_only' || fields.rights_basis !== null) throw new Error('write-plane input is invalid')
  if ('raw_bytes' in fields && (!(fields.raw_bytes instanceof Uint8Array) || checkpointHash(fields.raw_hash) === '')) throw new Error('write-plane input is invalid')
  return deepImmutable({ provider: 'twitter241', provider_record_id: checkpointString(fields.provider_record_id, 'write-plane input is invalid'), canonical_url: checkpointString(fields.canonical_url, 'write-plane input is invalid'), captured_at: canonicalUtc(fields.captured_at, 'write-plane input is invalid'), title: null, text: checkpointString(fields.text, 'write-plane input is invalid'), author_id: checkpointString(fields.author_id, 'write-plane input is invalid'), author_handle: checkpointString(fields.author_handle, 'write-plane input is invalid'), rights_state: 'metadata_only', rights_basis: null })
}
const snapshotNormalizedRecords = (value: unknown): readonly NormalizedSourceRecord[] => Object.freeze(strictArray(value, 'write-plane input is invalid').map(snapshotNormalizedRecord))
type TerminalCommand = Readonly<{ checkpoint: CheckpointRepository; unit_checkpoint: CheckpointMutation; aggregate_checkpoint: CheckpointMutation; correlation_id: string; reason: CheckpointStopReason; attempts: number }>
type ReceiptAuthoritySnapshot = RawReceiptAuthority
const snapshotAuthority = (value: unknown): ReceiptAuthoritySnapshot => {
  const fields = strictFields(value, ['resolve'] as const, 'write-plane input is invalid')
  if (typeof fields.resolve !== 'function') throw new Error('write-plane input is invalid')
  return Object.freeze({ resolve: fields.resolve as RawReceiptAuthority['resolve'] })
}
type CommitCommand = Readonly<{ checkpoint: CheckpointRepository; checkpoint_identity: string; expected_checkpoint_revision: number; checkpoint_next: CheckpointNext; normalized: NormalizedSourceRecord; raw_ref: ObjectRef; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; raw_hash: string; correlation_id: string; partial: boolean }>
const snapshotCommitCommand = (value: unknown): CommitCommand => {
  const fields = strictFields(value, ['checkpoint', 'checkpoint_identity', 'expected_checkpoint_revision', 'checkpoint_next', 'normalized', 'raw_ref', 'raw_receipt_id', 'raw_receipt_actor_id', 'raw_receipt_authority', 'raw_hash', 'correlation_id', 'partial'] as const, 'write-plane input is invalid')
  if (typeof fields.partial !== 'boolean') throw new Error('write-plane input is invalid')
  return Object.freeze({ checkpoint: fields.checkpoint as CheckpointRepository, checkpoint_identity: checkpointIdentity(fields.checkpoint_identity), expected_checkpoint_revision: checkpointInteger(fields.expected_checkpoint_revision), checkpoint_next: snapshotCheckpointNext(fields.checkpoint_next), normalized: snapshotNormalizedRecord(fields.normalized), raw_ref: parsedRawRef(fields.raw_ref), raw_receipt_id: checkpointString(fields.raw_receipt_id, 'write-plane input is invalid'), raw_receipt_actor_id: checkpointString(fields.raw_receipt_actor_id, 'write-plane input is invalid'), raw_receipt_authority: snapshotAuthority(fields.raw_receipt_authority), raw_hash: checkpointHash(fields.raw_hash), correlation_id: checkpointString(fields.correlation_id, 'write-plane input is invalid'), partial: fields.partial })
}
type PageCommand = Readonly<{ checkpoint: CheckpointRepository; checkpoint_identity: string; expected_checkpoint_revision: number; checkpoint_next: CheckpointNext; aggregate_checkpoint?: CheckpointMutation; normalized: readonly NormalizedSourceRecord[]; raw_ref: ObjectRef; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; raw_hash: string; correlation_id: string; partial: boolean }>
const snapshotPageCommand = (value: unknown): PageCommand => {
  const fields = strictFields(value, isPlainRecord(value) && Object.prototype.hasOwnProperty.call(value, 'aggregate_checkpoint') ? ['checkpoint', 'checkpoint_identity', 'expected_checkpoint_revision', 'checkpoint_next', 'aggregate_checkpoint', 'normalized', 'raw_ref', 'raw_receipt_id', 'raw_receipt_actor_id', 'raw_receipt_authority', 'raw_hash', 'correlation_id', 'partial'] as const : ['checkpoint', 'checkpoint_identity', 'expected_checkpoint_revision', 'checkpoint_next', 'normalized', 'raw_ref', 'raw_receipt_id', 'raw_receipt_actor_id', 'raw_receipt_authority', 'raw_hash', 'correlation_id', 'partial'] as const, 'write-plane input is invalid')
  if (typeof fields.partial !== 'boolean' || (fields.aggregate_checkpoint !== undefined && fields.aggregate_checkpoint === null)) throw new Error('write-plane input is invalid')
  return Object.freeze({ checkpoint: fields.checkpoint as CheckpointRepository, checkpoint_identity: checkpointIdentity(fields.checkpoint_identity), expected_checkpoint_revision: checkpointInteger(fields.expected_checkpoint_revision), checkpoint_next: snapshotCheckpointNext(fields.checkpoint_next), aggregate_checkpoint: fields.aggregate_checkpoint === undefined ? undefined : snapshotCheckpointMutation(fields.aggregate_checkpoint), normalized: snapshotNormalizedRecords(fields.normalized), raw_ref: parsedRawRef(fields.raw_ref), raw_receipt_id: checkpointString(fields.raw_receipt_id, 'write-plane input is invalid'), raw_receipt_actor_id: checkpointString(fields.raw_receipt_actor_id, 'write-plane input is invalid'), raw_receipt_authority: snapshotAuthority(fields.raw_receipt_authority), raw_hash: checkpointHash(fields.raw_hash), correlation_id: checkpointString(fields.correlation_id, 'write-plane input is invalid'), partial: fields.partial })
}
type QuarantineCommand = Readonly<{ checkpoint: CheckpointRepository; unit_checkpoint: CheckpointMutation; aggregate_checkpoint: CheckpointMutation; raw_ref: ObjectRef; raw_hash: string; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; correlation_id: string; attempts: number }>
const snapshotQuarantineCommand = (value: unknown): QuarantineCommand => {
  const fields = strictFields(value, ['checkpoint', 'unit_checkpoint', 'aggregate_checkpoint', 'raw_ref', 'raw_hash', 'raw_receipt_id', 'raw_receipt_actor_id', 'raw_receipt_authority', 'correlation_id', 'attempts'] as const, 'write-plane input is invalid')
  const attempts = checkpointInteger(fields.attempts); if (attempts < 1) throw new Error('write-plane input is invalid')
  return Object.freeze({ checkpoint: fields.checkpoint as CheckpointRepository, unit_checkpoint: snapshotCheckpointMutation(fields.unit_checkpoint), aggregate_checkpoint: snapshotCheckpointMutation(fields.aggregate_checkpoint), raw_ref: parsedRawRef(fields.raw_ref), raw_hash: checkpointHash(fields.raw_hash), raw_receipt_id: checkpointString(fields.raw_receipt_id, 'write-plane input is invalid'), raw_receipt_actor_id: checkpointString(fields.raw_receipt_actor_id, 'write-plane input is invalid'), raw_receipt_authority: snapshotAuthority(fields.raw_receipt_authority), correlation_id: checkpointString(fields.correlation_id, 'write-plane input is invalid'), attempts })
}
const snapshotTerminalCommand = (value: unknown): TerminalCommand => {
  const fields = strictFields(value, ['checkpoint', 'unit_checkpoint', 'aggregate_checkpoint', 'correlation_id', 'reason', 'attempts'] as const, 'write-plane input is invalid')
  const reason = checkpointString(fields.reason, 'write-plane input is invalid')
  if (!STOP_REASONS.has(reason as CheckpointStopReason)) throw new Error('write-plane input is invalid')
  const attempts = checkpointInteger(fields.attempts); if (attempts < 1) throw new Error('write-plane input is invalid')
  return Object.freeze({ checkpoint: fields.checkpoint as CheckpointRepository, unit_checkpoint: snapshotCheckpointMutation(fields.unit_checkpoint), aggregate_checkpoint: snapshotCheckpointMutation(fields.aggregate_checkpoint), correlation_id: checkpointString(fields.correlation_id, 'write-plane input is invalid'), reason: reason as CheckpointStopReason, attempts })
}

export interface SourceWritePlane {
  commit(input: Readonly<{ checkpoint: CheckpointRepository; checkpoint_identity: string; expected_checkpoint_revision: number; checkpoint_next: CheckpointNext; normalized: NormalizedSourceRecord; raw_ref: ObjectRef; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; raw_hash: string; correlation_id: string; partial: boolean }>): Promise<SourceCommitResult>
  commitPage(input: Readonly<{ checkpoint: CheckpointRepository; checkpoint_identity: string; expected_checkpoint_revision: number; checkpoint_next: CheckpointNext; aggregate_checkpoint?: CheckpointMutation; normalized: readonly NormalizedSourceRecord[]; raw_ref: ObjectRef; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; raw_hash: string; correlation_id: string; partial: boolean }>): Promise<SourcePageCommitResult>
  recordOrphan(input: Readonly<{ raw_ref: ObjectRef; raw_hash: string; reason: OrphanRecord['reason'] }>): Promise<void>
  /** Publishes a retained orphan and its validated failed audit atomically, or neither. */
  recordQuarantine(input: Readonly<{ raw_ref: ObjectRef; raw_hash: string; reason: 'provider_schema'; correlation_id: string }>): Promise<void>
  /** The only terminal schema-failure command: receipt proof, orphan/audits and both CAS rows publish together. */
  commitQuarantinedFailure(input: Readonly<{ checkpoint: CheckpointRepository; unit_checkpoint: CheckpointMutation; aggregate_checkpoint: CheckpointMutation; raw_ref: ObjectRef; raw_hash: string; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; correlation_id: string; attempts: number }>): Promise<Readonly<{ unit_checkpoint: AcquisitionCheckpoint; aggregate_checkpoint: AcquisitionCheckpoint }>>
  /** Serially classifies a pending ingress receipt against durable source/audit/orphan state. */
  reconcilePendingRaw(input: Readonly<{ receipt_id: string; raw_ref: ObjectRef; raw_hash: string; correlation_id: string; eligible_for_orphan: boolean }>): Promise<'committed' | 'quarantined' | 'retained'>
  /** Commits both terminal checkpoints and their failed fetch audit atomically, or neither. */
  commitTerminalFailure(input: Readonly<{ checkpoint: CheckpointRepository; unit_checkpoint: CheckpointMutation; aggregate_checkpoint: CheckpointMutation; correlation_id: string; reason: CheckpointStopReason; attempts: number }>): Promise<Readonly<{ unit_checkpoint: AcquisitionCheckpoint; aggregate_checkpoint: AcquisitionCheckpoint }>>
  reconcileOrphans(input: Readonly<{ strategy: 'retain' | 'delete'; now?: string; min_age_ms?: number; verify_raw?: (ref: ObjectRef) => Promise<boolean>; delete_raw?: (ref: ObjectRef) => Promise<void> }>): Promise<Readonly<{ retained: number; deleted: number }>>
  sources(): readonly Source[]
  audits(): readonly AuditEvent[]
  orphans(): readonly OrphanRecord[]
  /** T06 acquires evidence only; it never promotes a source to a Prompt Artifact. */
  artifacts(): readonly never[]
  deletions(): readonly never[]
}

const ownedCheckpointState = (checkpoint: CheckpointRepository): OwnedCheckpointState => {
  if ((typeof checkpoint !== 'object' && typeof checkpoint !== 'function') || checkpoint === null) throw new Error('write-plane requires its owned local checkpoint repository')
  const state = ownedCheckpointStates.get(checkpoint)
  if (state === undefined) throw new Error('write-plane requires its owned local checkpoint repository')
  return state
}
const prepareOwnedCheckpoint = (state: OwnedCheckpointState, input: CheckpointMutation): AcquisitionCheckpoint => {
  const current = state.values.get(input.identity)
  if (current !== undefined && (current.query_identity !== input.next.query_identity || current.query_hash !== input.next.query_hash || current.adapter !== input.next.adapter || current.schema_version !== input.next.schema_version || current.normalization_version !== input.next.normalization_version)) throw new Error('checkpoint identity metadata mismatch')
  const actual = current?.revision ?? 0
  if (actual !== input.expected_revision) throw new CheckpointConflictError()
  const next = input.next
  return checkpointImmutable({ identity: input.identity, revision: actual + 1, query_identity: next.query_identity, adapter: next.adapter, schema_version: next.schema_version, normalization_version: next.normalization_version, query_hash: next.query_hash, cursor: next.cursor, seen_cursors: next.seen_cursors, seen_provider_record_ids: next.seen_provider_record_ids, request_ledger: next.request_ledger, last_source_revision: next.last_source_revision, consecutive_no_new_pages: next.consecutive_no_new_pages, run_status: next.run_status, unit_status: next.unit_status, stop_reason: next.stop_reason, attempt: next.attempt, updated_at: canonicalUtc(state.now()) })
}
const withOwnedCheckpoint = async <T>(checkpoint: CheckpointRepository, operation: (state: OwnedCheckpointState) => Promise<T>): Promise<T> => {
  const state = ownedCheckpointState(checkpoint)
  const previous = state.serial; let release!: () => void
  state.serial = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await operation(state) } finally { release() }
}
const transactOwned = async <T>(checkpoint: CheckpointRepository, input: CheckpointMutation, operation: (next: AcquisitionCheckpoint) => T): Promise<T> => {
  const mutation = snapshotCheckpointMutation(input)
  return withOwnedCheckpoint(checkpoint, async (state) => {
  const next = prepareOwnedCheckpoint(state, mutation); const result = operation(next)
  if (thenable(result)) throw new Error('checkpoint CAS operation must be synchronous')
  state.values.set(mutation.identity, checkpointImmutable(next)); return result
  })
}
const transactOwnedPair = async <T>(checkpoint: CheckpointRepository, input: CheckpointPairMutation, operation: (first: AcquisitionCheckpoint, second: AcquisitionCheckpoint) => T): Promise<T> => {
  const pair = strictFields(input, ['first', 'second'] as const, 'checkpoint input is invalid')
  const firstMutation = snapshotCheckpointMutation(pair.first); const secondMutation = snapshotCheckpointMutation(pair.second)
  return withOwnedCheckpoint(checkpoint, async (state) => {
  if (firstMutation.identity === secondMutation.identity) throw new Error('checkpoint pair identities must differ')
  const first = prepareOwnedCheckpoint(state, firstMutation); const second = prepareOwnedCheckpoint(state, secondMutation); const result = operation(first, second)
  if (thenable(result)) throw new Error('checkpoint CAS operation must be synchronous')
  state.values.set(firstMutation.identity, checkpointImmutable(first)); state.values.set(secondMutation.identity, checkpointImmutable(second)); return result
  })
}
type PreparedOwnedCheckpoint = Readonly<{ state: OwnedCheckpointState; mutation: CheckpointMutation; next: AcquisitionCheckpoint }>
const prepareOwnedPublication = (checkpoint: CheckpointRepository, mutation: CheckpointMutation): PreparedOwnedCheckpoint => {
  const state = ownedCheckpointState(checkpoint)
  return Object.freeze({ state, mutation, next: prepareOwnedCheckpoint(state, mutation) })
}
const publishOwned = (prepared: PreparedOwnedCheckpoint): void => { prepared.state.values.set(prepared.mutation.identity, prepared.next) }

/** Checkpoint state is private; read returns a detached frozen value and no backing Map is exposed. */
export class InMemoryCheckpointRepository implements CheckpointRepository {
  constructor(input: Readonly<{ now: () => string; initial?: readonly Omit<AcquisitionCheckpoint, 'updated_at'>[] }>) {
    const now = input.now; const initial = input.initial
    if (typeof now !== 'function' || (initial !== undefined && !Array.isArray(initial))) throw new Error('checkpoint constructor input is invalid')
    const state: OwnedCheckpointState = { values: new Map(), now, serial: Promise.resolve() }
    const snapshots = initial === undefined ? [] : strictArray(initial, 'checkpoint initial state is invalid').map((value) => snapshotInitialCheckpoint(value, now))
    for (const value of snapshots) { if (state.values.has(value.identity)) throw new Error('checkpoint initial state is invalid'); state.values.set(value.identity, value) }
    ownedCheckpointStates.set(this, state)
    // The write plane accepts only this local owner. Bind and freeze its public façade so a
    // caller cannot replace a CAS method with a callback-after-throw/repeat implementation.
    this.read = this.read.bind(this)
    this.transact = this.transact.bind(this)
    this.transactPair = this.transactPair.bind(this)
    Object.freeze(this)
  }
  read(identity: string): AcquisitionCheckpoint | undefined {
    const current = ownedCheckpointState(this).values.get(identity)
    return current === undefined ? undefined : checkpointImmutable(current)
  }
  async transact<T>(input: CheckpointMutation, operation: (next: AcquisitionCheckpoint) => T): Promise<T> {
    return transactOwned(this, input, operation)
  }
  async transactPair<T>(input: CheckpointPairMutation, operation: (first: AcquisitionCheckpoint, second: AcquisitionCheckpoint) => T): Promise<T> {
    return transactOwnedPair(this, input, operation)
  }
}

function assertOwnedCheckpoint(checkpoint: CheckpointRepository): asserts checkpoint is InMemoryCheckpointRepository {
  ownedCheckpointState(checkpoint)
}

/** Local write-plane emulator: source revision, audit and checkpoint advance are one checkpoint transaction. */
export class InMemorySourceWritePlane implements SourceWritePlane {
  readonly #sources: Source[] = []
  readonly #audits: AuditEvent[] = []
  readonly #orphans: OrphanRecord[] = []
  readonly #now: () => string
  readonly #idFactory: () => string
  readonly #sourceIdFactory: () => string
  readonly #auditIdFactory: () => string
  readonly #failCommit?: () => void
  readonly #failSource?: () => void
  readonly #failAudit?: () => void
  readonly #ingressTerminal = new Set<string>()
  readonly #ingressInflight = new Set<string>()
  readonly #orphanDeleteClaims = new Set<string>()
  #serial: Promise<void> = Promise.resolve()
  constructor(input: Readonly<{ now: () => string; idFactory: () => string; source_id_factory?: () => string; audit_id_factory?: () => string; fail_commit?: () => void; fail_source?: () => void; fail_audit?: () => void }>) { this.#now = input.now; this.#idFactory = input.idFactory; this.#sourceIdFactory = input.source_id_factory ?? input.idFactory; this.#auditIdFactory = input.audit_id_factory ?? input.idFactory; this.#failCommit = input.fail_commit; this.#failSource = input.fail_source; this.#failAudit = input.fail_audit }
  async commit(input: Readonly<{ checkpoint: CheckpointRepository; checkpoint_identity: string; expected_checkpoint_revision: number; checkpoint_next: CheckpointNext; normalized: NormalizedSourceRecord; raw_ref: ObjectRef; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; raw_hash: string; correlation_id: string; partial: boolean }>): Promise<SourceCommitResult> { return this.#commit(snapshotCommitCommand(input)) }
  async #commit(input: CommitCommand): Promise<SourceCommitResult> {
    if (input.raw_receipt_id.trim().length === 0) throw new Error('trusted raw ingress receipt is required')
    const normalized = snapshotNormalizedRecord(input.normalized); const submittedRaw = parsedRawRef(input.raw_ref); const rawHash = checkpointHash(input.raw_hash)
    const checkpointMutation = snapshotCheckpointMutation({ identity: input.checkpoint_identity, expected_revision: input.expected_checkpoint_revision, next: input.checkpoint_next })
    assertOwnedCheckpoint(input.checkpoint)
    const sourceId = this.#sourceIdFactory(); const createdAt = this.#now(); const updatedAt = this.#now(); const auditId = this.#auditIdFactory(); const auditAt = this.#now()
    // Receipt authorities are injected and may reenter the write plane; never call them under #exclusive.
    const trusted = await input.raw_receipt_authority.resolve({ receipt_id: input.raw_receipt_id, actor_id: input.raw_receipt_actor_id, correlation_id: input.correlation_id, raw_ref: submittedRaw })
    const canonicalRaw = canonicalRawReceipt(trusted, submittedRaw, rawHash)
    if (canonicalRaw === null) throw new Error('trusted raw ingress receipt does not bind canonical raw reference')
    const ingress = Object.freeze({ raw_receipt_id: input.raw_receipt_id, raw_ref: canonicalRaw, raw_hash: rawHash, correlation_id: input.correlation_id })
    await this.#reserveIngress(ingress)
    try {
      this.#failCommit?.(); this.#failSource?.(); this.#failAudit?.()
      return await this.#exclusive(async () => {
        const checkpointPublication = prepareOwnedPublication(input.checkpoint, checkpointMutation); const checkpoint = checkpointPublication.next
        this.#assertIngressFinalizable(ingress)
        const existing = this.#sources.find((source) => source.provider === normalized.provider && source.provider_record_id === normalized.provider_record_id && source.content_hash === rawHash)
        const source = existing ?? sourceSchema.parse({
        id: sourceId, schema_version: 1, created_at: createdAt, updated_at: updatedAt, provider: normalized.provider,
        provider_record_id: normalized.provider_record_id, canonical_url: normalized.canonical_url, raw_ref: canonicalRaw, captured_at: normalized.captured_at,
        content_hash: rawHash,
        supersedes_source_ref: this.#sources.filter((candidate) => candidate.provider === normalized.provider && candidate.provider_record_id === normalized.provider_record_id).at(-1) ? { type: 'source', id: this.#sources.filter((candidate) => candidate.provider === normalized.provider && candidate.provider_record_id === normalized.provider_record_id).at(-1)!.id } : null,
        author_ref: null, rights_state: normalized.rights_state, rights_basis: normalized.rights_basis, deletion_state: 'active',
        audit: { created_by: { type: 'service', id: INGEST_SERVICE_ID }, updated_by: { type: 'service', id: INGEST_SERVICE_ID }, correlation_id: input.correlation_id },
      })
        const event: AuditEvent = auditEventSchema.parse({ event_id: auditId, occurred_at: auditAt, actor: { type: 'service', id: INGEST_SERVICE_ID }, correlation_id: input.correlation_id, causation_id: null, entity: { type: 'source', id: source.id }, action: 'source.ingest.commit', outcome: 'allowed', before: null, after: { content_hash: rawHash, checkpoint_revision: String(checkpoint.revision) }, reason_code: input.partial ? 'partial' : null })
        if (!existing && this.#sources.some((candidate) => candidate.id === source.id)) throw new Error('source id collision')
        if (this.#audits.some((candidate) => candidate.event_id === event.event_id)) throw new Error('audit event id collision')
        const prepared = { result: deepImmutable({ status: existing ? 'duplicate' as const : 'created' as const, source, checkpoint }), source: existing ? undefined : source, event }
        if (prepared.source !== undefined) this.#sources.push(deepImmutable(prepared.source))
        this.#audits.push(deepImmutable(prepared.event))
        publishOwned(checkpointPublication)
        return prepared.result
      })
    } finally { await this.#releaseIngress(ingress) }
  }
  async commitPage(input: Readonly<{ checkpoint: CheckpointRepository; checkpoint_identity: string; expected_checkpoint_revision: number; checkpoint_next: CheckpointNext; aggregate_checkpoint?: CheckpointMutation; normalized: readonly NormalizedSourceRecord[]; raw_ref: ObjectRef; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; raw_hash: string; correlation_id: string; partial: boolean }>): Promise<SourcePageCommitResult> { return this.#commitPage(snapshotPageCommand(input)) }
  async #commitPage(input: PageCommand): Promise<SourcePageCommitResult> {
    if (input.raw_receipt_id.trim().length === 0) throw new Error('trusted raw ingress receipt is required')
    const normalizedRecords = snapshotNormalizedRecords(input.normalized); const submittedRaw = parsedRawRef(input.raw_ref); const rawHash = checkpointHash(input.raw_hash)
    assertOwnedCheckpoint(input.checkpoint)
    let canonicalRaw = submittedRaw
    let ingress: Readonly<{ raw_receipt_id: string; raw_ref: ObjectRef; raw_hash: string; correlation_id: string }> | undefined
    const prepare = (checkpoint: AcquisitionCheckpoint, aggregate_checkpoint?: AcquisitionCheckpoint): Readonly<{ result: SourcePageCommitResult; sources: readonly Source[]; events: readonly AuditEvent[] }> => {
      this.#assertIngressFinalizable(ingress!)
      const staged: Array<Readonly<{ status: 'created' | 'duplicate'; source: Source }>> = []
      for (const [index, normalized] of normalizedRecords.entries()) {
        const existing = this.#sources.find((source) => source.provider === normalized.provider && source.provider_record_id === normalized.provider_record_id && source.content_hash === rawHash) ?? staged.find((entry) => entry.source.provider === normalized.provider && entry.source.provider_record_id === normalized.provider_record_id && entry.source.content_hash === rawHash)?.source
        const predecessor = this.#sources.filter((candidate) => candidate.provider === normalized.provider && candidate.provider_record_id === normalized.provider_record_id).at(-1)
        const stage = sourceStages[index]!
        const source = existing ?? sourceSchema.parse({ id: stage.id, schema_version: 1, created_at: stage.created_at, updated_at: stage.updated_at, provider: normalized.provider, provider_record_id: normalized.provider_record_id, canonical_url: normalized.canonical_url, raw_ref: canonicalRaw, captured_at: normalized.captured_at, content_hash: rawHash, supersedes_source_ref: predecessor ? { type: 'source', id: predecessor.id } : null, author_ref: null, rights_state: normalized.rights_state, rights_basis: normalized.rights_basis, deletion_state: 'active', audit: { created_by: { type: 'service', id: INGEST_SERVICE_ID }, updated_by: { type: 'service', id: INGEST_SERVICE_ID }, correlation_id: input.correlation_id } })
        staged.push(Object.freeze({ status: existing ? 'duplicate' : 'created', source }))
      }
      const events: AuditEvent[] = staged.map(({ source }, index) => auditEventSchema.parse({ event_id: sourceStages[index]!.event_id, occurred_at: sourceStages[index]!.occurred_at, actor: { type: 'service', id: INGEST_SERVICE_ID }, correlation_id: input.correlation_id, causation_id: null, entity: { type: 'source', id: source.id }, action: 'source.ingest.commit', outcome: 'allowed', before: null, after: { content_hash: rawHash, checkpoint_revision: String(checkpoint.revision) }, reason_code: input.partial ? 'partial' : null }))
      const sourceIds = new Set(this.#sources.map((source) => source.id)); const auditIds = new Set(this.#audits.map((event) => event.event_id))
      for (const entry of staged) {
        if (entry.status === 'created' && sourceIds.has(entry.source.id)) throw new Error('source id collision')
        sourceIds.add(entry.source.id)
      }
      for (const event of events) {
        if (auditIds.has(event.event_id)) throw new Error('audit event id collision')
        auditIds.add(event.event_id)
      }
      return { result: deepImmutable({ statuses: staged.map((entry) => entry.status), source_ids: staged.map((entry) => entry.source.id), checkpoint, aggregate_checkpoint }), sources: staged.filter((entry) => entry.status === 'created').map((entry) => entry.source), events }
    }
    const unitMutation = snapshotCheckpointMutation({ identity: input.checkpoint_identity, expected_revision: input.expected_checkpoint_revision, next: input.checkpoint_next })
    const sourceStages = normalizedRecords.map(() => Object.freeze({ id: this.#sourceIdFactory(), created_at: this.#now(), updated_at: this.#now(), event_id: this.#auditIdFactory(), occurred_at: this.#now() }))
    try {
      const trusted = await input.raw_receipt_authority.resolve({ receipt_id: input.raw_receipt_id, actor_id: input.raw_receipt_actor_id, correlation_id: input.correlation_id, raw_ref: submittedRaw })
      const canonical = canonicalRawReceipt(trusted, submittedRaw, rawHash)
      if (canonical === null) throw new Error('trusted raw ingress receipt does not bind canonical raw reference')
      canonicalRaw = canonical; ingress = Object.freeze({ raw_receipt_id: input.raw_receipt_id, raw_ref: canonicalRaw, raw_hash: rawHash, correlation_id: input.correlation_id })
      await this.#reserveIngress(ingress)
      this.#failCommit?.(); for (const _record of normalizedRecords) this.#failSource?.(); this.#failAudit?.()
      return await this.#exclusive(async () => {
        const unitPublication = prepareOwnedPublication(input.checkpoint, unitMutation)
        const aggregatePublication = input.aggregate_checkpoint === undefined ? undefined : prepareOwnedPublication(input.checkpoint, snapshotCheckpointMutation(input.aggregate_checkpoint))
        if (aggregatePublication !== undefined && aggregatePublication.mutation.identity === unitPublication.mutation.identity) throw new Error('checkpoint pair identities must differ')
        const prepared = prepare(unitPublication.next, aggregatePublication?.next)
        this.#sources.push(...prepared.sources.map(deepImmutable)); this.#audits.push(...prepared.events.map(deepImmutable))
        publishOwned(unitPublication); if (aggregatePublication !== undefined) publishOwned(aggregatePublication)
        return prepared.result
      })
    } finally { if (ingress !== undefined) await this.#releaseIngress(ingress) }
  }
  async recordOrphan(input: Readonly<{ raw_ref: ObjectRef; raw_hash: string; reason: OrphanRecord['reason'] }>): Promise<void> { await this.#exclusive(async () => {
    this.#recordOrphanUnlocked(input)
  }) }
  #recordOrphanUnlocked(input: Readonly<{ raw_ref: ObjectRef; raw_hash: string; reason: OrphanRecord['reason'] }>): void {
    if (this.#orphanDeleteClaims.has(`${input.raw_ref.key}\u0000${input.raw_hash}`)) return
    if (this.#orphans.some((orphan) => orphan.raw_ref.key === input.raw_ref.key && orphan.raw_hash === input.raw_hash && orphan.reason === input.reason && orphan.retained)) return
    this.#orphans.push(deepImmutable({ raw_ref: input.raw_ref, raw_hash: input.raw_hash, reason: input.reason, retained: true, created_at: this.#now() }))
  }
  #ingressIdentity(input: Readonly<{ raw_receipt_id: string; raw_ref: ObjectRef; raw_hash: string; correlation_id: string }>): string {
    return `${input.raw_receipt_id}\u0000${input.correlation_id}\u0000${input.raw_ref.key}\u0000${input.raw_hash}`
  }
  #assertIngressOpen(input: Readonly<{ raw_receipt_id: string; raw_ref: ObjectRef; raw_hash: string; correlation_id: string }>): void {
    if (this.#ingressTerminal.has(this.#ingressIdentity(input))) throw new Error('raw ingress receipt was terminally quarantined by recovery')
  }
  async #reserveIngress(input: Readonly<{ raw_receipt_id: string; raw_ref: ObjectRef; raw_hash: string; correlation_id: string }>): Promise<void> {
    await this.#exclusive(async () => { const key = this.#ingressIdentity(input); this.#assertIngressOpen(input); if (this.#ingressInflight.has(key)) throw new Error('raw ingress receipt is already in flight'); this.#ingressInflight.add(key) })
  }
  async #releaseIngress(input: Readonly<{ raw_receipt_id: string; raw_ref: ObjectRef; raw_hash: string; correlation_id: string }>): Promise<void> {
    await this.#exclusive(async () => { this.#ingressInflight.delete(this.#ingressIdentity(input)) })
  }
  #assertIngressFinalizable(input: Readonly<{ raw_receipt_id: string; raw_ref: ObjectRef; raw_hash: string; correlation_id: string }>): void {
    this.#assertIngressOpen(input)
    if (!this.#ingressInflight.has(this.#ingressIdentity(input))) throw new Error('raw ingress reservation was lost')
  }
  async reconcilePendingRaw(input: Readonly<{ receipt_id: string; raw_ref: ObjectRef; raw_hash: string; correlation_id: string; eligible_for_orphan: boolean }>): Promise<'committed' | 'quarantined' | 'retained'> {
    return this.#exclusive(async () => {
      const source = this.#sources.find((entry) => entry.raw_ref.key === input.raw_ref.key && entry.content_hash === input.raw_hash)
      const commitAudit = source === undefined ? undefined : this.#audits.find((entry) =>
        entry.action === 'source.ingest.commit' && entry.entity.type === 'source' && entry.entity.id === source.id &&
        entry.correlation_id === input.correlation_id && entry.after?.content_hash === input.raw_hash)
      if (source !== undefined && commitAudit !== undefined) return 'committed'
      if (this.#ingressInflight.has(this.#ingressIdentity({ raw_receipt_id: input.receipt_id, raw_ref: input.raw_ref, raw_hash: input.raw_hash, correlation_id: input.correlation_id }))) return 'retained'
      const quarantined = this.#orphans.some((entry) => entry.raw_ref.key === input.raw_ref.key && entry.raw_hash === input.raw_hash && entry.retained) ||
        this.#audits.some((entry) => entry.action === 'source.ingest.quarantine' && entry.correlation_id === input.correlation_id && entry.after?.raw_hash === input.raw_hash)
      if (quarantined) return 'quarantined'
      if (!input.eligible_for_orphan) return 'retained'
      this.#recordOrphanUnlocked({ raw_ref: input.raw_ref, raw_hash: input.raw_hash, reason: 'write_plane_failure' })
      this.#ingressTerminal.add(this.#ingressIdentity({ raw_receipt_id: input.receipt_id, raw_ref: input.raw_ref, raw_hash: input.raw_hash, correlation_id: input.correlation_id }))
      return 'quarantined'
    })
  }
  async recordQuarantine(input: Readonly<{ raw_ref: ObjectRef; raw_hash: string; reason: 'provider_schema'; correlation_id: string }>): Promise<void> {
    await this.#exclusive(async () => {
      const hasOrphan = this.#orphans.some((orphan) => orphan.raw_ref.key === input.raw_ref.key && orphan.raw_hash === input.raw_hash && orphan.reason === input.reason && orphan.retained)
      const hasAudit = this.#audits.some((event) => event.action === 'source.ingest.quarantine' && event.outcome === 'failed' && event.reason_code === 'invalid_response' && event.correlation_id === input.correlation_id && event.after?.raw_hash === input.raw_hash)
      if (hasOrphan && hasAudit) return
      const event: AuditEvent = auditEventSchema.parse({ event_id: this.#auditIdFactory(), occurred_at: this.#now(), actor: { type: 'service', id: INGEST_SERVICE_ID }, correlation_id: input.correlation_id, causation_id: null, entity: { type: 'service', id: INGEST_SERVICE_ID }, action: 'source.ingest.quarantine', outcome: 'failed', before: null, after: { raw_hash: input.raw_hash }, reason_code: 'invalid_response' })
      if (this.#audits.some((existing) => existing.event_id === event.event_id)) throw new Error('audit event id collision')
      this.#failAudit?.()
      const orphan = Object.freeze({ raw_ref: input.raw_ref, raw_hash: input.raw_hash, reason: input.reason, retained: true, created_at: this.#now() })
      if (!hasOrphan) this.#orphans.push(orphan)
      if (!hasAudit) this.#audits.push(event)
    })
  }
  async commitQuarantinedFailure(input: Readonly<{ checkpoint: CheckpointRepository; unit_checkpoint: CheckpointMutation; aggregate_checkpoint: CheckpointMutation; raw_ref: ObjectRef; raw_hash: string; raw_receipt_id: string; raw_receipt_actor_id: string; raw_receipt_authority: RawReceiptAuthority; correlation_id: string; attempts: number }>): Promise<Readonly<{ unit_checkpoint: AcquisitionCheckpoint; aggregate_checkpoint: AcquisitionCheckpoint }>> { return this.#commitQuarantinedFailure(snapshotQuarantineCommand(input)) }
  async #commitQuarantinedFailure(input: QuarantineCommand): Promise<Readonly<{ unit_checkpoint: AcquisitionCheckpoint; aggregate_checkpoint: AcquisitionCheckpoint }>> {
    if (!Number.isInteger(input.attempts) || input.attempts < 1 || input.raw_receipt_id.trim().length === 0) throw new Error('quarantined terminal evidence is invalid')
    const submittedRaw = parsedRawRef(input.raw_ref); const rawHash = input.raw_hash
    const unitMutation = snapshotCheckpointMutation(input.unit_checkpoint); const aggregateMutation = snapshotCheckpointMutation(input.aggregate_checkpoint)
    assertOwnedCheckpoint(input.checkpoint)
    for (const mutation of [unitMutation, aggregateMutation]) {
      if (mutation.next.run_status !== 'partial' || mutation.next.unit_status !== 'failed' || mutation.next.stop_reason !== 'invalid_response' || mutation.next.attempt !== input.attempts)
        throw new Error('quarantined terminal checkpoint metadata is invalid')
    }
    // Receipt authorities are an external boundary. Validate before reserving the canonical receipt.
    const trusted = await input.raw_receipt_authority.resolve({ receipt_id: input.raw_receipt_id, actor_id: input.raw_receipt_actor_id, correlation_id: input.correlation_id, raw_ref: submittedRaw })
    const canonicalRaw = canonicalRawReceipt(trusted, submittedRaw, rawHash)
    if (canonicalRaw === null) throw new Error('quarantined terminal receipt does not bind canonical raw evidence')
    const orphan = Object.freeze({ raw_ref: canonicalRaw, raw_hash: rawHash, reason: 'provider_schema' as const, retained: true, created_at: this.#now() })
    const quarantineAudit: AuditEvent = auditEventSchema.parse({ event_id: this.#auditIdFactory(), occurred_at: this.#now(), actor: { type: 'service', id: INGEST_SERVICE_ID }, correlation_id: input.correlation_id, causation_id: null, entity: { type: 'service', id: INGEST_SERVICE_ID }, action: 'source.ingest.quarantine', outcome: 'failed', before: null, after: { raw_hash: rawHash }, reason_code: 'invalid_response' })
    const failureAudit: AuditEvent = auditEventSchema.parse({ event_id: this.#auditIdFactory(), occurred_at: this.#now(), actor: { type: 'service', id: INGEST_SERVICE_ID }, correlation_id: input.correlation_id, causation_id: null, entity: { type: 'service', id: INGEST_SERVICE_ID }, action: 'source.ingest.fetch', outcome: 'failed', before: null, after: { attempts: String(input.attempts), raw_hash: rawHash }, reason_code: 'invalid_response' })
    const ingress = Object.freeze({ raw_receipt_id: input.raw_receipt_id, raw_ref: canonicalRaw, raw_hash: rawHash, correlation_id: input.correlation_id })
    await this.#reserveIngress(ingress)
    try {
      this.#failAudit?.()
      return await this.#exclusive(async () => {
        const unitPublication = prepareOwnedPublication(input.checkpoint, unitMutation); const aggregatePublication = prepareOwnedPublication(input.checkpoint, aggregateMutation)
        if (unitPublication.mutation.identity === aggregatePublication.mutation.identity) throw new Error('checkpoint pair identities must differ')
        const unit_checkpoint = unitPublication.next; const aggregate_checkpoint = aggregatePublication.next
        this.#assertIngressFinalizable(ingress)
        if (this.#orphans.some((candidate) => candidate.raw_ref.key === canonicalRaw.key && candidate.raw_hash === rawHash && candidate.retained) || this.#audits.some((candidate) => candidate.event_id === quarantineAudit.event_id || candidate.event_id === failureAudit.event_id)) throw new Error('quarantined terminal evidence already exists')
        const prepared = { result: Object.freeze({ unit_checkpoint, aggregate_checkpoint }), orphan, audits: [quarantineAudit, failureAudit] }
        this.#orphans.push(deepImmutable(prepared.orphan)); this.#audits.push(...prepared.audits.map(deepImmutable))
        this.#ingressTerminal.add(this.#ingressIdentity(ingress))
        publishOwned(unitPublication); publishOwned(aggregatePublication)
        return prepared.result
      })
    } finally { await this.#releaseIngress(ingress) }
  }
  async commitTerminalFailure(input: Readonly<{ checkpoint: CheckpointRepository; unit_checkpoint: CheckpointMutation; aggregate_checkpoint: CheckpointMutation; correlation_id: string; reason: CheckpointStopReason; attempts: number }>): Promise<Readonly<{ unit_checkpoint: AcquisitionCheckpoint; aggregate_checkpoint: AcquisitionCheckpoint }>> {
    const command = snapshotTerminalCommand(input)
    return this.#commitTerminalFailure(command)
  }
  async #commitTerminalFailure(input: TerminalCommand): Promise<Readonly<{ unit_checkpoint: AcquisitionCheckpoint; aggregate_checkpoint: AcquisitionCheckpoint }>> {
    if (!Number.isInteger(input.attempts) || input.attempts < 1) throw new Error('terminal failure attempts are invalid')
    const unitMutation = snapshotCheckpointMutation(input.unit_checkpoint); const aggregateMutation = snapshotCheckpointMutation(input.aggregate_checkpoint)
    assertOwnedCheckpoint(input.checkpoint)
    for (const mutation of [unitMutation, aggregateMutation]) {
      if (mutation.next.run_status !== 'partial' || mutation.next.unit_status !== 'failed' || mutation.next.stop_reason !== input.reason || mutation.next.attempt !== input.attempts)
        throw new Error('terminal failure checkpoint metadata is invalid')
    }
    this.#failAudit?.()
    const failureAudit: AuditEvent = auditEventSchema.parse({ event_id: this.#auditIdFactory(), occurred_at: this.#now(), actor: { type: 'service', id: INGEST_SERVICE_ID }, correlation_id: input.correlation_id, causation_id: null, entity: { type: 'service', id: INGEST_SERVICE_ID }, action: 'source.ingest.fetch', outcome: 'failed', before: null, after: { attempts: String(input.attempts) }, reason_code: input.reason })
    return this.#exclusive(async () => {
      const unitPublication = prepareOwnedPublication(input.checkpoint, unitMutation); const aggregatePublication = prepareOwnedPublication(input.checkpoint, aggregateMutation)
      if (unitPublication.mutation.identity === aggregatePublication.mutation.identity) throw new Error('checkpoint pair identities must differ')
      const unit_checkpoint = unitPublication.next; const aggregate_checkpoint = aggregatePublication.next
      if (this.#audits.some((existing) => existing.event_id === failureAudit.event_id)) throw new Error('audit event id collision')
      this.#audits.push(deepImmutable(failureAudit)); publishOwned(unitPublication); publishOwned(aggregatePublication)
      return Object.freeze({ unit_checkpoint, aggregate_checkpoint })
    })
  }
  async reconcileOrphans(input: Readonly<{ strategy: 'retain' | 'delete'; now?: string; min_age_ms?: number; verify_raw?: (ref: ObjectRef) => Promise<boolean>; delete_raw?: (ref: ObjectRef) => Promise<void> }>): Promise<Readonly<{ retained: number; deleted: number }>> {
    if (input.strategy === 'retain') return this.#exclusive(async () => ({ retained: this.#orphans.filter((orphan) => orphan.retained).length, deleted: 0 }))
    if (!input.verify_raw || !input.delete_raw) return this.#exclusive(async () => ({ retained: this.#orphans.length, deleted: 0 }))
    const verifyRaw = input.verify_raw; const deleteRaw = input.delete_raw
    const now = Date.parse(input.now ?? this.#now()); const minAge = input.min_age_ms ?? 60_000
    // Verification can await storage, so take only a candidate snapshot here. Every destructive
    // decision is freshly revalidated under the same write-plane serialization as commits/orphans.
    const candidates = await this.#exclusive(async () => this.#orphans.filter((orphan) => this.#orphanEligible(orphan, now, minAge)))
    let deleted = 0
    for (const candidate of candidates) {
      if (!await verifyRaw(candidate.raw_ref)) continue
      const claimed = await this.#exclusive(async () => {
        const current = this.#orphans.find((orphan) => orphan === candidate)
        if (current === undefined || !this.#orphanEligible(current, now, minAge)) return false
        const key = `${current.raw_ref.key}\u0000${current.raw_hash}`
        if (this.#orphanDeleteClaims.has(key)) return false
        this.#orphanDeleteClaims.add(key)
        return true
      })
      if (!claimed) continue
      let deletedRaw = false
      try { await deleteRaw(candidate.raw_ref); deletedRaw = true } catch { /* claim is released below for retry */ }
      const removed = await this.#exclusive(async () => {
        const key = `${candidate.raw_ref.key}\u0000${candidate.raw_hash}`
        this.#orphanDeleteClaims.delete(key)
        if (!deletedRaw) return false
        const current = this.#orphans.find((orphan) => orphan === candidate)
        if (current === undefined || !this.#orphanEligible(current, now, minAge)) return false
        const index = this.#orphans.indexOf(current)
        if (index < 0) return false
        this.#orphans.splice(index, 1)
        return true
      })
      if (removed) deleted += 1
    }
    return this.#exclusive(async () => ({ retained: this.#orphans.length, deleted }))
  }
  #orphanEligible(orphan: OrphanRecord, now: number, minAge: number): boolean {
    if (!orphan.retained || orphan.raw_ref.content_hash !== orphan.raw_hash || !Number.isFinite(now) || now - Date.parse(orphan.created_at) < minAge) return false
    if (this.#sources.some((source) => source.raw_ref.key === orphan.raw_ref.key || source.content_hash === orphan.raw_hash)) return false
    // A new quarantine record for this evidence means another writer still retains it; never
    // delete bytes while any other active orphan points at the same immutable raw identity.
    return this.#orphans.filter((candidate) => candidate.raw_ref.key === orphan.raw_ref.key && candidate.raw_hash === orphan.raw_hash && candidate.retained).length === 1
  }
  sources(): readonly Source[] { return this.#sources.map(deepImmutable) }
  audits(): readonly AuditEvent[] { return this.#audits.map(deepImmutable) }
  orphans(): readonly OrphanRecord[] { return this.#orphans.map(deepImmutable) }
  artifacts(): readonly never[] { return [] }
  deletions(): readonly never[] { return [] }
  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#serial; let release!: () => void
    this.#serial = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
}
