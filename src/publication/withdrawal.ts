import { LocalPublicationStore, type LocalPublicationRecord } from './snapshot'
import type { LocalCacheEmulator } from './cache-emulator'
import { convergeLocalCache } from './cache-convergence'

export type WithdrawalTombstone = Readonly<{ id: string; publish_version: number; locales: readonly string[]; status: 'withdrawn'; reason: 'emergency_rights_revocation'; at: string }>
export type WithdrawalResult = Readonly<{ tombstone: WithdrawalTombstone; record: LocalPublicationRecord; idempotent: boolean }>

const tombstoneId = (version: number): string => `p2l-withdraw-${version}`

export function emergencyWithdraw(input: Readonly<{ store: LocalPublicationStore; publishVersion: number; locales: readonly string[]; correlationId: string; at?: string; cache?: LocalCacheEmulator }>): WithdrawalResult {
  const existing = input.store.state(input.publishVersion)
  if (existing !== undefined && input.locales.length > 0 && input.locales.every((locale) => existing.withdrawn_locales.includes(locale))) {
    const tombstone: WithdrawalTombstone = { id: tombstoneId(input.publishVersion), publish_version: input.publishVersion, locales: existing.withdrawn_locales, status: 'withdrawn', reason: 'emergency_rights_revocation', at: input.at ?? '2026-08-25T00:00:00.000Z' }
    return { tombstone, record: existing, idempotent: true }
  }
  if (existing === undefined) throw new Error('publication not found for withdrawal')
  if (input.locales.length === 0) throw new Error('withdrawal requires at least one locale')
  const available = new Set<string>(existing.manifest.routes.map((route) => route.locale))
  const locales = [...new Set(input.locales)].sort()
  if (locales.some((locale) => !available.has(locale))) throw new Error('withdrawal locale is not present in publication')
  let result!: WithdrawalResult
  const cacheBefore = input.cache?.entries() ?? []
  try {
    input.store.transaction(input.store.pointer().revision, (tx) => {
    const current = tx.state(input.publishVersion)
    if (current === undefined) throw new Error('publication disappeared during withdrawal')
    const allLocales = current.manifest.routes.map((route) => route.locale)
    const withdrawnLocales = [...new Set([...current.withdrawn_locales, ...locales])].sort()
    const fullyWithdrawn = allLocales.length > 0 && allLocales.every((locale) => withdrawnLocales.includes(locale))
    const record = { ...current, status: fullyWithdrawn ? 'withdrawn' as const : current.status, revision: current.revision + 1, withdrawn_locales: Object.freeze(withdrawnLocales) }
    tx.setState(record)
    const tombstone: WithdrawalTombstone = Object.freeze({ id: tombstoneId(input.publishVersion), publish_version: input.publishVersion, locales: Object.freeze(locales), status: 'withdrawn', reason: 'emergency_rights_revocation', at: input.at ?? '2026-08-25T00:00:00.000Z' })
    tx.audit({ action: 'withdraw', outcome: 'allowed', publish_version: input.publishVersion, correlation_id: input.correlationId, at: tombstone.at, reason_code: 'rights_revoked_emergency' })
    if (input.cache !== undefined) convergeLocalCache({ store: input.store, cache: input.cache })
    result = { tombstone, record, idempotent: false }
    return result
    })
  } catch (error) {
    input.cache?.restore(cacheBefore)
    throw error
  }
  return result
}

export type WithdrawnResponse = Readonly<{ status: 410; body: string; headers: Readonly<Record<string, string>> }>
export function withdrawnResponse(locale: string): WithdrawnResponse {
  const body = locale === 'zh-TW' ? '此內容已撤回' : 'This content has been withdrawn'
  return Object.freeze({ status: 410, body, headers: Object.freeze({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet' }) })
}

export const withdrawPublication = emergencyWithdraw
