import { describe, expect, it } from 'vitest'

import { pageProjectionSchema } from '@/contracts/projection'
import { buildInternalNoindexProjections } from '@/page/local-internal-projector'
import { createPayloadActiveProjectionReader } from '../../../frontend/routes/payload-active-projection-reader'
import { buildPublicationProjectionBindings } from '@/publication/projection-bindings'
import { createInternalProjectionPublicationRequest } from '@/publication/payload-projection-command'
import { validatePageProjection } from '@/collections/PageProjections'

const HASH = `sha256:v1:${'a'.repeat(64)}`

const artifact = (id: string, sourceID: string, text: string) => ({
  id,
  sourceID,
  sourceVersion: HASH,
  title: `Prompt ${id.slice(-4)}`,
  text,
  mediaType: 'image' as const,
  observedAt: '2026-08-26T00:00:00.000Z',
})

describe('local internal projection publication', () => {
  const projections = buildInternalNoindexProjections({
    locale: 'en',
    publishVersion: 1,
    artifacts: [
      artifact('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 'Cinematic product image, soft daylight.'),
      artifact('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', 'Anime city at dusk.'),
    ],
  })

  it('materializes Hub, Gallery, Entity, and Detail pages as noindex projections', () => {
    expect(projections.map((projection) => projection.family)).toEqual(['hub', 'gallery', 'entity', 'detail'])
    for (const projection of projections) {
      expect(pageProjectionSchema.parse(projection).page.index_state).toBe('discoverable_noindex')
      expect(JSON.stringify(projection)).not.toContain('pbs.twimg.com')
      expect(projection.state).toBe('released')
    }
  })

  it('binds every route to the exact immutable projection for one publication version', () => {
    const bindings = buildPublicationProjectionBindings({ publishVersion: 1, projections })
    expect(bindings).toHaveLength(4)
    expect(new Set(bindings.map((binding) => binding.route)).size).toBe(4)
    expect(bindings.every((binding) => binding.publish_version === 1 && binding.internal_noindex)).toBe(true)
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
    const request = createInternalProjectionPublicationRequest({ correlationId: '00000000-0000-4000-8000-000000000302' }) as { locale?: string }
    expect(() => { request.locale = 'en' }).not.toThrow()
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
