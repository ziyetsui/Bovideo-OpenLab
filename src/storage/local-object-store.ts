import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { link, lstat, mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'

import type { ObjectPrincipal } from './policy'
import { decideObjectAccess, isObjectLifecycleReadable } from './policy'
import { objectRefSchema, type ObjectDeletionState, type ObjectNamespace, type ObjectRef } from './object-ref'
import { validateObjectUpload } from './upload-validation'

export type StoredObjectHead = Readonly<{ namespace: ObjectNamespace; content_hash: string; version: string; size_bytes: number; mime_type: string }>
export type StoredObject = Readonly<{ bytes: Uint8Array; head: StoredObjectHead }>
/** Private at-least-once deletion event; callers use `idempotency_key` to dedupe retries. */
export type DeletionLedgerEntry = Readonly<{ idempotency_key: string; deletion_request_id: string; correlation_id: string; ref: ObjectRef; namespace: ObjectNamespace; content_hash: string; reason: string }>
export type SignedReadCapability = Readonly<{ namespace: ObjectNamespace; key: string; content_hash: string; version: string; action: 'read'; principal_id: string; correlation_id: string; issued_at: string; expires_at: string; nonce: string; signature: string }>
/** Opaque receipt only; it intentionally contains no object key or public path. */
export type ObjectIngressReceipt = Readonly<{ receipt_id: string }>
export type ObjectIngressField = 'raw_ref' | 'object_ref'
export type RawIngressDisposition = 'pending' | 'claimed' | 'committed' | 'quarantined'
/** Ingest-internal recovery record; this is never a public read capability or object URL. */
export type PendingRawIngressReceipt = Readonly<{ receipt_id: string; ref: ObjectRef; actor_id: string; correlation_id: string; issued_at: string; disposition: 'pending' | 'claimed' }>

type DeletionPhase = 'pending_delete' | 'physical_delete_pending' | 'physically_deleted' | 'delivery_pending' | 'delivery_claimed' | 'delivered'
type DeletionFailpoint = 'after_pending_delete' | 'physical_delete' | 'after_physical_unlink' | 'after_deletion_state_save' | 'after_physical_delete' | 'before_delivery' | 'after_delivery_claim' | 'after_delivery_callback' | 'after_object_publish'
type DurabilityFailpoint = DeletionFailpoint | 'before_object_directory_sync' | 'before_state_directory_sync'
type DeletionIntent = Readonly<{ idempotency_key: string; request_id: string; ref: ObjectRef; reason: string; phase: DeletionPhase; attempts: number; error: string | null; delivery_claim_id: string | null; delivery_claimed_at: string | null; not_before: string | null }>
type PreparedOperation = Readonly<{ operation_id: string; kind: 'put' | 'delete'; phase: 'prepared' | 'filesystem_complete'; payload: string }>
type CapabilityNonce = Readonly<{ issued_at: string; expires_at: string; consumed_at: string | null }>
type IngressReceiptRecord = Readonly<{ ref_id: string; field: ObjectIngressField; actor_id: string; correlation_id: string; issued_at: string; disposition: RawIngressDisposition }>
type PersistentState = Readonly<{ format_version: 1; initialized: true; refs: Record<string, ObjectRef>; deletions: Record<string, DeletionIntent>; nonces: Record<string, CapabilityNonce>; receipts: Record<string, IngressReceiptRecord> }>
type StoreOptions = Readonly<{
  root_dir: string
  now?: () => number
  /** Required durable HMAC material; callers must supply production signer material. */
  signer_secret?: string
  on_delete?: (entry: DeletionLedgerEntry) => void | Promise<void>
  /** Test/configuration seam; the normal durable claim lease is 30 seconds. */
  delivery_claim_lease_ms?: number
  /** Lock-free observer seam. It runs only after durable state commits and all root locks release. */
  failpoint?: (phase: DurabilityFailpoint) => void | Promise<void>
  /** Strictly internal synchronous crash plan for durability tests; callbacks are never invoked under locks. */
  fault_plan?: readonly DurabilityFailpoint[]
}>

const MAX_CAPABILITY_TTL_MS = 5 * 60 * 1000
const STATE_FILE = '.p1-object-store-state.json'
const INITIALIZED_FILE = '.p1-object-store-initialized'
const CONTROL_JOURNAL_FILE = '.p1-object-store-control.sqlite'
const ROOT_LOCK_FILE = '.p1-object-store-lock.sqlite'
const phases = new Set<DeletionPhase>(['pending_delete', 'physical_delete_pending', 'physically_deleted', 'delivery_pending', 'delivery_claimed', 'delivered'])
const phasesForFailpoints = new Set<DurabilityFailpoint>(['after_pending_delete', 'physical_delete', 'after_physical_unlink', 'after_deletion_state_save', 'after_physical_delete', 'before_delivery', 'after_delivery_claim', 'after_delivery_callback', 'after_object_publish', 'before_object_directory_sync', 'before_state_directory_sync'])
const DELIVERY_LEASE_MS = 30_000
const emptyState = (): PersistentState => ({ format_version: 1, initialized: true, refs: {}, deletions: {}, nonces: {}, receipts: {} })
const refId = (ref: ObjectRef): string => `${ref.namespace}\u0000${ref.key}`
const sameIdentity = (left: Pick<ObjectRef, 'namespace' | 'key' | 'content_hash' | 'version'>, right: Pick<ObjectRef, 'namespace' | 'key' | 'content_hash' | 'version'>): boolean => left.namespace === right.namespace && left.key === right.key && left.content_hash === right.content_hash && left.version === right.version
const sameImmutableRef = (left: ObjectRef, right: ObjectRef): boolean =>
  sameIdentity(left, right) && left.bucket_class === right.bucket_class && left.size_bytes === right.size_bytes &&
  left.mime_type === right.mime_type && left.rights_state === right.rights_state && left.deletion_state === right.deletion_state
const headFor = (ref: ObjectRef): StoredObjectHead => Object.freeze({ namespace: ref.namespace, content_hash: ref.content_hash, version: ref.version, size_bytes: ref.size_bytes, mime_type: ref.mime_type })
const capabilityPayload = (capability: Omit<SignedReadCapability, 'signature'>): string => [capability.namespace, capability.key, capability.content_hash, capability.version, capability.action, capability.principal_id, capability.correlation_id, capability.issued_at, capability.expires_at, capability.nonce].join('\n')
const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`object store state is corrupt: ${label}`)
  return value as Record<string, unknown>
}
const timestamp = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`object store state is corrupt: ${label}`)
  return value
}
const receiptFieldAccepts = (field: ObjectIngressField, ref: ObjectRef): boolean =>
  field === 'raw_ref' ? ref.namespace === 'raw-evidence' : ref.namespace === 'public-media'

const rootMutexes = new Map<string, Promise<void>>()
const acquireRootMutex = async (root: string): Promise<() => void> => {
  const previous = rootMutexes.get(root) ?? Promise.resolve()
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => held)
  rootMutexes.set(root, tail)
  await previous
  return () => {
    release()
    if (rootMutexes.get(root) === tail) rootMutexes.delete(root)
  }
}

/** Local-only private adapter with durable state, symlink rejection, and no public URL/path surface. */
export class LocalObjectStore {
  private readonly root: string
  private readonly now: () => number
  private readonly operationNow = new AsyncLocalStorage<number>()
  private readonly signerSecret: string
  private readonly onDelete?: StoreOptions['on_delete']
  private readonly failpoint?: StoreOptions['failpoint']
  private readonly deliveryClaimLeaseMs: number
  private readonly faultPlan: ReadonlySet<DurabilityFailpoint>
  /** Per-operation observer queue. Injected callbacks must never execute under the root lock. */
  private readonly deferredFailpoints = new AsyncLocalStorage<DurabilityFailpoint[]>()

  constructor(options: StoreOptions) {
    if (typeof options.signer_secret !== 'string' || options.signer_secret.trim().length === 0) throw new Error('a durable object-store signer_secret is required')
    this.root = resolve(options.root_dir)
    const clock = options.now ?? Date.now
    this.now = () => this.operationNow.getStore() ?? clock()
    this.signerSecret = options.signer_secret
    this.onDelete = options.on_delete
    this.failpoint = options.failpoint
    if (options.fault_plan !== undefined && (!Array.isArray(options.fault_plan) || options.fault_plan.some((phase) => !phasesForFailpoints.has(phase)))) throw new Error('object-store fault plan is invalid')
    this.faultPlan = new Set(options.fault_plan ?? [])
    if (options.delivery_claim_lease_ms !== undefined && (!Number.isSafeInteger(options.delivery_claim_lease_ms) || options.delivery_claim_lease_ms < 20 || options.delivery_claim_lease_ms > DELIVERY_LEASE_MS)) throw new Error('delivery claim lease must be between 20ms and 30 seconds')
    this.deliveryClaimLeaseMs = options.delivery_claim_lease_ms ?? DELIVERY_LEASE_MS
  }

  async write(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; bytes: Uint8Array }>): Promise<StoredObjectHead> {
    const head = await this.withRootTransaction('put', async () => {
    const supplied = objectRefSchema.parse(input.ref)
    let state = await this.loadState({ allowInitialize: true })
    const stateWasPersisted = await this.stateFileExists()
    const known = state.refs[refId(supplied)]
    const ref = known ?? supplied
    if (known !== undefined && !sameIdentity(ref, supplied)) throw new Error('stored object identity mismatch')
    this.assertAllowed(input.principal, ref, 'write')
    validateObjectUpload({ namespace: ref.namespace, key: ref.key, bytes: input.bytes, declared_size: ref.size_bytes, declared_hash: ref.content_hash, declared_mime_type: ref.mime_type, rights_state: ref.rights_state, deletion_state: ref.deletion_state })
    const target = await this.safeObjectPath(ref, true)
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(input.bytes); await handle.sync() } finally { await handle.close() }
    const operationID = this.prepareOperation('put', { ref })
    try {
      const latest = stateWasPersisted ? await this.loadState() : state
      const current = latest.refs[refId(ref)]
      if (current !== undefined && (!sameIdentity(current, ref) || !isObjectLifecycleReadable(current))) throw new Error('object lifecycle changed before publish')
      await link(temporary, target)
      await unlink(temporary)
      await this.syncDirectory(dirname(target), 'before_object_directory_sync')
      this.advanceOperation(operationID, 'filesystem_complete')
    } catch (error) {
      await rm(temporary, { force: true })
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      state = await this.loadState()
      const registered = state.refs[refId(ref)]
      if (registered === undefined || !sameIdentity(registered, ref)) throw new Error('untracked object exists at content-addressed target')
      const existing = new Uint8Array(await readFile(await this.safeObjectPath(registered, false)))
      if (existing.byteLength !== input.bytes.byteLength || !existing.every((value, index) => value === input.bytes[index])) throw new Error('content-addressed object collision mismatch')
    }
    state = stateWasPersisted ? await this.loadState() : state
    const authoritative = state.refs[refId(ref)]
    if (authoritative !== undefined && (!sameIdentity(authoritative, ref) || !isObjectLifecycleReadable(authoritative))) throw new Error('object lifecycle changed before state commit')
    await this.saveState({ ...state, refs: { ...state.refs, [refId(ref)]: ref } })
    this.completeOperation(operationID)
    return headFor(ref)
    })
    // Observers/failpoints are untrusted and may reenter this store. The durable object and its
    // authoritative state are already committed, so invoking after publication cannot hold root lock.
    this.throwPlannedFault('after_object_publish')
    await this.failpoint?.('after_object_publish')
    return head
  }

  async get(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; capability?: SignedReadCapability; correlation_id?: string }>): Promise<StoredObject> {
    return this.withRootTransaction('read', async () => {
    let ref = await this.currentRef(input.ref)
    if (input.capability === undefined) this.assertAllowed(input.principal, ref, 'read')
    else ref = await this.consumeCapability(input.capability, input.principal, ref, input.correlation_id)
    const bytes = new Uint8Array(await readFile(await this.safeObjectPath(ref, false)))
    if (bytes.byteLength !== ref.size_bytes) throw new Error('stored object length mismatch')
    validateObjectUpload({ namespace: ref.namespace, key: ref.key, bytes, declared_size: ref.size_bytes, declared_hash: ref.content_hash, declared_mime_type: ref.mime_type, rights_state: ref.rights_state, deletion_state: ref.deletion_state })
    return Object.freeze({ bytes, head: headFor(ref) })
    })
  }

  async head(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef }>): Promise<StoredObjectHead | null> {
    return this.withRootTransaction('head', async () => {
    const ref = await this.currentRef(input.ref)
    this.assertAllowed(input.principal, ref, 'head')
    try { const file = await lstat(await this.safeObjectPath(ref, false)); return !file.isSymbolicLink() && file.isFile() && file.size === ref.size_bytes ? headFor(ref) : null } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    })
  }

  async delete(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; reason: string; idempotency_key?: string; deletion_request_id?: string }>): Promise<void> {
    const idempotencyKey = await this.withRootTransaction('delete-mark', async () => {
    const ref = await this.currentRef(input.ref)
    this.assertAllowed(input.principal, ref, 'delete')
    if (input.reason.trim().length === 0) throw new Error('deletion reason is required')
    const requestID = input.deletion_request_id?.trim() || input.idempotency_key?.trim() || `implicit:${ref.version}:${ref.content_hash}:${input.reason}`
    const idempotencyKey = `delete:${ref.namespace}:${ref.key}:${ref.content_hash}:${ref.version}:${requestID}`
    const state = await this.loadState()
    const removed = objectRefSchema.parse({ ...ref, deletion_state: 'removed' })
    const existing = state.deletions[idempotencyKey]
    if (existing !== undefined && (!sameImmutableRef(existing.ref, removed) || existing.reason !== input.reason || existing.request_id !== requestID)) throw new Error('deletion idempotency key conflicts with immutable identity')
    const intent = existing ?? { idempotency_key: idempotencyKey, request_id: requestID, ref: removed, reason: input.reason, phase: 'pending_delete' as const, attempts: 0, error: null, delivery_claim_id: null, delivery_claimed_at: null, not_before: null }
    await this.saveState({ ...state, refs: { ...state.refs, [refId(ref)]: removed }, deletions: { ...state.deletions, [idempotencyKey]: intent } })
    this.triggerFailpoint('after_pending_delete')
    return idempotencyKey
    })
    await this.progressDeletion(idempotencyKey)
  }

  async list(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef }>): Promise<readonly StoredObjectHead[]> {
    return this.withRootTransaction('list', async () => {
    const ref = await this.currentRef(input.ref)
    this.assertAllowed(input.principal, ref, 'list')
    await this.safeObjectPath(ref, false)
    const prefix = dirname(ref.key)
    const state = await this.loadState()
    return Object.freeze(Object.values(state.refs).filter((candidate) => candidate.namespace === ref.namespace && isObjectLifecycleReadable(candidate) && dirname(candidate.key) === prefix).map(headFor))
    })
  }

  async setLifecycle(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; deletion_state?: ObjectDeletionState; rights_state?: ObjectRef['rights_state'] }>): Promise<ObjectRef> {
    return this.withRootTransaction('lifecycle', async () => {
    const current = await this.currentRef(input.ref)
    this.assertAllowed(input.principal, current, 'delete')
    const updated = objectRefSchema.parse({ ...current, deletion_state: input.deletion_state ?? current.deletion_state, rights_state: input.rights_state ?? current.rights_state })
    const state = await this.loadState()
    await this.saveState({ ...state, refs: { ...state.refs, [refId(current)]: updated } })
    return updated
    })
  }

  async retryPendingDeletions(): Promise<Readonly<{ completed: number; failed: number }>> {
    const pending = await this.withRootTransaction('delete-retry-list', async () => Object.values((await this.loadState()).deletions).filter((intent) => intent.phase !== 'delivered').map((intent) => intent.idempotency_key))
    let completed = 0; let failed = 0
    for (const idempotencyKey of pending) {
      try { await this.progressDeletion(idempotencyKey); completed += 1 } catch { failed += 1 }
    }
    return Object.freeze({ completed, failed })
  }

  async issueReadCapability(input: Readonly<{ issuer: ObjectPrincipal; ref: ObjectRef; principal_id: string; correlation_id: string; ttl_ms: number }>): Promise<SignedReadCapability> {
    return this.withRootTransaction('nonce-issue', async () => {
    const ref = await this.currentRef(input.ref)
    this.assertAllowed(input.issuer, ref, 'issue_read_capability')
    if (!Number.isSafeInteger(input.ttl_ms) || input.ttl_ms <= 0 || input.ttl_ms > MAX_CAPABILITY_TTL_MS) throw new Error('capability TTL must be within five minutes')
    if (input.principal_id.length === 0 || input.correlation_id.length === 0) throw new Error('capability principal and correlation are required')
    const issuedAt = new Date(this.now()).toISOString()
    const unsigned = { namespace: ref.namespace, key: ref.key, content_hash: ref.content_hash, version: ref.version, action: 'read' as const, principal_id: input.principal_id, correlation_id: input.correlation_id, issued_at: issuedAt, expires_at: new Date(this.now() + input.ttl_ms).toISOString(), nonce: randomUUID() }
    const state = this.pruneNonces(await this.loadState())
    await this.saveState({ ...state, nonces: { ...state.nonces, [unsigned.nonce]: { issued_at: unsigned.issued_at, expires_at: unsigned.expires_at, consumed_at: null } } })
    return Object.freeze({ ...unsigned, signature: this.sign(unsigned) })
    })
  }

  /** Issues a server-side receipt only after an authoritative validated object put. */
  async putForIngress(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; bytes: Uint8Array; field: ObjectIngressField; actor_id: string; correlation_id: string }>): Promise<ObjectIngressReceipt> {
    await this.write(input)
    return this.issueIngressReceipt({ principal: input.principal, ref: input.ref, field: input.field, actor_id: input.actor_id, correlation_id: input.correlation_id })
  }

  async issueIngressReceipt(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; field: ObjectIngressField; actor_id: string; correlation_id: string }>): Promise<ObjectIngressReceipt> {
    return this.withRootTransaction('receipt-issue', async () => {
    const ref = await this.currentRef(input.ref)
    this.assertAllowed(input.principal, ref, 'head')
    if (!isObjectLifecycleReadable(ref) || !receiptFieldAccepts(input.field, ref)) throw new Error('object cannot issue an ingress receipt for this field')
    if (input.actor_id.trim().length === 0 || input.correlation_id.trim().length === 0) throw new Error('ingress receipt actor and correlation are required')
    const receiptID = randomUUID()
    const state = await this.loadState()
    await this.saveState({ ...state, receipts: { ...state.receipts, [receiptID]: { ref_id: refId(ref), field: input.field, actor_id: input.actor_id, correlation_id: input.correlation_id, issued_at: new Date(this.now()).toISOString(), disposition: 'pending' } } })
    return Object.freeze({ receipt_id: receiptID })
    })
  }

  /** Internal authoritative lookup used by receipt-bound Payload commands. */
  async resolveIngressReceipt(input: Readonly<{ receipt_id: string; field: ObjectIngressField; actor_id: string; correlation_id: string }>): Promise<ObjectRef | null> {
    return this.withRootTransaction('receipt-resolve', async () => {
    const state = await this.loadState()
    const receipt = state.receipts[input.receipt_id]
    if (receipt === undefined || receipt.field !== input.field || receipt.actor_id !== input.actor_id || receipt.correlation_id !== input.correlation_id) return null
    if (input.field === 'raw_ref' && receipt.disposition !== 'pending') return null
    const ref = state.refs[receipt.ref_id]
    if (ref === undefined || !receiptFieldAccepts(input.field, ref) || !isObjectLifecycleReadable(ref)) return null
    try {
      const bytes = new Uint8Array(await readFile(await this.safeObjectPath(ref, false)))
      if (bytes.byteLength !== ref.size_bytes) return null
      validateObjectUpload({ namespace: ref.namespace, key: ref.key, bytes, declared_size: ref.size_bytes, declared_hash: ref.content_hash, declared_mime_type: ref.mime_type, rights_state: ref.rights_state, deletion_state: ref.deletion_state })
      if (input.field === 'raw_ref') await this.saveState({ ...state, receipts: { ...state.receipts, [input.receipt_id]: { ...receipt, disposition: 'claimed' } } })
      return ref
    } catch {
      return null
    }
    })
  }

  /** Restricted recovery query for raw evidence that has not reached a durable ingest disposition. */
  async listPendingRawIngressReceipts(input: Readonly<{ principal: ObjectPrincipal }>): Promise<readonly PendingRawIngressReceipt[]> {
    return this.withRootTransaction('raw-ingress-pending-list', async () => {
      if (input.principal.kind !== 'service' || !input.principal.serviceScopes.includes('ingest')) throw new Error('pending raw ingress recovery requires ingest service authority')
      const state = await this.loadState()
      return Object.freeze(Object.entries(state.receipts).flatMap(([receipt_id, receipt]) => {
        const ref = state.refs[receipt.ref_id]
        return receipt.field === 'raw_ref' && (receipt.disposition === 'pending' || receipt.disposition === 'claimed') && ref !== undefined ? [Object.freeze({ receipt_id, ref, actor_id: receipt.actor_id, correlation_id: receipt.correlation_id, issued_at: receipt.issued_at, disposition: receipt.disposition })] : []
      }))
    })
  }

  /** Restricted state transition; disposition never changes the opaque receipt's object binding. */
  async markRawIngressReceiptDisposition(input: Readonly<{ principal: ObjectPrincipal; receipt_id: string; disposition: Exclude<RawIngressDisposition, 'pending'> }>): Promise<void> {
    await this.withRootTransaction('raw-ingress-disposition', async () => {
      if (input.principal.kind !== 'service' || !input.principal.serviceScopes.includes('ingest')) throw new Error('raw ingress disposition requires ingest service authority')
      const state = await this.loadState(); const receipt = state.receipts[input.receipt_id]
      if (receipt === undefined || receipt.field !== 'raw_ref') throw new Error('raw ingress receipt is not available for disposition')
      if (receipt.disposition === input.disposition) return
      if (input.disposition === 'committed' && receipt.disposition !== 'claimed') throw new Error('raw ingress receipt must be claimed before commit')
      if (input.disposition === 'quarantined' && receipt.disposition !== 'pending' && receipt.disposition !== 'claimed') throw new Error('raw ingress receipt disposition is immutable')
      await this.saveState({ ...state, receipts: { ...state.receipts, [input.receipt_id]: { ...receipt, disposition: input.disposition } } })
    })
  }

  private async progressDeletion(idempotencyKey: string): Promise<void> {
    const claim = await this.withRootTransaction('delete-progress', async () => this.advanceDeletionAndClaim(idempotencyKey))
    if (claim !== null) await this.deliverDeletionClaim(claim)
  }

  private async advanceDeletionAndClaim(idempotencyKey: string): Promise<Readonly<{ idempotency_key: string; claim_id: string; entry: DeletionLedgerEntry }> | null> {
    let state = await this.loadState()
    let intent = state.deletions[idempotencyKey]
    if (intent === undefined || intent.phase === 'delivered') return null
    if (intent.phase === 'pending_delete') {
      intent = { ...intent, phase: 'physical_delete_pending', error: null }
      state = { ...state, deletions: { ...state.deletions, [idempotencyKey]: intent } }
      await this.saveState(state)
    }
    if (intent.phase === 'physical_delete_pending') {
      const operationID = this.prepareOperation('delete', { idempotency_key: idempotencyKey, ref: intent.ref })
      let deletionStateSaved = false
      try {
        const current = state.refs[refId(intent.ref)]
        if (current === undefined || !sameImmutableRef(current, intent.ref) || current.deletion_state !== 'removed') throw new Error('deletion intent immutable identity is no longer authoritative')
        const target = await this.safeObjectPath(intent.ref, false)
        this.triggerFailpoint('physical_delete')
        try { await rm(target); await this.syncDirectory(dirname(target), 'before_object_directory_sync') } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          if (!sameImmutableRef(current, intent.ref) || current.deletion_state !== 'removed') throw new Error('missing object identity cannot be established')
        }
        this.advanceOperation(operationID, 'filesystem_complete')
        this.triggerFailpoint('after_physical_unlink')
        intent = { ...intent, phase: 'physically_deleted', attempts: intent.attempts + 1, error: null }
        state = { ...state, deletions: { ...state.deletions, [idempotencyKey]: intent } }
        await this.saveState(state)
        deletionStateSaved = true
        // Deliberately between durable state and journal completion: recovery must accept this later phase.
        this.triggerFailpoint('after_deletion_state_save')
        this.completeOperation(operationID)
        this.triggerFailpoint('after_physical_delete')
      } catch (error) {
        if (deletionStateSaved) throw error
        const failed = { ...intent, phase: 'physical_delete_pending' as const, attempts: intent.attempts + 1, error: error instanceof Error ? error.message : 'physical deletion failed' }
        await this.saveState({ ...state, deletions: { ...state.deletions, [idempotencyKey]: failed } })
        throw error
      }
    }
    if (intent.phase === 'physically_deleted') {
      intent = { ...intent, phase: 'delivery_pending', error: null }
      state = { ...state, deletions: { ...state.deletions, [idempotencyKey]: intent } }
      await this.saveState(state)
      this.triggerFailpoint('before_delivery')
    }
    if (intent.phase === 'delivery_claimed' && intent.delivery_claimed_at !== null && Date.parse(intent.delivery_claimed_at) + this.deliveryClaimLeaseMs <= this.now()) {
      intent = { ...intent, phase: 'delivery_pending', delivery_claim_id: null, delivery_claimed_at: null, error: 'delivery claim lease expired', not_before: new Date(this.now()).toISOString() }
      state = { ...state, deletions: { ...state.deletions, [idempotencyKey]: intent } }
      await this.saveState(state)
    }
    if (intent.phase !== 'delivery_pending' || (intent.not_before !== null && Date.parse(intent.not_before) > this.now())) return null
    await this.assertDeletionAbsent(state, intent)
    const claimID = randomUUID()
    intent = { ...intent, phase: 'delivery_claimed', attempts: intent.attempts + 1, error: null, delivery_claim_id: claimID, delivery_claimed_at: new Date(this.now()).toISOString(), not_before: null }
    await this.saveState({ ...state, deletions: { ...state.deletions, [idempotencyKey]: intent } })
    this.triggerFailpoint('after_delivery_claim')
    return Object.freeze({ idempotency_key: idempotencyKey, claim_id: claimID, entry: Object.freeze({ idempotency_key: idempotencyKey, deletion_request_id: intent.request_id, correlation_id: intent.request_id, ref: intent.ref, namespace: intent.ref.namespace, content_hash: intent.ref.content_hash, reason: intent.reason }) })
  }

  private async deliverDeletionClaim(claim: Readonly<{ idempotency_key: string; claim_id: string; entry: DeletionLedgerEntry }>): Promise<void> {
    const stopHeartbeat = this.startDeletionClaimHeartbeat(claim)
    try {
      await this.onDelete?.(claim.entry)
      // The heartbeat remains active while this seam and the durable acknowledgement wait.
      // A live callback must not lose its claim merely because acknowledgement is delayed.
      this.throwPlannedFault('after_delivery_callback')
      await this.failpoint?.('after_delivery_callback')
      const acknowledged = await this.withRootTransaction('delete-delivery-ack', async () => this.finishDeletionClaim(claim, true))
      if (!acknowledged) throw new Error('deletion claim is no longer current during acknowledgement')
    } catch (error) {
      try {
        // Even a test crash seam is locally recorded as retryable before its heartbeat stops.
        await this.withRootTransaction('delete-delivery-retry', async () => this.finishDeletionClaim(claim, false, error))
      } finally {
        await stopHeartbeat()
      }
      throw error
    }
    await stopHeartbeat()
  }

  /** Keeps a live callback's private claim from being stolen; crash stops this timer and preserves retry. */
  private startDeletionClaimHeartbeat(claim: Readonly<{ idempotency_key: string; claim_id: string; entry: DeletionLedgerEntry }>): () => Promise<void> {
    const interval = Math.max(5, Math.floor(this.deliveryClaimLeaseMs / 3))
    let stopped = false
    const inFlight = new Set<Promise<void>>()
    const renew = (): void => {
      if (stopped) return
      const task = this.withRootTransaction('delete-delivery-heartbeat', async () => this.renewDeletionClaim(claim))
        .catch(() => { /* acknowledgement still validates the original claim */ })
        .finally(() => { inFlight.delete(task) })
      inFlight.add(task)
    }
    const timer = setInterval(() => {
      renew()
    }, interval)
    return async () => {
      stopped = true
      clearInterval(timer)
      await Promise.all([...inFlight])
    }
  }

  private async renewDeletionClaim(claim: Readonly<{ idempotency_key: string; claim_id: string }>): Promise<void> {
    const state = await this.loadState()
    const intent = state.deletions[claim.idempotency_key]
    if (intent === undefined || intent.phase !== 'delivery_claimed' || intent.delivery_claim_id !== claim.claim_id) return
    await this.assertDeletionAbsent(state, intent)
    const renewed = { ...intent, delivery_claimed_at: new Date(this.now()).toISOString() }
    await this.saveState({ ...state, deletions: { ...state.deletions, [claim.idempotency_key]: renewed } })
  }

  private async finishDeletionClaim(claim: Readonly<{ idempotency_key: string; claim_id: string; entry: DeletionLedgerEntry }>, acknowledged: boolean, failure?: unknown): Promise<boolean> {
    const state = await this.loadState()
    const intent = state.deletions[claim.idempotency_key]
    if (intent === undefined || intent.phase !== 'delivery_claimed' || intent.delivery_claim_id !== claim.claim_id) return false
    if (!acknowledged) {
      const retryable = { ...intent, phase: 'delivery_pending' as const, delivery_claim_id: null, delivery_claimed_at: null, not_before: new Date(this.now()).toISOString(), error: failure instanceof Error ? failure.message : 'deletion callback failed' }
      await this.saveState({ ...state, deletions: { ...state.deletions, [claim.idempotency_key]: retryable } })
      return true
    }
    await this.assertDeletionAbsent(state, intent)
    const delivered = { ...intent, phase: 'delivered' as const, delivery_claim_id: null, delivery_claimed_at: null, not_before: null, error: null }
    await this.saveState({ ...state, deletions: { ...state.deletions, [claim.idempotency_key]: delivered } })
    return true
  }

  private async assertDeletionAbsent(state: PersistentState, intent: DeletionIntent): Promise<void> {
    const current = state.refs[refId(intent.ref)]
    if (current === undefined || !sameImmutableRef(current, intent.ref) || current.deletion_state !== 'removed') throw new Error('deletion callback lacks an authoritative tombstone')
    const target = await this.safeObjectPath(intent.ref, false)
    try {
      const entry = await lstat(target)
      if (entry.isSymbolicLink()) throw new Error('symlinked object target is denied')
      throw new Error('deletion callback blocked until object bytes are absent')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private assertAllowed(principal: ObjectPrincipal, ref: ObjectRef, action: 'read' | 'write' | 'head' | 'list' | 'delete' | 'issue_read_capability'): void { const decision = decideObjectAccess({ principal, ref, action, channel: 'internal' }); if (!decision.allowed) throw new Error(`object access denied: ${decision.reason}`) }
  private async consumeCapability(capability: SignedReadCapability, principal: ObjectPrincipal, suppliedRef: ObjectRef, correlationID: string | undefined): Promise<ObjectRef> {
    const { signature: _signature, ...unsigned } = capability
    if (capability.action !== 'read' || !sameIdentity(capability, suppliedRef)) throw new Error('capability ref scope mismatch')
    if (capability.principal_id !== principal.id) throw new Error('capability principal mismatch')
    if (capability.correlation_id !== correlationID) throw new Error('capability correlation mismatch')
    if (!Number.isFinite(Date.parse(capability.issued_at)) || !Number.isFinite(Date.parse(capability.expires_at)) || Date.parse(capability.issued_at) > this.now() || Date.parse(capability.expires_at) <= this.now()) throw new Error('capability expired')
    const expected = this.sign(unsigned); const provided = Buffer.from(capability.signature, 'hex'); const actual = Buffer.from(expected, 'hex')
    if (provided.length !== actual.length || !timingSafeEqual(provided, actual)) throw new Error('capability signature mismatch')
    let state = this.pruneNonces(await this.loadState())
    const ref = state.refs[refId(suppliedRef)]
    if (ref === undefined || !sameIdentity(ref, suppliedRef) || !isObjectLifecycleReadable(ref)) throw new Error('object access denied: deleted_or_revoked')
    const nonce = state.nonces[capability.nonce]
    if (nonce === undefined) throw new Error('capability nonce is unknown or expired')
    if (nonce.issued_at !== capability.issued_at || nonce.expires_at !== capability.expires_at) throw new Error('capability nonce metadata mismatch')
    if (nonce.consumed_at !== null) throw new Error('capability replay detected')
    state = { ...state, nonces: { ...state.nonces, [capability.nonce]: { ...nonce, consumed_at: new Date(this.now()).toISOString() } } }
    await this.saveState(state)
    return ref
  }
  private sign(capability: Omit<SignedReadCapability, 'signature'>): string { return createHmac('sha256', this.signerSecret).update(capabilityPayload(capability)).digest('hex') }
  /** Records an observer for delivery after the root transaction commits and releases its locks. */
  private triggerFailpoint(phase: DurabilityFailpoint): void {
    this.throwPlannedFault(phase)
    const pending = this.deferredFailpoints.getStore()
    if (pending === undefined) throw new Error('durability observer was invoked outside a root transaction')
    pending.push(phase)
  }
  private throwPlannedFault(phase: DurabilityFailpoint): void {
    if (this.faultPlan.has(phase)) throw new Error(`injected durability fault: ${phase}`)
  }
  private async withRootTransaction<T>(kind: string, operation: () => Promise<T>): Promise<T> {
    const observers: DurabilityFailpoint[] = []
    // Sample injected time before taking either the process mutex or SQLite transaction. All
    // timestamps written by one root operation then use this immutable value.
    const sampledNow = this.now()
    const result = await this.operationNow.run(sampledNow, async () => this.deferredFailpoints.run(observers, async () => {
      const release = await acquireRootMutex(this.root)
      let rootLock: DatabaseSync | undefined
      try {
        await this.assertSafeDirectory(this.root, true)
        this.ensureControlJournal()
        rootLock = this.openRootLock()
        // This OS-held SQLite write transaction has no lease and is released by a crash.
        // The control journal remains a separate durable database so prepared records commit
        // before filesystem mutations while this lock remains held.
        rootLock.exec('BEGIN IMMEDIATE')
        await this.recoverPreparedOperations()
        const value = await operation()
        rootLock.exec('COMMIT')
        return value
      } catch (error) {
        try { rootLock?.exec('ROLLBACK') } catch { /* transaction may already be closed */ }
        throw error
      } finally {
        rootLock?.close()
        release()
      }
    }))
    // Observer code is deliberately the final phase: durable state has committed and no local or
    // SQLite lock remains held, so it may await/re-enter safely. A thrown observer still models an
    // interrupted caller; restart recovery relies only on the already durable state machine.
    for (const phase of observers) await this.failpoint?.(phase)
    return result
  }

  /** SQLite transactions only protect their synchronous journal mutation; never await under one. */
  private openControlJournal(): DatabaseSync {
    const journalPath = join(this.root, CONTROL_JOURNAL_FILE)
    const journal = new DatabaseSync(journalPath, { timeout: 5000, enableForeignKeyConstraints: true })
    journal.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS control_journal (operation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, phase TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL DEFAULT \'{}\');')
    return journal
  }
  private ensureControlJournal(): void {
    const journalPath = join(this.root, CONTROL_JOURNAL_FILE)
    try { if (lstatSync(journalPath).isSymbolicLink()) throw new Error('symlinked object-store control journal is denied') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const journal = this.openControlJournal()
    try {
      const columns = journal.prepare('PRAGMA table_info(control_journal)').all() as unknown as readonly { name: string }[]
      if (!columns.some((column) => column.name === 'payload')) journal.exec("ALTER TABLE control_journal ADD COLUMN payload TEXT NOT NULL DEFAULT '{}'")
    } finally { journal.close() }
  }
  private openRootLock(): DatabaseSync {
    const lockPath = join(this.root, ROOT_LOCK_FILE)
    try { if (lstatSync(lockPath).isSymbolicLink()) throw new Error('symlinked object-store root lock is denied') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const lock = new DatabaseSync(lockPath, { timeout: 5000, enableForeignKeyConstraints: true })
    lock.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    return lock
  }
  private prepareOperation(kind: PreparedOperation['kind'], payload: unknown): string {
    const operationID = randomUUID(); const journal = this.openControlJournal()
    try {
      journal.exec('BEGIN IMMEDIATE')
      journal.prepare('INSERT INTO control_journal (operation_id, kind, phase, created_at, payload) VALUES (?, ?, ?, ?, ?)').run(operationID, kind, 'prepared', new Date(this.now()).toISOString(), JSON.stringify(payload))
      journal.exec('COMMIT')
      return operationID
    } catch (error) { try { journal.exec('ROLLBACK') } catch { /* preserve journal failure */ } throw error } finally { journal.close() }
  }
  private advanceOperation(operationID: string, phase: PreparedOperation['phase']): void {
    const journal = this.openControlJournal()
    try { journal.exec('BEGIN IMMEDIATE'); journal.prepare('UPDATE control_journal SET phase = ? WHERE operation_id = ?').run(phase, operationID); journal.exec('COMMIT') } catch (error) { try { journal.exec('ROLLBACK') } catch { /* preserve journal failure */ } throw error } finally { journal.close() }
  }
  private completeOperation(operationID: string): void {
    const journal = this.openControlJournal()
    try { journal.exec('BEGIN IMMEDIATE'); journal.prepare('DELETE FROM control_journal WHERE operation_id = ?').run(operationID); journal.exec('COMMIT') } catch (error) { try { journal.exec('ROLLBACK') } catch { /* preserve journal failure */ } throw error } finally { journal.close() }
  }
  private preparedOperations(): readonly PreparedOperation[] {
    const journal = this.openControlJournal()
    try {
      return (journal.prepare("SELECT operation_id, kind, phase, payload FROM control_journal WHERE phase IN ('prepared', 'filesystem_complete') ORDER BY created_at, operation_id").all() as unknown as readonly PreparedOperation[])
    } finally { journal.close() }
  }
  private async recoverPreparedOperations(): Promise<void> {
    const operations = this.preparedOperations()
    if (operations.length === 0) return
    let state: PersistentState | undefined
    const recoveryState = async (): Promise<PersistentState> => {
      if (state === undefined) state = await this.loadState({ allowInitialize: true, allowRecovery: true })
      return state
    }
    for (const operation of operations) {
      let payload: Record<string, unknown>
      try { payload = asRecord(JSON.parse(operation.payload), 'control journal payload') } catch { throw new Error('object store control journal is corrupt') }
      if (operation.kind === 'put') {
        const parsed = objectRefSchema.safeParse(payload.ref)
        if (!parsed.success) throw new Error('object store control journal is corrupt: put ref')
        const current = await recoveryState()
        const target = await this.safeObjectPath(parsed.data, false)
        try {
          const entry = await lstat(target)
          if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('object store recovery denies non-file put target')
          const bytes = new Uint8Array(await readFile(target))
          validateObjectUpload({ namespace: parsed.data.namespace, key: parsed.data.key, bytes, declared_size: parsed.data.size_bytes, declared_hash: parsed.data.content_hash, declared_mime_type: parsed.data.mime_type, rights_state: parsed.data.rights_state, deletion_state: parsed.data.deletion_state })
          const registered = current.refs[refId(parsed.data)]
          if (registered !== undefined && !sameImmutableRef(registered, parsed.data)) throw new Error('object store recovery immutable put conflict')
          if (registered === undefined) { state = { ...current, refs: { ...current.refs, [refId(parsed.data)]: parsed.data } }; await this.saveState(state) }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        this.completeOperation(operation.operation_id)
        continue
      }
      const parsed = objectRefSchema.safeParse(payload.ref)
      const idempotencyKey = payload.idempotency_key
      if (!parsed.success || typeof idempotencyKey !== 'string') throw new Error('object store control journal is corrupt: delete intent')
      const current = await recoveryState(); const intent = current.deletions[idempotencyKey]
      if (intent === undefined || !sameImmutableRef(intent.ref, parsed.data)) throw new Error('object store recovery deletion intent is not authoritative')
      if (intent.phase === 'physical_delete_pending') {
        const target = await this.safeObjectPath(parsed.data, false)
        try { await rm(target); await this.syncDirectory(dirname(target), 'before_object_directory_sync') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        state = { ...current, deletions: { ...current.deletions, [idempotencyKey]: { ...intent, phase: 'physically_deleted', attempts: intent.attempts + 1, error: null } } }
        await this.saveState(state)
      } else if (intent.phase === 'physically_deleted' || intent.phase === 'delivery_pending' || intent.phase === 'delivery_claimed' || intent.phase === 'delivered') {
        // A crash may happen after state persistence but before journal completion.  The
        // tombstone, immutable ref, and durable absence are the authoritative proof.
        await this.assertDeletionAbsent(current, intent)
      } else {
        throw new Error('object store recovery deletion phase is not reconcilable')
      }
      this.completeOperation(operation.operation_id)
    }
  }
  private async currentRef(value: ObjectRef): Promise<ObjectRef> {
    const supplied = objectRefSchema.parse(value); const state = await this.loadState(); const current = state.refs[refId(supplied)]
    if (current === undefined) throw new Error('object state has no authoritative ref for supplied object')
    if (!sameIdentity(current, supplied)) throw new Error('stored object identity mismatch')
    return current
  }
  private pruneNonces(state: PersistentState): PersistentState {
    const nonces = Object.fromEntries(Object.entries(state.nonces).filter(([, nonce]) => Date.parse(nonce.expires_at) > this.now()))
    return Object.keys(nonces).length === Object.keys(state.nonces).length ? state : { ...state, nonces }
  }
  private async safeObjectPath(ref: ObjectRef, createParents: boolean): Promise<string> {
    await this.assertSafeDirectory(this.root, createParents); let current = this.root
    for (const segment of [ref.namespace, ...ref.key.split('/').slice(0, -1)]) { current = join(current, segment); await this.assertSafeDirectory(current, createParents) }
    const target = join(current, ref.key.split('/').at(-1)!)
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error('symlinked object target is denied') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return target
  }
  private async assertSafeDirectory(path: string, create: boolean): Promise<void> {
    try { const entry = await lstat(path); if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('symlinked or non-directory storage ancestor is denied') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error
      await mkdir(path, { recursive: false, mode: 0o700 }); const created = await lstat(path); if (created.isSymbolicLink() || !created.isDirectory()) throw new Error('symlinked or non-directory storage ancestor is denied')
      await this.syncDirectory(dirname(path))
    }
  }
  private async initializedMarkerExists(): Promise<boolean> {
    try { const entry = await lstat(join(this.root, INITIALIZED_FILE)); if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('symlinked initialization marker is denied'); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  }
  private async stateFileExists(): Promise<boolean> {
    try { const entry = await lstat(join(this.root, STATE_FILE)); if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('symlinked state file is denied'); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  }
  private async createInitializedMarker(): Promise<void> {
    if (await this.initializedMarkerExists()) return
    const controlFiles = new Set([CONTROL_JOURNAL_FILE, `${CONTROL_JOURNAL_FILE}-wal`, `${CONTROL_JOURNAL_FILE}-shm`, ROOT_LOCK_FILE, `${ROOT_LOCK_FILE}-wal`, `${ROOT_LOCK_FILE}-shm`])
    if ((await readdir(this.root)).some((entry) => !controlFiles.has(entry))) throw new Error('object store state is missing from a non-empty root')
    const handle = await open(join(this.root, INITIALIZED_FILE), 'wx', 0o600)
    try { await handle.writeFile('phase1-object-store-v1\n'); await handle.sync() } finally { await handle.close() }
    await this.syncDirectory(this.root)
  }
  private parseState(value: unknown): PersistentState {
    const state = asRecord(value, 'root')
    if (state.format_version !== 1 || state.initialized !== true) throw new Error('object store state is corrupt: initialization metadata')
    const refs = asRecord(state.refs, 'refs'); const deletions = asRecord(state.deletions, 'deletions'); const nonces = asRecord(state.nonces, 'nonces'); const receipts = asRecord(state.receipts, 'receipts')
    for (const [key, ref] of Object.entries(refs)) { const parsed = objectRefSchema.safeParse(ref); if (!parsed.success || key !== refId(parsed.data)) throw new Error('object store state is corrupt: ref identity') }
    const deletionRefs = new Set<string>()
    for (const [key, deletion] of Object.entries(deletions)) {
      const entry = asRecord(deletion, 'deletion'); const parsed = objectRefSchema.safeParse(entry.ref)
      if (!parsed.success) throw new Error('object store state is corrupt: deletion intent')
      const phase = entry.phase as DeletionPhase
      const current = refs[refId(parsed.data)]
      if (entry.idempotency_key !== key || typeof entry.request_id !== 'string' || entry.request_id.trim().length === 0 || !key.endsWith(`:${entry.request_id}`) || typeof entry.reason !== 'string' || entry.reason.trim().length === 0 || typeof entry.phase !== 'string' || !phases.has(phase) || !Number.isSafeInteger(entry.attempts) || typeof entry.attempts !== 'number' || entry.attempts < 0 || (entry.error !== null && typeof entry.error !== 'string') || (entry.delivery_claim_id !== null && (typeof entry.delivery_claim_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(entry.delivery_claim_id))) || (entry.delivery_claimed_at !== null && timestamp(entry.delivery_claimed_at, 'delivery claim timestamp') === '') || (entry.not_before !== null && timestamp(entry.not_before, 'delivery retry timestamp') === '') || (phase === 'delivery_claimed' && (entry.delivery_claim_id === null || entry.delivery_claimed_at === null)) || (phase !== 'delivery_claimed' && (entry.delivery_claim_id !== null || entry.delivery_claimed_at !== null)) || parsed.data.deletion_state !== 'removed' || current === undefined || !sameImmutableRef(current as ObjectRef, parsed.data) || deletionRefs.has(refId(parsed.data)) || (phase === 'pending_delete' && (entry.attempts !== 0 || entry.error !== null)) || ((phase === 'physically_deleted' || phase === 'delivered') && entry.error !== null)) throw new Error('object store state is corrupt: deletion intent')
      deletionRefs.add(refId(parsed.data))
    }
    for (const [nonce, capability] of Object.entries(nonces)) {
      const entry = asRecord(capability, 'capability nonce')
      if (!/^[0-9a-f-]{36}$/i.test(nonce) || timestamp(entry.issued_at, 'capability issued_at') === '' || timestamp(entry.expires_at, 'capability expires_at') === '' || (entry.consumed_at !== null && timestamp(entry.consumed_at, 'capability consumed_at') === '')) throw new Error('object store state is corrupt: capability nonce')
    }
    for (const [id, receipt] of Object.entries(receipts)) {
      const entry = asRecord(receipt, 'ingress receipt')
      // Old v1 state had no disposition. Treat it as pending so a restart cannot lose evidence.
      if (entry.disposition === undefined) entry.disposition = 'pending'
      if (!/^[0-9a-f-]{36}$/i.test(id) || typeof entry.ref_id !== 'string' || refs[entry.ref_id] === undefined || (entry.field !== 'raw_ref' && entry.field !== 'object_ref') || typeof entry.actor_id !== 'string' || entry.actor_id.trim().length === 0 || typeof entry.correlation_id !== 'string' || entry.correlation_id.trim().length === 0 || timestamp(entry.issued_at, 'ingress receipt issued_at') === '' || (entry.disposition !== 'pending' && entry.disposition !== 'claimed' && entry.disposition !== 'committed' && entry.disposition !== 'quarantined')) throw new Error('object store state is corrupt: ingress receipt')
    }
    return state as PersistentState
  }
  private async loadState(options: Readonly<{ allowInitialize?: boolean; allowRecovery?: boolean }> = {}): Promise<PersistentState> {
    await this.assertSafeDirectory(this.root, true); const path = join(this.root, STATE_FILE)
    try {
      const entry = await lstat(path); if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('symlinked state file is denied')
      const state = this.parseState(JSON.parse(await readFile(path, 'utf8')))
      if (!await this.initializedMarkerExists()) throw new Error('object store state is corrupt: initialized marker missing')
      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { if (error instanceof SyntaxError) throw new Error('object store state is corrupt: invalid JSON'); throw error }
      if (await this.initializedMarkerExists() && !options.allowRecovery) throw new Error('object store state is missing after initialization')
      if (!options.allowInitialize) throw new Error('object store state is missing before initialization')
      await this.createInitializedMarker(); return emptyState()
    }
  }
  private async saveState(state: PersistentState): Promise<void> {
    await this.assertSafeDirectory(this.root, true); this.parseState(state)
    if (!await this.initializedMarkerExists()) throw new Error('object store state is corrupt: initialized marker missing')
    const target = join(this.root, STATE_FILE)
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error('symlinked state file is denied') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temporary = `${target}.${randomUUID()}.tmp`; const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(`${JSON.stringify(state)}\n`); await handle.sync() } finally { await handle.close() }
    try { this.parseState(JSON.parse(await readFile(temporary, 'utf8'))); await rename(temporary, target); await this.syncDirectory(this.root, 'before_state_directory_sync') } catch (error) { await rm(temporary, { force: true }); throw error }
  }
  private async syncDirectory(path: string, checkpoint?: Extract<DurabilityFailpoint, 'before_object_directory_sync' | 'before_state_directory_sync'>): Promise<void> {
    this.triggerFailpoint(checkpoint ?? 'before_state_directory_sync')
    try { const handle = await open(path, 'r'); try { await handle.sync() } finally { await handle.close() } } catch (error) {
      throw new Error(`durable directory sync is unavailable for local object storage: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
}
