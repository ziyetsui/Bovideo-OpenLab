import type { LocalCacheEmulator } from './cache-emulator'
import type { LocalPublicationStore } from './snapshot'
import { withdrawnResponse } from './withdrawal'

export type LocalReadResult = Readonly<{ status: 200 | 410 | 404; body: string; headers: Readonly<Record<string, string>> }>

export function readLocalPublication(input: Readonly<{ store: LocalPublicationStore; cache: LocalCacheEmulator; publishVersion: number; locale?: string }>): LocalReadResult {
  const cached = input.cache.get(`publication:${input.publishVersion}`)
  const record = input.store.state(input.publishVersion)
  if (record === undefined) return { status: 404, body: 'not found', headers: { 'cache-control': 'no-store' } }
  if (record.status === 'withdrawn' || record.withdrawn_locales.includes(input.locale ?? 'en') || cached?.status === 'withdrawn') return withdrawnResponse(input.locale ?? 'en')
  if (cached?.body_status !== 200) return { status: 404, body: 'not found', headers: { 'cache-control': 'no-store' } }
  return { status: 200, body: `local publication ${input.publishVersion}`, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet' } }
}

export const readPublicationLocally = readLocalPublication
