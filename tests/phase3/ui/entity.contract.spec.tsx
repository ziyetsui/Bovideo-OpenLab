import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { PageRouteView } from '@/page/route-view'

const SECTION_ORDER = [
  'entity-hero',
  'entity-recent',
  'entity-inventory',
  'entity-variables',
  'entity-creators',
  'entity-about',
  'entity-self-audit',
  'entity-related',
  'entity-cta',
] as const

const expectOrdered = (html: string) => {
  const positions = SECTION_ORDER.map((id) => html.indexOf(`data-section="${id}"`))
  expect(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]!))).toBe(true)
}

describe('Entity Bauhaus composition', () => {
  it('renders qualified inventory and a visible self-audit', () => {
    const html = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.entity.complete} />)

    expectOrdered(html)
    expect(html).toContain('data-entity-qualification')
    expect(html).toContain('Qualified entity')
    expect(html).toContain('data-section="entity-self-audit"')
    expect(html).toContain('all_gates_passed')
    expect((html.match(/data-ui="prompt-card"/g) ?? []).length).toBe(15)
    const inventory = html.slice(html.indexOf('data-section="entity-inventory"'), html.indexOf('data-section="entity-variables"'))
    expect((inventory.match(/data-ui="prompt-card"/g) ?? []).length).toBe(12)
    expect(html).toContain('data-generated-filler-count="0"')
  })

  it('never presents a failed qualification as approved', () => {
    const html = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.entity.partial} />)

    expectOrdered(html)
    expect(html).toContain('Entity not qualified for publication')
    expect(html).toContain('insufficient_usable_items')
    expect(html).toContain('data-module-state="unavailable"')
    expect(html).not.toContain('all_gates_passed')
  })

  it('keeps stale evidence visibly distinct', () => {
    const html = renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.entity.stale} />)

    expectOrdered(html)
    expect(html).toContain('data-module-state="stale"')
    expect(html).toContain('Candidate evidence; not indexable')
  })
})
