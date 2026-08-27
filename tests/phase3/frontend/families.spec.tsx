import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EntityPage } from '../../../frontend/pages/entity-page'
import { GalleryPage } from '../../../frontend/pages/gallery-page'
import { HubPage } from '../../../frontend/pages/hub-page'
import { adaptFrontendProjection } from '../../../frontend/projection/adapt'
import type { FrontendEntityModel, FrontendGalleryModel, FrontendHubModel } from '../../../frontend/projection/types'
import { phase3PreviewProjectionFor } from './preview-adapter'

const expectInOrder = (html: string, values: readonly string[]) => {
  const positions = values.map((value) => html.indexOf(value))
  expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]!))).toBe(true)
}

const node = (label: string, evidenceState: 'candidate' | 'reviewed' | 'qualified' = 'reviewed') => ({
  kind: 'node' as const,
  label,
  node_ref: label.toLowerCase().replaceAll(' ', '-'),
  edge_ref: null,
  evidence_state: evidenceState,
  link_policy: evidenceState === 'candidate' ? 'filter_state' as const : 'dead_text' as const,
  href: evidenceState === 'candidate' ? `/en/prompts?facet=${encodeURIComponent(label)}` : null,
  render_target: evidenceState === 'candidate' ? 'filter' as const : 'tag' as const,
  target_indexability: evidenceState === 'candidate' ? 'noindex' as const : 'none' as const,
})

const hubModel: FrontendHubModel = {
  family: 'hub',
  title: 'Prompt discovery',
  h1: 'Prompt discovery',
  route: '/en/prompts',
  locale: 'en',
  navigation: [],
  breadcrumbs: [],
  inventory_count: 12,
  snapshot_date: '2026-08-26',
  slots: [
    { key: 'outputs', items: [node('Image', 'candidate')] },
    { key: 'use_cases', items: [node('Campaign', 'candidate')] },
    { key: 'styles', items: [node('Editorial', 'candidate')] },
    { key: 'techniques', items: [node('Dolly zoom', 'candidate')] },
    { key: 'tasks', items: [node('Product photography', 'reviewed')] },
    { key: 'camera_motion', items: [node('Dolly zoom', 'reviewed')] },
    { key: 'models', items: [node('Model One', 'qualified')] },
  ],
}

const galleryModel: FrontendGalleryModel = {
  family: 'gallery',
  title: 'Image prompts',
  route: '/en/prompts/image',
  locale: 'en',
  navigation: [],
  breadcrumbs: [],
  media_type: 'image',
  page: 1,
  page_size: 12,
  total_items: 12,
  filter_state: { style: 'editorial' },
  next_page: '/en/prompts/image?page=2',
  previous_page: '/en/prompts/image?page=0',
  slots: [
    { key: 'use_cases', items: [node('Campaign', 'candidate')] },
    { key: 'styles', items: [node('Editorial', 'candidate')] },
    { key: 'subjects', items: [node('Portrait', 'candidate')] },
    { key: 'residual', items: [node('Residual image inventory', 'reviewed')] },
  ],
}

const unqualifiedEntity: FrontendEntityModel = {
  family: 'entity',
  title: 'Model One',
  route: '/en/prompts/models/model-one',
  locale: 'en',
  navigation: [],
  breadcrumbs: [],
  entity_kind: 'model',
  entity_slug: 'model-one',
  item_count: 2,
  creator_count: 1,
  qualification: {
    qualified: false,
    reason_codes: ['insufficient_usable_items'],
    usable_items: 2,
    independent_creators: 1,
  },
  slots: [],
}

describe('pSEO frontend page families', () => {
  it('renders adapter-driven qualified cards and candidate nodes through policy primitives', () => {
    const projection = phase3PreviewProjectionFor({ family: 'hub', locale: 'en', route: '/en/prompts' })
    if (projection === undefined) throw new Error('expected Hub preview projection')

    const html = renderToStaticMarkup(<HubPage model={adaptFrontendProjection(projection) as FrontendHubModel} />)

    expect(html).toContain('<article class="prompt-card"')
    expect(html).toContain('href="/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001"')
    expect(html).toContain('data-evidence-state="candidate"')
    expect(html).not.toContain('Explicit evidence')
  })

  it('keeps mandatory Hub Camera & Motion between task and model shelves', () => {
    const html = renderToStaticMarkup(<HubPage model={hubModel} />)

    expectInOrder(html, ['data-slot="tasks"', 'data-slot="camera_motion"', 'data-slot="models"', 'data-slot="footer"'])
  })

  it('renders all four supplied Hub discovery axes with their controls', () => {
    const html = renderToStaticMarkup(<HubPage model={hubModel} />)

    expectInOrder(html, ['data-axis="outputs"', 'data-axis="use_cases"', 'data-axis="styles"', 'data-axis="techniques"'])
    expect(html).toContain('Image')
    expect(html).toContain('Campaign')
    expect(html).toContain('Editorial')
    expect(html).toContain('Dolly zoom')
  })

  it('renders gallery candidate use-case, style, and subject facets as noindex filter state', () => {
    const html = renderToStaticMarkup(<GalleryPage model={galleryModel} />)

    expectInOrder(html, ['data-slot="use_cases"', 'data-slot="styles"', 'data-slot="subjects"'])
    expect(html).toContain('data-noindex="true"')
    expect(html).not.toContain('data-slot="technique"')
  })

  it('renders supplied Gallery residual evidence and canonical pagination', () => {
    const html = renderToStaticMarkup(<GalleryPage model={galleryModel} />)

    expect(html).toContain('Residual image inventory')
    expect(html).toContain('Reviewed evidence')
    expect(html).toContain('rel="prev" href="/en/prompts/image?page=0"')
    expect(html).toContain('rel="next" href="/en/prompts/image?page=2"')
  })

  it('shows truthful reviewed and qualified projection evidence labels', () => {
    const html = renderToStaticMarkup(<><HubPage model={hubModel} /><GalleryPage model={galleryModel} /><EntityPage model={{
      ...unqualifiedEntity,
      slots: [{ key: 'evidence', items: [node('Primary source', 'qualified')] }],
    }} /></>)

    expect(html).toContain('Reviewed evidence')
    expect(html).toContain('Qualified evidence')
    expect(html).not.toContain('Explicit evidence')
  })

  it('renders entity qualification failure as visible noindex state', () => {
    const html = renderToStaticMarkup(<EntityPage model={unqualifiedEntity} />)

    expect(html).toContain('data-qualification="unqualified"')
    expect(html).toContain('Noindex')
    expect(html).toContain('data-slot="evidence"')
    expect(html).toContain('data-slot="faq"')
  })
})
