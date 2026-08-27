import { describe, expect, it } from 'vitest'
import { completeDetailFixture } from '../fixtures/detail/complete'
import { buildLocalPublicationManifest, stableJson } from '@/publication/manifest'
import { activatePublication } from '@/publication/activation'
import { rollbackPublication } from '@/publication/rollback'
import { LocalPublicationStore } from '@/publication/snapshot'

const publicationManifest = (version: number) => buildLocalPublicationManifest({
  label: (`P2L-B${version - 1}`) as 'P2L-B0' | 'P2L-B1' | 'P2L-B2' | 'P2L-B3', publishVersion: version,
  routes: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ ...completeDetailFixture.route, locale: page.locale, path: `/${page.locale}/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001` })),
  routeFiles: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ path: `routes/${page.locale}/detail.json`, bytes: stableJson(page) })),
  exportFiles: [{ path: 'export/records/first-party-001.json', bytes: '{"id":"first-party-001"}\n' }],
})

describe('P2-L atomic rollback', () => {
  it('restores the previous verified publication using one pointer CAS', () => {
    const store = new LocalPublicationStore()
    activatePublication({ store, manifest: publicationManifest(1), expectedRevision: 0, correlationId: '00000000-0000-4000-8000-000000000001' })
    activatePublication({ store, manifest: publicationManifest(2), expectedRevision: 1, correlationId: '00000000-0000-4000-8000-000000000001' })
    const result = rollbackPublication({ store, expectedRevision: 2, correlationId: '00000000-0000-4000-8000-000000000001' })
    expect(result.pointer).toMatchObject({ publish_version: 1, previous_verified_version: null, revision: 3 })
    expect(store.state(2)?.status).toBe('rolled_back')
    expect(store.state(1)?.status).toBe('active')
    expect(store.audits()).toHaveLength(4)
  })

  it('rejects out-of-order rollback without mutation', () => {
    const store = new LocalPublicationStore()
    activatePublication({ store, manifest: publicationManifest(1), expectedRevision: 0, correlationId: '00000000-0000-4000-8000-000000000001' })
    expect(() => rollbackPublication({ store, expectedRevision: 0, correlationId: '00000000-0000-4000-8000-000000000001' })).toThrow(/revision|conflict/i)
    expect(store.pointer().publish_version).toBe(1)
  })
})
