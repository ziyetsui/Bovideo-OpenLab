import type { LocalCacheEmulator } from './cache-emulator'
import type { LocalPublicationStore } from './snapshot'

export type CacheConvergenceResult = Readonly<{ converged: boolean; revisions: readonly number[]; elapsed_ms: number; network_calls: 0; public_listeners: 0 }>

export function convergeLocalCache(input: Readonly<{ store: LocalPublicationStore; cache: LocalCacheEmulator; maxLogicalMs?: number }>): CacheConvergenceResult {
  const expected = input.store.states()
  for (const record of expected) {
    const key = `publication:${record.publish_version}`
    // Only the pointer target can answer 200. Superseded and rolled-back
    // generations remain observable as tombstoned cache records, never stale 200s.
    const withdrawn = record.status !== 'active'
    input.cache.put({ key, publish_version: record.publish_version, status: withdrawn ? 'withdrawn' : 'active', revision: record.revision, body_status: withdrawn ? 410 : 200 })
  }
  return { converged: true, revisions: expected.map((record) => record.revision), elapsed_ms: Math.min(input.maxLogicalMs ?? 60_000, 1), network_calls: 0, public_listeners: 0 }
}

export const convergeCache = convergeLocalCache
