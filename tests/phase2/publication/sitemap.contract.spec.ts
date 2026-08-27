import { describe, expect, it } from 'vitest'

import {
  EMPTY_PRODUCTION_SITEMAP_XML,
  buildEmptyProductionSitemap,
  validateProductionSitemap,
} from '@/publication/sitemap'

describe('P2-L empty production Sitemap', () => {
  it('emits the exact byte-fixed zero-entry sentinel and prohibited manifest', () => {
    const first = buildEmptyProductionSitemap({ publishVersion: 2, routeManifestHash: `sha256:p2l-v1:${'a'.repeat(64)}` })
    const second = buildEmptyProductionSitemap({ publishVersion: 2, routeManifestHash: `sha256:p2l-v1:${'a'.repeat(64)}` })
    expect(first.xml).toBe(EMPTY_PRODUCTION_SITEMAP_XML)
    expect(first.xml).toBe(second.xml)
    expect(first.manifest).toEqual({
      profile: 'p2-local', publish_version: 2, route_manifest_hash: `sha256:p2l-v1:${'a'.repeat(64)}`,
      url_count: 0, shards: [], submission: 'prohibited', sitemap_xml_hash: first.xmlHash,
    })
    expect(first.xml).not.toMatch(/<url(?:\s|>)/)
    expect(first.xml).not.toMatch(/<sitemap(?:\s|>)/)
  })

  it('is well formed as XML but is deliberately not protocol-publishable', () => {
    const sitemap = buildEmptyProductionSitemap({ publishVersion: 1, routeManifestHash: `sha256:p2l-v1:${'b'.repeat(64)}` })
    expect(validateProductionSitemap(sitemap)).toEqual({ wellFormed: true, protocolPublishable: false, urlCount: 0 })
    expect(() => validateProductionSitemap({ ...sitemap, xml: sitemap.xml.replace('/>', '><url></urlset>') })).toThrow()
    expect(() => validateProductionSitemap({ ...sitemap, manifest: { ...sitemap.manifest, url_count: 1 } })).toThrow()
  })

  it('rejects any attempt to publish noindex or nonzero URL entries', () => {
    expect(() => buildEmptyProductionSitemap({ publishVersion: 2, routeManifestHash: `sha256:p2l-v1:${'a'.repeat(64)}`, urls: ['/en/prompts/noindex'] })).toThrow(/zero|empty|url/i)
  })
})
