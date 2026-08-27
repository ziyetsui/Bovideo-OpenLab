import { LocalPublicationStore, type LocalPointer, type LocalPublicationRecord } from './snapshot'
import type { LocalCacheEmulator } from './cache-emulator'
import { convergeLocalCache } from './cache-convergence'

export type RollbackInput = Readonly<{ store: LocalPublicationStore; expectedRevision: number; correlationId: string; at?: string; failAt?: 'before_commit' | 'after_commit'; cache?: LocalCacheEmulator }>
export type RollbackResult = Readonly<{ pointer: LocalPointer; active: LocalPublicationRecord; rolledBack: LocalPublicationRecord }>

export function rollbackPublication(input: RollbackInput): RollbackResult {
  let result!: RollbackResult
  const cacheBefore = input.cache?.entries() ?? []
  try {
    return input.store.transaction(input.expectedRevision, (tx) => {
    const currentVersion = tx.pointer.publish_version
    const previousVersion = tx.pointer.previous_verified_version
    if (currentVersion === null || previousVersion === null) throw new Error('no previous verified publication available for rollback')
    const current = tx.state(currentVersion)
    const previous = tx.state(previousVersion)
    if (current?.status !== 'active' || previous?.status !== 'superseded') throw new Error('rollback lifecycle guard failed')
    if (input.failAt === 'before_commit') throw new Error('injected failure before commit')
    const rolledBack = { ...current, status: 'rolled_back' as const, revision: current.revision + 1 }
    const active = { ...previous, status: 'active' as const, revision: previous.revision + 1 }
    tx.setState(rolledBack)
    tx.setState(active)
    const pointer: LocalPointer = Object.freeze({ publish_version: previousVersion, previous_verified_version: active.manifest.snapshot.previous_verified_version, revision: input.expectedRevision + 1 })
    tx.setPointer(pointer)
    const at = input.at ?? '2026-08-25T00:00:00.000Z'
    tx.audit({ action: 'rollback', outcome: 'allowed', publish_version: currentVersion, correlation_id: input.correlationId, at, reason_code: 'atomic_rollback_failed_active' })
    tx.audit({ action: 'rollback', outcome: 'allowed', publish_version: previousVersion, correlation_id: input.correlationId, at, reason_code: 'atomic_rollback_reactivated_previous' })
    if (input.cache !== undefined) convergeLocalCache({ store: input.store, cache: input.cache })
    result = { pointer, active, rolledBack }
    return result
    }, () => {
    if (input.failAt === 'after_commit') throw new Error('injected failure after commit')
    })
  } catch (error) {
    input.cache?.restore(cacheBefore)
    throw error
  }
}

export const rollbackLocalPublication = rollbackPublication
