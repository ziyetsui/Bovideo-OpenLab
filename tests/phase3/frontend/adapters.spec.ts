import { describe, expect, it } from 'vitest'

import { adaptFrontendProjection, adaptGalleryPage, adaptHubPage } from '../../../frontend/projection/adapt'
import { frontendPageModelSchema } from '../../../frontend/projection/types'
import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import type { GalleryPage, HubPage } from '@/page/schema'
import { phase3PreviewProjectionFor } from './preview-adapter'

describe('frontend render-model adapters', () => {
  it('rejects a candidate page model that attempts to become an indexable link', () => {
    expect(() => frontendPageModelSchema.parse({
      family: 'hub',
      title: 'Hub',
      navigation: [],
      slots: [{
        key: 'models',
        items: [{
          kind: 'node',
          label: 'Candidate model',
          node_ref: 'candidate-model',
          edge_ref: null,
          evidence_state: 'candidate',
          link_policy: 'link',
          href: '/en/prompts/models/x',
          render_target: 'page',
          target_indexability: 'indexable',
        }],
      }],
    })).toThrow()
  })

  it('adapts page envelopes into read-only family render models', () => {
    const hub = adaptHubPage(P3_GOLDEN_FIXTURES.hub.complete as HubPage)
    const gallery = adaptGalleryPage(P3_GOLDEN_FIXTURES.gallery.complete as GalleryPage)

    expect(hub).toMatchObject({ family: 'hub', title: P3_GOLDEN_FIXTURES.hub.complete.title })
    expect(gallery).toMatchObject({ family: 'gallery', title: P3_GOLDEN_FIXTURES.gallery.complete.title })
    expect(Object.isFrozen(hub.navigation)).toBe(true)
    expect(Object.isFrozen(gallery.slots)).toBe(true)
  })

  it('preserves complete projection card, link, tag, and evidence data', () => {
    const projection = phase3PreviewProjectionFor({ family: 'hub', locale: 'en', route: '/en/prompts' })
    if (projection === undefined) throw new Error('expected Hub preview projection')

    const model = adaptFrontendProjection(projection)
    const featured = model.slots.find((slot) => slot.key === 'featured')?.items[0]
    const output = model.slots.find((slot) => slot.key === 'outputs')?.items[0]

    expect(featured).toMatchObject({
      kind: 'prompt_card',
      prompt_ref: { type: 'artifact', id: '00000000-0000-4000-8000-000000000801' },
      title: 'Cinematic product shot',
      summary: 'A reviewed product prompt.',
      prompt_text: 'Use the supplied product at dusk.',
      prompt_language: 'en',
      media: [expect.objectContaining({ remote_url: 'https://pbs.twimg.com/media/phase3-browser-evidence.jpg' })],
      tags: [
        {
          node_ref: 'image-output',
          edge_ref: null,
          evidence_state: 'candidate',
          link_policy: 'filter_state',
          href: '/en/prompts/image?image-output=candidate',
          render_target: 'filter',
          target_indexability: 'noindex',
        },
        {
          node_ref: 'campaign',
          edge_ref: null,
          evidence_state: 'candidate',
          link_policy: 'filter_state',
          href: '/en/prompts/image?campaign=candidate',
          render_target: 'filter',
          target_indexability: 'noindex',
        },
      ],
      evidence_state: 'qualified',
      link_policy: 'link',
      href: '/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001',
      render_target: 'page',
      target_indexability: 'noindex',
    })
    expect(output).toEqual({
      kind: 'node',
      label: 'Image prompts',
      node_ref: 'output:image',
      edge_ref: '00000000-0000-4000-8000-000000000721',
      evidence_state: 'reviewed',
      link_policy: 'link',
      href: '/en/prompts/image',
      render_target: 'page',
      target_indexability: 'noindex',
    })
    expect(Object.isFrozen(featured)).toBe(true)
  })
})
