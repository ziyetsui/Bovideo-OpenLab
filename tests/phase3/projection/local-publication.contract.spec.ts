import { describe, expect, it } from 'vitest'

import { pageProjectionSchema } from '@/contracts/projection'
import { buildInternalNoindexProjections } from '@/page/local-internal-projector'
import { createPayloadActiveProjectionReader } from '../../../frontend/routes/payload-active-projection-reader'
import { buildPublicationProjectionBindings } from '@/publication/projection-bindings'
import { createInternalProjectionPublicationRequest } from '@/publication/payload-projection-command'
import { validatePageProjection } from '@/collections/PageProjections'

const HASH = `sha256:v1:${'a'.repeat(64)}`

const artifact = (id: string, sourceID: string, text: string, mediaType: 'image' | 'video' = 'image') => ({
  id,
  sourceID,
  sourceVersion: HASH,
  title: `Prompt ${id.slice(-4)}`,
  text,
  mediaType,
  observedAt: '2026-08-26T00:00:00.000Z',
  originalLanguage: 'en',
  media: [{
    media_evidence_id: '00000000-0000-4000-8000-000000000501', source_ref: 1,
    provider: 'x' as const, provider_media_id: `media-${id}`, media_type: mediaType,
    width: 1200, height: 675, duration_ms: null,
    remote_url: mediaType === 'image'
      ? 'https://pbs.twimg.com/media/projected-card.jpg'
      : 'https://video.twimg.com/ext_tw_video/projected-card.mp4',
    thumbnail_url: mediaType === 'video' ? 'https://pbs.twimg.com/media/projected-card-thumb.jpg' : null,
    observed_at: '2026-08-26T00:00:00.000Z', rights_state: 'metadata_only' as const,
    sensitive_content_state: 'allowed' as const, content_hash: HASH,
    visibility: 'internal_preview' as const, delivery_target: 'x_cdn' as const,
    preview_noindex: true, attribution_url: 'https://x.com/example/status/1',
  }],
})

describe('local internal projection publication', () => {
  const projections = buildInternalNoindexProjections({
    locale: 'en',
    publishVersion: 1,
    artifacts: [
      {
        ...artifact('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 'Cinematic product image, soft daylight.'),
        entityRefs: [
          { id: '00000000-0000-4000-8000-000000000401', kind: 'model' as const, stableKey: 'model:higgsfield', label: 'Higgsfield', promotionState: 'reviewed' as const },
          { id: '00000000-0000-4000-8000-000000000402', kind: 'use_case' as const, stableKey: 'use_case:product-showcase', label: 'Product showcase', promotionState: 'qualified' as const },
          { id: '00000000-0000-4000-8000-000000000403', kind: 'style' as const, stableKey: 'style:cinematic', label: 'Cinematic', promotionState: 'candidate' as const },
        ],
      },
      {
        ...artifact('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', 'Anime city at dusk.', 'video'),
        entityRefs: [{ id: '00000000-0000-4000-8000-000000000401', kind: 'model' as const, stableKey: 'model:higgsfield', label: 'Higgsfield', promotionState: 'reviewed' as const }],
      },
    ],
  })

  it('materializes every real internal route family from imported artifacts without candidates', () => {
    expect(projections.map((projection) => projection.family)).toEqual(['hub', 'gallery', 'gallery', 'entity', 'entity', 'detail', 'detail'])
    expect(projections.map((projection) => projection.page.route)).toEqual([
      '/en/prompts',
      '/en/prompts/image',
      '/en/prompts/video',
      '/en/prompts/models/higgsfield',
      '/en/prompts/use-cases/product-showcase',
      expect.stringMatching(/^\/en\/prompts\/prompt-0101-[0-9a-f-]+$/),
      expect.stringMatching(/^\/en\/prompts\/prompt-0102-[0-9a-f-]+$/),
    ])
    expect(projections.map((projection) => projection.page.route)).not.toContain('/en/prompts/styles/cinematic')
    expect(projections.find((projection) => projection.family === 'hub')?.slots.map((slot) => slot.slot_key)).toEqual([
      'featured', 'trending', 'tasks', 'camera_motion', 'models', 'styles', 'collections', 'creators',
      'outputs', 'use_cases', 'techniques',
    ])
    expect(projections.filter((projection) => projection.family === 'gallery').every((projection) =>
      ['use_cases', 'styles', 'subjects', 'featured', 'models', 'subject_band', 'residual', 'related']
        .every((key) => projection.slots.some((slot) => slot.slot_key === key)))).toBe(true)
    expect(projections.filter((projection) => projection.family === 'entity').every((projection) =>
      ['top_prompts', 'all_prompts', 'facets', 'variables', 'creators', 'evidence', 'faq', 'related']
        .every((key) => projection.slots.some((slot) => slot.slot_key === key)))).toBe(true)
    expect(projections.find((projection) => projection.family === 'hub')?.slots.find((slot) => slot.slot_key === 'featured')?.items)
      .toHaveLength(2)
    expect(projections.find((projection) => projection.page.route === '/en/prompts/image')?.slots.find((slot) => slot.slot_key === 'featured')?.items)
      .toHaveLength(1)
    const firstHubCard = projections.find((projection) => projection.family === 'hub')?.slots.find((slot) => slot.slot_key === 'featured')?.items[0]
    expect(firstHubCard).toMatchObject({
      prompt_text: 'Cinematic product image, soft daylight.',
      prompt_language: 'en',
      media: [expect.objectContaining({ remote_url: 'https://pbs.twimg.com/media/projected-card.jpg' })],
      link_policy: 'link',
      render_target: 'page',
      target_indexability: 'noindex',
      tags: expect.arrayContaining([
        expect.objectContaining({ node_ref: 'model:higgsfield', link_policy: 'filter_state', target_indexability: 'noindex' }),
        expect.objectContaining({ node_ref: 'use_case:product-showcase', link_policy: 'filter_state', target_indexability: 'noindex' }),
      ]),
    })
    expect(JSON.stringify(firstHubCard)).not.toContain('style:cinematic')
    for (const projection of projections) {
      expect(pageProjectionSchema.parse(projection).page.index_state).toBe('discoverable_noindex')
      expect(projection.state).toBe('released')
    }

    const hub = projections.find((projection) => projection.family === 'hub')!
    expect(hub.navigation.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_ref: 'output:image', href: '/en/prompts/image', link_policy: 'link', target_indexability: 'noindex' }),
      expect.objectContaining({ node_ref: 'output:video', href: '/en/prompts/video', link_policy: 'link', target_indexability: 'noindex' }),
    ]))
    expect(hub.slots.find((slot) => slot.slot_key === 'outputs')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_ref: 'output:image', href: '/en/prompts/image' }),
      expect.objectContaining({ node_ref: 'output:video', href: '/en/prompts/video' }),
    ]))
    const detail = projections.find((candidate) => candidate.family === 'detail' && candidate.page.route.includes('prompt-0101'))!
    expect(detail.page.page_type === 'detail' && detail.page.detail.questions[5]).toMatchObject({
      id: 'examples', state: 'present', content: { mediaRefs: ['00000000-0000-4000-8000-000000000501'] },
    })
    expect(detail.slots.find((slot) => slot.slot_key === 'related')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_ref: 'output:image', href: '/en/prompts/image', render_target: 'page' }),
      expect.objectContaining({ node_ref: 'model:higgsfield', href: '/en/prompts/models/higgsfield', render_target: 'page' }),
    ]))
  })

  it('binds every route to the exact immutable projection for one publication version', () => {
    const bindings = buildPublicationProjectionBindings({ publishVersion: 1, projections })
    expect(bindings).toHaveLength(7)
    expect(new Set(bindings.map((binding) => binding.route)).size).toBe(7)
    expect(bindings.every((binding) => binding.publish_version === 1 && binding.internal_noindex)).toBe(true)
  })

  it('forms one traversable hub → gallery → entity → detail page graph', () => {
    const routes = new Set(projections.map((projection) => projection.page.route))
    const hub = projections.find((projection) => projection.family === 'hub')!
    const galleryHref = hub.slots.find((slot) => slot.slot_key === 'outputs')?.items
      .find((item) => 'node_ref' in item && item.node_ref === 'output:image')?.href
    const gallery = projections.find((projection) => projection.page.route === galleryHref)!
    const entityHref = gallery.slots.find((slot) => slot.slot_key === 'models')?.items
      .find((item) => 'node_ref' in item && item.node_ref === 'model:higgsfield')?.href
    const entity = projections.find((projection) => projection.page.route === entityHref)!
    const detailHref = entity.slots.find((slot) => slot.slot_key === 'top_prompts')?.items
      .find((item) => 'prompt_ref' in item)?.href

    expect(galleryHref).toBe('/en/prompts/image')
    expect(entityHref).toBe('/en/prompts/models/higgsfield')
    expect(detailHref).toMatch(/^\/en\/prompts\/prompt-/)
    expect([galleryHref, entityHref, detailHref].every((route) => typeof route === 'string' && routes.has(route))).toBe(true)
  })

  it('omits an empty gallery and deduplicates repeated artifact evidence into one detail route', () => {
    const imageOnly = artifact('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000203', 'Only image evidence.')
    const result = buildInternalNoindexProjections({ locale: 'en', publishVersion: 2, artifacts: [imageOnly, imageOnly] })

    expect(result.filter((projection) => projection.family === 'gallery').map((projection) => projection.page.route)).toEqual(['/en/prompts/image'])
    expect(result.filter((projection) => projection.family === 'detail')).toHaveLength(1)
    expect(new Set(result.map((projection) => projection.page.route)).size).toBe(result.length)
  })

  it('partitions galleries into canonically bound page projections so every card remains discoverable', () => {
    const artifacts = Array.from({ length: 101 }, (_, index) => artifact(
      `00000000-0000-4000-8000-${String(index + 500).padStart(12, '0')}`,
      `00000000-0000-4000-8000-${String(index + 700).padStart(12, '0')}`,
      `Image ${index}.`,
    ))
    const galleries = buildInternalNoindexProjections({ locale: 'en', publishVersion: 3, artifacts })
      .filter((projection) => projection.family === 'gallery')
    const first = galleries.find((projection) => projection.page.route === '/en/prompts/image')!
    const second = galleries.find((projection) => projection.page.route === '/en/prompts/image/page/2')!

    expect(galleries).toHaveLength(2)
    expect(first.page.page_type === 'gallery' && first.page.page_size).toBe(100)
    expect(first.slots.find((slot) => slot.slot_key === 'featured')?.items).toHaveLength(100)
    expect(first.page.page_type === 'gallery' && first.page.next_page).toBe('/en/prompts/image/page/2')
    expect(second.page.page_type === 'gallery' && second.page.page).toBe(2)
    expect(second.slots.find((slot) => slot.slot_key === 'featured')?.items).toHaveLength(1)
    expect(second.page.page_type === 'gallery' && second.page.previous_page).toBe('/en/prompts/image')
    expect(first.navigation.items.filter((item) => item.node_ref === 'output:image')).toHaveLength(1)
    expect(first.navigation.items.find((item) => item.node_ref === 'output:image')?.href).toBe('/en/prompts/image')
  })

  it('reconciles 1,043 artifacts into unique routes, bindings, navigation and discoverable gallery cards', () => {
    const artifacts = Array.from({ length: 1_043 }, (_, index) => artifact(
      `00000000-0000-4000-8000-${String(index + 2_000).padStart(12, '0')}`,
      `00000000-0000-4000-8000-${String(index + 4_000).padStart(12, '0')}`,
      `Source prompt ${index}.`,
    ))
    const result = buildInternalNoindexProjections({ locale: 'en', publishVersion: 5, artifacts })
    const bindings = buildPublicationProjectionBindings({ publishVersion: 5, projections: result })
    const galleryPromptRefs = result
      .filter((projection) => projection.family === 'gallery')
      .flatMap((projection) => projection.slots.find((slot) => slot.slot_key === 'featured')?.items ?? [])
      .flatMap((item) => 'prompt_ref' in item ? [item.prompt_ref.id] : [])

    expect(new Set(result.map((projection) => projection.page.route)).size).toBe(result.length)
    expect(bindings).toHaveLength(result.length)
    expect(new Set(bindings.map((binding) => binding.route)).size).toBe(result.length)
    expect(galleryPromptRefs).toHaveLength(1_043)
    expect(new Set(galleryPromptRefs).size).toBe(1_043)
    for (const projection of result) {
      const refs = projection.navigation.items.map((item) => item.node_ref)
      expect(new Set(refs).size).toBe(refs.length)
      expect(projection.navigation.items.filter((item) => item.node_ref === 'output:image')).toHaveLength(1)
    }
  })

  it('materializes medium page nodes from observed inventory without fabricating taxonomy', () => {
    const hub = buildInternalNoindexProjections({ locale: 'en', publishVersion: 4, artifacts: [
      artifact('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000204', 'No taxonomy.'),
    ] }).find((projection) => projection.family === 'hub')!

    expect(hub.slots.find((slot) => slot.slot_key === 'outputs')?.items).toEqual([
      expect.objectContaining({ node_ref: 'output:image', href: '/en/prompts/image', edge_ref: expect.any(String) }),
    ])
  })

  it('accepts released projection bytes only through the internal publication capability', () => {
    const projection = projections[0]!
    const data = {
      projection_id: projection.projection_id,
      page_id: projection.page_id,
      locale: projection.locale,
      family: projection.family,
      state: projection.state,
      dependency_hash: projection.dependency_hash,
      content_hash: projection.content_hash,
      link_hash: projection.link_hash,
      schema_hash: projection.schema_hash,
      renderer_version: projection.renderer_version,
      validation_report_ref: projection.validation_report_ref,
      workflow_run: 1,
      projection: { page: projection.page, navigation: projection.navigation, slots: projection.slots },
    }
    expect(() => validatePageProjection({ data, operation: 'create' } as never)).toThrow(/trusted release/i)
    expect(validatePageProjection({ data, operation: 'create', req: createInternalProjectionPublicationRequest({ correlationId: '00000000-0000-4000-8000-000000000301' }) } as never))
      .toMatchObject({ state: 'released' })
  })

  it('keeps the private capability request extensible for Payload local request fields', () => {
    const service = { stable_id: '00000000-0000-4000-8000-000000000303', identity_kind: 'service' }
    const request = createInternalProjectionPublicationRequest({ correlationId: '00000000-0000-4000-8000-000000000302', user: service }) as { locale?: string; user?: unknown }
    expect(() => { request.locale = 'en' }).not.toThrow()
    expect(request.user).toBe(service)
  })

  it('resolves only the projection bound by active version, route, locale and family', async () => {
    const bindings = buildPublicationProjectionBindings({ publishVersion: 1, projections })
    const reader = createPayloadActiveProjectionReader({
      async find(input) {
        if (input.collection === 'active-publication-pointers') return { docs: [{ publish_version: 1 }] }
        if (input.collection === 'publication-projections') {
          const route = (input.where as { and: Array<{ route?: { equals?: string } }> }).and.find((clause) => clause.route)?.route?.equals
          const binding = bindings.find((candidate) => candidate.route === route)
          return { docs: binding === undefined ? [] : [{ projection: binding.projection }] }
        }
        return { docs: [] }
      },
      async findByID(input) {
        const projection = projections.find((candidate) => candidate.projection_id === input.id)
        return projection === undefined ? undefined : {
          ...projection,
          id: 99,
          workflow_run: 12,
          createdAt: '2026-08-26T00:00:00.000Z',
          updatedAt: '2026-08-26T00:00:00.000Z',
          page: undefined,
          navigation: undefined,
          slots: undefined,
          projection: { page: projection.page, navigation: projection.navigation, slots: projection.slots },
        }
      },
    })

    await expect(reader.readBoundProjection({ family: 'hub', locale: 'en', route: '/en/prompts' }))
      .resolves.toMatchObject({ publishVersion: 1, projectionId: projections[0]!.projection_id })
    await expect(reader.readBoundProjection({ family: 'hub', locale: 'en', route: '/en/prompts/unknown' }))
      .resolves.toBeUndefined()
  })
})
