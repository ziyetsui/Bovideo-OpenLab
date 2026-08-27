import { describe, expect, it } from 'vitest'
import { completeDetailFixture } from '../fixtures/detail/complete'
import { buildLocalPublicationManifest, stableJson } from '@/publication/manifest'
import { activatePublication } from '@/publication/activation'
import { LocalPublicationStore } from '@/publication/snapshot'
import { emergencyWithdraw } from '@/publication/withdrawal'
import { LocalCacheEmulator } from '@/publication/cache-emulator'
import { convergeLocalCache } from '@/publication/cache-convergence'

const publicationManifest = (version: number) => buildLocalPublicationManifest({
  label: (`P2L-B${version - 1}`) as 'P2L-B0' | 'P2L-B1' | 'P2L-B2' | 'P2L-B3', publishVersion: version,
  routes: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ ...completeDetailFixture.route, locale: page.locale, path: `/${page.locale}/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001` })),
  routeFiles: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ path: `routes/${page.locale}/detail.json`, bytes: stableJson(page) })),
  exportFiles: [{ path: 'export/records/first-party-001.json', bytes: '{"id":"first-party-001"}\n' }],
})

describe('P2-L cache convergence', () => {
  it('converges within the local logical window and purges withdrawn versions', () => {
    const store = new LocalPublicationStore()
    const cache = new LocalCacheEmulator()
    activatePublication({ store, manifest: publicationManifest(2), expectedRevision: 0, correlationId: '00000000-0000-4000-8000-000000000001' })
    convergeLocalCache({ store, cache })
    expect(cache.get('publication:2')?.status).toBe('active')
    emergencyWithdraw({ store, publishVersion: 2, locales: ['en'], correlationId: '00000000-0000-4000-8000-000000000001' })
    convergeLocalCache({ store, cache })
    expect(cache.get('publication:2')?.status).toBe('active')
    expect(cache.networkCalls()).toBe(0)
    expect(cache.publicListeners()).toBe(0)
  })
})
