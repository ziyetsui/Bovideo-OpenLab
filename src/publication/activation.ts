import type { LocalPublicationManifest } from './manifest'
import { LocalPublicationStore, type LocalPointer, type LocalPublicationRecord } from './snapshot'
import { LocalCacheEmulator, type LocalCacheEmulator as LocalCacheEmulatorType } from './cache-emulator'
import { convergeLocalCache } from './cache-convergence'
import { rollbackPublication, type RollbackResult } from './rollback'
import { emergencyWithdraw, type WithdrawalResult } from './withdrawal'
import { readLocalPublication, type LocalReadResult } from './local-read-plane'

export type ActivationFailurePoint = 'before_commit' | 'after_commit'
export type ActivationInput = Readonly<{
  store: LocalPublicationStore
  manifest: LocalPublicationManifest
  expectedRevision: number
  correlationId: string
  at?: string
  failAt?: ActivationFailurePoint
  cache?: LocalCacheEmulator
}>
export type ActivationResult = Readonly<{ pointer: LocalPointer; record: LocalPublicationRecord }>

const now = (input: ActivationInput): string => input.at ?? '2026-08-25T00:00:00.000Z'

/** Activates a locally built manifest with pointer CAS and an all-or-nothing state transition. */
export function activatePublication(input: ActivationInput): ActivationResult {
  const version = input.manifest.snapshot.publish_version
  if (version <= 0 || input.manifest.previewManifest.noindex !== true || input.manifest.previewManifest.public_deployment !== false)
    throw new Error('publication manifest is not a valid local-only activation candidate')
  let result!: ActivationResult
  const cacheBefore = input.cache?.entries() ?? []
  try {
    const activated = input.store.transaction(input.expectedRevision, (tx) => {
    const currentVersion = tx.pointer.publish_version
    const current = currentVersion === null ? undefined : tx.state(currentVersion)
    if (current !== undefined && current.status !== 'active') throw new Error('active pointer does not reference an active publication')
    if (tx.state(version)?.status === 'active') throw new Error('publication is already active')
    if (input.failAt === 'before_commit') throw new Error('injected failure before commit')
    if (current !== undefined) tx.setState({ ...current, status: 'superseded', revision: current.revision + 1 })
    const record: LocalPublicationRecord = Object.freeze({ publish_version: version, status: 'active', revision: (tx.state(version)?.revision ?? 0) + 1, manifest: input.manifest, withdrawn_locales: Object.freeze([]) })
    tx.setState(record)
    const pointer: LocalPointer = Object.freeze({ publish_version: version, previous_verified_version: current?.publish_version ?? null, revision: input.expectedRevision + 1 })
    tx.setPointer(pointer)
    tx.audit({ action: 'activate', outcome: 'allowed', publish_version: version, correlation_id: input.correlationId, at: now(input), reason_code: current === undefined ? 'bootstrap_activation' : 'replacement_activation' })
    if (input.cache !== undefined) convergeLocalCache({ store: input.store, cache: input.cache })
    result = { pointer, record }
    return result
    })
    if (input.failAt === 'after_commit') {
      rollbackPublication({ store: input.store, cache: input.cache, expectedRevision: activated.pointer.revision, correlationId: input.correlationId, at: now(input) })
      throw new Error('injected failure after commit')
    }
    return activated
  } catch (error) {
    input.cache?.restore(cacheBefore)
    throw error
  }
}

export const activateLocalPublication = activatePublication

/** Facade used by the local scripts/tests; it deliberately exposes no network client. */
export class LocalPublicationController {
  readonly store: LocalPublicationStore
  readonly cache: LocalCacheEmulatorType
  constructor(input: Readonly<{ store?: LocalPublicationStore; cache?: LocalCacheEmulator }> = {}) {
    this.store = input.store ?? new LocalPublicationStore()
    this.cache = input.cache ?? new LocalCacheEmulator()
  }
  activate(input: Omit<ActivationInput, 'store' | 'cache'> & Readonly<{ manifest: LocalPublicationManifest }>): ActivationResult {
    return activatePublication({ ...input, store: this.store, cache: this.cache })
  }
  rollback(input: Omit<Parameters<typeof rollbackPublication>[0], 'store'>): RollbackResult {
    return rollbackPublication({ ...input, store: this.store })
  }
  withdraw(input: Omit<Parameters<typeof emergencyWithdraw>[0], 'store' | 'cache'>): WithdrawalResult {
    return emergencyWithdraw({ ...input, store: this.store, cache: this.cache })
  }
  read(input: Readonly<{ publishVersion: number; locale?: string }>): LocalReadResult {
    return readLocalPublication({ ...input, store: this.store, cache: this.cache })
  }
}
