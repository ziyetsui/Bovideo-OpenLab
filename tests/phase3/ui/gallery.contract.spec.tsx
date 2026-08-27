import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { projectGalleryPage } from '@/page/projections'
import { PageRouteView } from '@/page/route-view'
import type { GalleryPage } from '@/page/schema'

const SECTION_ORDER = [
  'gallery-hero',
  'gallery-axes',
  'gallery-featured',
  'gallery-models',
  'gallery-subject',
  'gallery-residual',
  'gallery-method',
  'gallery-related',
  'gallery-pagination',
] as const

const expectOrdered = (html: string) => {
  const positions = SECTION_ORDER.map((id) => html.indexOf(`data-section="${id}"`))
  expect(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]!))).toBe(true)
}

describe('Gallery Bauhaus composition', () => {
  it.each(['image', 'video'] as const)('renders the %s medium and finite item inventory', (mediaType) => {
    const fixture = P3_GOLDEN_FIXTURES.gallery.complete as GalleryPage
    const route = `/en/prompts/${mediaType}`
    const page = projectGalleryPage(
      { ...fixture, route, media_type: mediaType, filter_state: { output: mediaType } },
      { mediaType, page: 1, pageSize: 12, totalItems: 24, filterState: { output: mediaType } },
    )
    const html = renderToStaticMarkup(<PageRouteView page={page} />)

    expectOrdered(html)
    expect(html).toContain(`Showing ${mediaType} results · page 1 of 2`)
    expect((html.match(/data-ui="prompt-card"/g) ?? []).length).toBe(12)
    expect(html).toMatch(/<input[^>]*id="gallery-search"[^>]*disabled=""/)
    expect(html).toContain('Search is unavailable until an approved graph-query contract exists.')
    expect(html).toContain(`rel="next" href="/en/prompts/${mediaType}?page=2"`)
    expect(html).not.toContain('href="undefined"')
  })

  it('keeps previous/next pagination exact on the second page', () => {
    const fixture = P3_GOLDEN_FIXTURES.gallery.complete as GalleryPage
    const page = projectGalleryPage(fixture, {
      mediaType: 'image',
      page: 2,
      pageSize: 12,
      totalItems: 24,
      filterState: { output: 'image' },
    })
    const html = renderToStaticMarkup(<PageRouteView page={page} />)

    expectOrdered(html)
    expect(html).toContain('Showing image results · page 2 of 2')
    expect(html).toContain('rel="prev" href="/en/prompts/image?page=1"')
    expect(html).not.toContain('rel="next"')
  })

  it.each(['partial', 'stale'] as const)('renders an honest %s residual state', (state) => {
    const html = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.gallery[state]} />)
    expectOrdered(html)
    expect(html).toContain(`data-module-state="${state === 'partial' ? 'unavailable' : 'stale'}"`)
    expect(html).toContain('data-generated-filler-count="0"')
  })
})
