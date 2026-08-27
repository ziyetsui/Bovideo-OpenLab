import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { PageRouteView } from '@/page/route-view'

const SECTION_ORDER = [
  'hub-hero',
  'hub-axes',
  'hub-featured',
  'hub-shelves',
  'hub-residual',
  'hub-method',
  'hub-related',
  'hub-cta',
] as const

const ordered = (html: string): boolean => {
  const positions = SECTION_ORDER.map((id) => html.indexOf(`data-section="${id}"`))
  return positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]!))
}

describe('Hub Bauhaus composition', () => {
  it('renders the wireframe hierarchy from qualified envelope links', () => {
    const html = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.hub.complete} />)

    expect(ordered(html)).toBe(true)
    expect(html).toContain('24 qualified inventory items')
    expect((html.match(/data-ui="prompt-card"/g) ?? []).length).toBe(24)
    expect(html).toContain('data-featured-modules')
    expect(html).toContain('data-browse-shelves')
    expect(html).toContain('data-snapshot-date')
    expect(html).toContain('data-generated-filler-count="0"')
    expect(html).toMatch(/<input[^>]*id="hub-search"[^>]*disabled=""/)
    expect(html).toContain('Search is unavailable until an approved graph-query contract exists.')
    expect(html).not.toContain('href="undefined"')
  })

  it.each(['partial', 'stale'] as const)('shows honest evidence states for the %s fixture', (state) => {
    const html = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.hub[state]} />)

    expect(ordered(html)).toBe(true)
    expect(html).toContain(`data-module-state="${state === 'partial' ? 'unavailable' : 'stale'}"`)
    expect(html).toContain('data-generated-filler-count="0"')
    expect(html).not.toContain('href="undefined"')
  })
})
