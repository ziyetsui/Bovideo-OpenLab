// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { GalleryPage } from '../../../frontend/pages/gallery-page'
import { HubPage } from '../../../frontend/pages/hub-page'
import type { FrontendGalleryModel, FrontendHubModel } from '../../../frontend/projection/types'

const candidate = (label: string, axis: string) => ({
  kind: 'node' as const,
  label,
  node_ref: label.toLowerCase().replaceAll(' ', '-'),
  edge_ref: null,
  evidence_state: 'candidate' as const,
  link_policy: 'filter_state' as const,
  href: `/en/prompts?${axis}=${label.toLowerCase()}`,
  render_target: 'filter' as const,
  target_indexability: 'noindex' as const,
})

const card = (id: string, title: string, tags: readonly string[]) => ({
  kind: 'prompt_card' as const,
  prompt_ref: { type: 'artifact' as const, id },
  title,
  summary: `${title} summary`,
  tags: tags.map((tag) => ({
    node_ref: tag.toLowerCase().replaceAll(' ', '-'),
    edge_ref: null,
    evidence_state: 'candidate' as const,
    link_policy: 'dead_text' as const,
    href: null,
    render_target: 'tag' as const,
    target_indexability: 'none' as const,
  })),
  evidence_state: 'qualified' as const,
  link_policy: 'link' as const,
  href: `/en/prompts/${id}`,
  render_target: 'page' as const,
  target_indexability: 'indexable' as const,
})

const base = {
  title: 'Prompts',
  route: '/en/prompts',
  locale: 'en',
  navigation: [],
  breadcrumbs: [],
}

afterEach(cleanup)

describe('frontend noindex facet interactions', () => {
  it('filters Hub results by query and selected discovery axes without changing links', () => {
    const model: FrontendHubModel = {
      ...base,
      family: 'hub',
      slots: [
        { key: 'outputs', items: [candidate('Image', 'output'), candidate('Video', 'output')] },
        { key: 'use_cases', items: [candidate('Campaign', 'use_case')] },
        { key: 'featured', items: [
          card('00000000-0000-4000-8000-000000000811', 'Image campaign', ['Image', 'Campaign']),
          card('00000000-0000-4000-8000-000000000812', 'Video tutorial', ['Video']),
        ] },
      ],
    }

    render(<HubPage model={model} />)
    const results = screen.getByTestId('hub-results')
    expect(results.textContent).toContain('Browse state — no filter is active.')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search prompts' }), { target: { value: 'campaign' } })
    expect(results.textContent).toContain('1 result')
    expect(within(results).getByRole('article').textContent).toContain('Image campaign')

    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    expect(results.textContent).toContain('0 results')
    expect(screen.getByRole('button', { name: 'Video' }).getAttribute('aria-pressed')).toBe('true')
    expect(window.location.href).toBe('http://localhost:3000/')
  })

  it('uses OR within a Gallery axis and AND across active axes', () => {
    const model: FrontendGalleryModel = {
      ...base,
      family: 'gallery',
      route: '/en/prompts/image',
      media_type: 'image',
      page: 1,
      page_size: 12,
      total_items: 3,
      filter_state: {},
      next_page: null,
      previous_page: null,
      slots: [
        { key: 'use_cases', items: [candidate('Campaign', 'use_case'), candidate('Portrait', 'use_case')] },
        { key: 'styles', items: [candidate('Editorial', 'style'), candidate('Cinematic', 'style')] },
        { key: 'featured', items: [
          card('00000000-0000-4000-8000-000000000821', 'Campaign editorial', ['Campaign', 'Editorial']),
          card('00000000-0000-4000-8000-000000000822', 'Campaign cinematic', ['Campaign', 'Cinematic']),
          card('00000000-0000-4000-8000-000000000823', 'Portrait editorial', ['Portrait', 'Editorial']),
        ] },
      ],
    }

    render(<GalleryPage model={model} />)
    const results = screen.getByTestId('gallery-results')

    fireEvent.click(screen.getByRole('button', { name: 'Editorial' }))
    expect(results.textContent).toContain('2 results')
    fireEvent.click(screen.getByRole('button', { name: 'Cinematic' }))
    expect(results.textContent).toContain('3 results')
    fireEvent.click(screen.getByRole('button', { name: 'Campaign' }))
    expect(results.textContent).toContain('2 results')
    expect(within(results).getAllByRole('article')).toHaveLength(2)
    expect(window.location.href).toBe('http://localhost:3000/')
  })
})
