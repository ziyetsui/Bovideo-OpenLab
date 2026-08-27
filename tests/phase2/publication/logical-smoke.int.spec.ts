import { describe, expect, it } from 'vitest'
import { runLocalPublicationSmoke } from '@/publication/smoke'
import { completeDetailFixture } from '../fixtures/detail/complete'
import { buildLocalPublicationManifest, stableJson } from '@/publication/manifest'
import { activatePublication } from '@/publication/activation'
import { emergencyWithdraw, withdrawnResponse } from '@/publication/withdrawal'
import { LocalPublicationStore } from '@/publication/snapshot'
import { LocalCacheEmulator } from '@/publication/cache-emulator'
import { readLocalPublication } from '@/publication/local-read-plane'

const manifest = (version: number) => buildLocalPublicationManifest({
  label: (`P2L-B${version - 1}`) as 'P2L-B0' | 'P2L-B1' | 'P2L-B2' | 'P2L-B3', publishVersion: version,
  routes: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ ...completeDetailFixture.route, locale: page.locale, path: `/${page.locale}/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001` })),
  routeFiles: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ path: `routes/${page.locale}/detail.json`, bytes: stableJson(page) })),
  exportFiles: [{ path: 'export/records/first-party-001.json', bytes: '{"id":"first-party-001"}\n' }],
})

describe('P2-L logical smoke', () => {
  it('uses loopback-only local dependencies and performs no network mutation', async () => {
    const result = await runLocalPublicationSmoke({ host: '127.0.0.1', ports: [4311, 4312, 4313], cacheRoot: 'output/p2-local-cache', manifest: manifest(3) })
    expect(result.network_calls).toBe(0)
    expect(result.remote_mutations).toBe(0)
    expect(result.public_listeners).toBe(0)
    expect(result.contexts.map((context) => context.label)).toEqual(['local-region-a', 'local-region-b', 'local-region-c'])
    expect(result.convergence_seconds).toBe(60)
    expect(result.contexts.every((context) => context.active_version === 3 && context.converged)).toBe(true)
    expect(new Set(result.contexts.map((context) => context.payload_tree_hash)).size).toBe(1)
  })

  it('executes B0→B1→rollback→B2→B3 with real hashes, withdrawal and 410 closure', () => {
    const store = new LocalPublicationStore(); const cache = new LocalCacheEmulator(); const b0 = manifest(1); const b1 = manifest(2); const b2 = manifest(3); const b3 = manifest(4)
    activatePublication({ store, cache, manifest: b0, expectedRevision: 0, correlationId: 'corr-b0' })
    expect(() => activatePublication({ store, cache, manifest: b1, expectedRevision: 1, correlationId: 'corr-b1', failAt: 'after_commit' })).toThrow(/injected/)
    expect(store.pointer().publish_version).toBe(1); expect(store.state(2)?.status).toBe('rolled_back')
    activatePublication({ store, cache, manifest: b2, expectedRevision: store.pointer().revision, correlationId: 'corr-b2' })
    expect(b2.payloadTreeHash).toBe(b1.payloadTreeHash); expect(b2.routePayloadHash).toBe(b1.routePayloadHash); expect(b2.exportTreeHash).toBe(b1.exportTreeHash)
    activatePublication({ store, cache, manifest: b3, expectedRevision: store.pointer().revision, correlationId: 'corr-b3' })
    expect(store.state(4)?.manifest.routes).toHaveLength(15)
    emergencyWithdraw({ store, cache, publishVersion: 4, locales: ['zh-TW'], correlationId: 'corr-withdraw' })
    expect(readLocalPublication({ store, cache, publishVersion: 4, locale: 'zh-TW' })).toMatchObject({ status: 410 })
    expect(withdrawnResponse('zh-TW').status).toBe(410)
  })
})
