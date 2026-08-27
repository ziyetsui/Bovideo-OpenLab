import { describe, expect, it } from 'vitest'

import { completeDetailFixture } from '../fixtures/detail/complete'
import {
  buildLocalPublicationManifest,
  hashPublicationTree,
  stableJson,
  type PublicationTreeFile,
} from '@/publication/manifest'

const files = (): readonly PublicationTreeFile[] => completeDetailFixture.pages.map((page) => ({
  path: `routes/${page.locale}/detail.json`,
  bytes: stableJson(page),
}))

const input = () => ({
  label: 'P2L-B1' as const,
  publishVersion: 2,
  routes: completeDetailFixture.pages.map((_page) => completeDetailFixture.route).map((route, index) => ({
    ...route,
    locale: completeDetailFixture.pages[index]!.locale,
    path: `/${completeDetailFixture.pages[index]!.locale}/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001`,
  })),
  routeFiles: files(),
  exportFiles: [{ path: 'export/records/first-party-001.json', bytes: '{"id":"first-party-001"}\n' }],
  metadata: { runId: 'run-a', createdAt: '2026-08-25T00:00:00.000Z' },
})

describe('P2-L deterministic publication manifest', () => {
  it('builds byte-stable route, export and composite hashes', () => {
    const first = buildLocalPublicationManifest(input())
    const second = buildLocalPublicationManifest({ ...input(), metadata: { runId: 'run-b', createdAt: '2027-01-01T00:00:00.000Z' } })

    expect(first.payloadTreeHash).toMatch(/^sha256:p2l-v1:[a-f0-9]{64}$/)
    expect(first.routePayloadHash).toMatch(/^sha256:p2l-v1:[a-f0-9]{64}$/)
    expect(first.exportTreeHash).toMatch(/^sha256:p2l-v1:[a-f0-9]{64}$/)
    expect(first.payloadTreeHash).toBe(second.payloadTreeHash)
    expect(first.routePayloadHash).toBe(second.routePayloadHash)
    expect(first.exportTreeHash).toBe(second.exportTreeHash)
    expect(first.previewManifest).toMatchObject({ profile: 'p2-local', noindex: true, public_deployment: false, route_count: 16 })
    expect(first.productionSitemap.url_count).toBe(0)
  })

  it('uses the specified NUL/LF tree framing and UTF-8 path order', () => {
    const entries = [
      { path: 'b', bytes: 'two' },
      { path: 'a', bytes: 'one' },
    ]
    expect(hashPublicationTree(entries)).toBe(hashPublicationTree([...entries].reverse()))
    expect(hashPublicationTree([{ path: 'a', bytes: 'one\n' }])).not.toBe(hashPublicationTree([{ path: 'a', bytes: 'one' }]))
  })

  it('rejects a snapshot label/version mismatch and excludes metadata from payload hashes', () => {
    expect(() => buildLocalPublicationManifest({ ...input(), label: 'P2L-B0', publishVersion: 2 })).toThrow(/label|version/i)
    const first = buildLocalPublicationManifest(input())
    const second = buildLocalPublicationManifest({ ...input(), metadata: { runId: 'different', createdAt: '2099-01-01T00:00:00.000Z' } })
    expect(first.payloadTreeHash).toBe(second.payloadTreeHash)
  })
})
