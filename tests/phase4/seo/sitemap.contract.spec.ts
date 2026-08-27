import { describe, expect, it } from 'vitest'

import { buildVersionedSitemap, type SitemapRouteCandidate } from '@/seo/sitemap'

const candidate = (route: string, locale: 'en' | 'zh-CN', overrides: Partial<SitemapRouteCandidate> = {}): SitemapRouteCandidate => ({
  route,
  canonicalPath: route,
  locale,
  family: 'detail',
  status: 200,
  indexable: true,
  routeKey: '/prompts/example',
  contentHash: 'content-v1',
  linkHash: 'links-v1',
  schemaHash: 'schema-v1',
  lastModified: '2026-08-25T00:00:00.000Z',
  ...overrides,
})

describe('Phase 4 versioned Sitemap and hreflang builder', () => {
  it('builds reciprocal locale alternates and a version-bound deterministic manifest', () => {
    const input = {
      publishVersion: 7,
      origin: 'https://www.example.test',
      routes: [candidate('/en/prompts/example', 'en'), candidate('/zh-CN/prompts/example', 'zh-CN')],
    }
    const first = buildVersionedSitemap(input)
    const second = buildVersionedSitemap(input)
    expect(first.routeManifestHash).toBe(second.routeManifestHash)
    expect(first.shards).toHaveLength(2)
    for (const entry of first.shards.flatMap((shard) => shard.entries)) {
      expect(Object.keys(entry.alternates)).toEqual(['en', 'zh-CN'])
      expect(entry.alternates[entry.locale]).toBe(entry.loc)
      expect(entry.loc).toMatch(/^https:\/\//)
    }
    expect(first.shards[0]?.name).toMatch(/^sitemap-v7-/)
    expect(first.shards[0]?.xml).toContain('xhtml:link')
  })

  it('excludes ineligible, redirect, and query routes fail-closed', () => {
    const result = buildVersionedSitemap({
      publishVersion: 1,
      origin: 'https://www.example.test',
      routes: [
        candidate('/en/prompts/ok', 'en'),
        candidate('/en/prompts/noindex', 'en', { indexable: false }),
        candidate('/en/prompts/redirect', 'en', { status: 301 }),
        candidate('/en/prompts/query?page=2', 'en'),
      ],
    })
    expect(result.urlCount).toBe(1)
    expect(result.excludedRoutes).toHaveLength(3)
    expect(result.shards.flatMap((shard) => shard.entries).every((entry) => !entry.route.includes('?'))).toBe(true)
  })

  it('requires an explicit self-canonical path before a 200 enters Sitemap', () => {
    const result = buildVersionedSitemap({ publishVersion: 2, origin: 'https://www.example.test', routes: [
      candidate('/en/prompts/old', 'en', { canonicalPath: '/en/prompts/current' }),
      candidate('/en/prompts/missing-canonical', 'en', { canonicalPath: undefined }),
    ] })
    expect(result.urlCount).toBe(0)
    expect(result.excludedRoutes.every((route) => route.reason.startsWith('route_not_self_canonical'))).toBe(true)
  })

  it('keeps lastmod stable when content, link, and schema hashes are unchanged', () => {
    const previous = buildVersionedSitemap({
      publishVersion: 1,
      origin: 'https://www.example.test',
      routes: [candidate('/en/prompts/example', 'en', { lastModified: '2026-08-20T00:00:00.000Z' })],
    })
    const next = buildVersionedSitemap({
      publishVersion: 2,
      origin: 'https://www.example.test',
      previous,
      routes: [candidate('/en/prompts/example', 'en', { lastModified: '2026-08-25T00:00:00.000Z' })],
    })
    expect(next.shards[0]?.entries[0]?.lastmod).toBe('2026-08-20T00:00:00.000Z')
  })

  it('shards each locale-family at no more than ten thousand URLs', () => {
    const routes = Array.from({ length: 10_001 }, (_, index) => candidate(`/en/prompts/item-${index}`, 'en', {
      routeKey: `/prompts/item-${index}`,
    }))
    const result = buildVersionedSitemap({ publishVersion: 1, origin: 'https://www.example.test', routes })
    expect(result.urlCount).toBe(10_001)
    expect(result.shards.map((shard) => shard.entries.length)).toEqual([10_000, 1])
  })
})
