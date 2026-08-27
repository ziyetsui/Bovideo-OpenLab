import { describe, expect, it } from 'vitest'
import { completeDetailFixture } from '../fixtures/detail/complete'
import { buildLocalPublicationManifest, stableJson } from '@/publication/manifest'
import { activatePublication } from '@/publication/activation'
import { LocalPublicationStore } from '@/publication/snapshot'
import { emergencyWithdraw, withdrawnResponse } from '@/publication/withdrawal'
import { readLocalPublication } from '@/publication/local-read-plane'
import { LocalCacheEmulator } from '@/publication/cache-emulator'
import { convergeLocalCache } from '@/publication/cache-convergence'

const publicationManifest = (version: number) => buildLocalPublicationManifest({
  label: (`P2L-B${version - 1}`) as 'P2L-B0' | 'P2L-B1' | 'P2L-B2' | 'P2L-B3', publishVersion: version,
  routes: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ ...completeDetailFixture.route, locale: page.locale, path: `/${page.locale}/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001` })),
  routeFiles: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ path: `routes/${page.locale}/detail.json`, bytes: stableJson(page) })),
  exportFiles: [{ path: 'export/records/first-party-001.json', bytes: '{"id":"first-party-001"}\n' }],
})

describe('P2-L emergency withdrawal', () => {
  it('atomically tombstones all locales and returns zh-TW 410 semantics', () => {
    const store = new LocalPublicationStore()
    const cache = new LocalCacheEmulator()
    activatePublication({ store, manifest: publicationManifest(2), expectedRevision: 0, correlationId: '00000000-0000-4000-8000-000000000001' })
    const result = emergencyWithdraw({ store, cache, publishVersion: 2, locales: ['en', 'zh-TW'], correlationId: '00000000-0000-4000-8000-000000000001' })
    expect(result.tombstone.status).toBe('withdrawn')
    expect(result.tombstone.locales).toEqual(['en', 'zh-TW'])
    expect(withdrawnResponse('zh-TW')).toMatchObject({ status: 410, headers: { 'x-robots-tag': expect.stringContaining('noindex') } })
    expect(withdrawnResponse('zh-TW').body).toContain('已撤回')
    expect(emergencyWithdraw({ store, publishVersion: 2, locales: ['en', 'zh-TW'], correlationId: '00000000-0000-4000-8000-000000000001' }).idempotent).toBe(true)
  })

  it('withdraws only the requested locale and distinguishes absent routes', () => {
    const store = new LocalPublicationStore()
    const cache = new LocalCacheEmulator()
    const version = 2
    activatePublication({ store, manifest: publicationManifest(version), expectedRevision: 0, correlationId: '00000000-0000-4000-8000-000000000001', cache })
    emergencyWithdraw({ store, cache, publishVersion: version, locales: ['zh-TW'], correlationId: '00000000-0000-4000-8000-000000000001' })
    convergeLocalCache({ store, cache })
    expect(readLocalPublication({ store, cache, publishVersion: version, locale: 'zh-TW' }).status).toBe(410)
    expect(readLocalPublication({ store, cache, publishVersion: version, locale: 'en' }).status).toBe(200)
    expect(readLocalPublication({ store, cache, publishVersion: 999, locale: 'en' }).status).toBe(404)
  })
})
