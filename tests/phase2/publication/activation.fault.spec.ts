import { describe, expect, it } from 'vitest'

import { completeDetailFixture } from '../fixtures/detail/complete'
import { buildLocalPublicationManifest, stableJson } from '@/publication/manifest'
import { activatePublication } from '@/publication/activation'
import { LocalPublicationStore } from '@/publication/snapshot'

export const publicationManifest = (version: number) => buildLocalPublicationManifest({
  label: (`P2L-B${version - 1}`) as 'P2L-B0' | 'P2L-B1' | 'P2L-B2' | 'P2L-B3',
  publishVersion: version,
  routes: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ ...completeDetailFixture.route, locale: page.locale, path: `/${page.locale}/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001` })),
  routeFiles: version === 1 ? [] : completeDetailFixture.pages.slice(0, version === 4 ? 15 : 16).map((page) => ({ path: `routes/${page.locale}/detail.json`, bytes: stableJson(page) })),
  exportFiles: [{ path: 'export/records/first-party-001.json', bytes: '{"id":"first-party-001"}\n' }],
})

describe('P2-L activation fault boundary', () => {
  it('commits pointer, lifecycle and audit as one B1 activation', () => {
    const store = new LocalPublicationStore()
    const result = activatePublication({ store, manifest: publicationManifest(1), expectedRevision: 0, correlationId: '00000000-0000-4000-8000-000000000001' })
    expect(result.pointer).toMatchObject({ publish_version: 1, revision: 1, previous_verified_version: null })
    expect(store.state(1)?.status).toBe('active')
    expect(store.audits()).toHaveLength(1)
  })

  it.each(['before_commit', 'after_commit'] as const)('rolls back all durable state on injected %s failure', (failAt) => {
    const store = new LocalPublicationStore()
    const expectedRevision = failAt === 'after_commit' ? (activatePublication({ store, manifest: publicationManifest(1), expectedRevision: 0, correlationId: '00000000-0000-4000-8000-000000000001' }).pointer.revision) : 0
    expect(() => activatePublication({ store, manifest: publicationManifest(failAt === 'after_commit' ? 2 : 1), expectedRevision, correlationId: '00000000-0000-4000-8000-000000000001', failAt })).toThrow(/injected/i)
    if (failAt === 'after_commit') {
      expect(store.pointer()).toMatchObject({ publish_version: 1, revision: 3 })
      expect(store.state(1)?.status).toBe('active')
      expect(store.state(2)?.status).toBe('rolled_back')
      expect(store.audits()).toHaveLength(4)
    } else {
      expect(store.pointer()).toMatchObject({ publish_version: null, revision: 0 })
      expect(store.state(1)).toBeUndefined()
      expect(store.audits()).toHaveLength(0)
    }
  })

  it('rejects stale pointer CAS without partial mutation', () => {
    const store = new LocalPublicationStore()
    expect(() => activatePublication({ store, manifest: publicationManifest(1), expectedRevision: 2, correlationId: '00000000-0000-4000-8000-000000000001' })).toThrow(/revision|conflict/i)
    expect(store.pointer().revision).toBe(0)
    expect(store.audits()).toHaveLength(0)
  })
})
