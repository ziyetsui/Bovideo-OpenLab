import { describe, expect, it } from 'vitest'

import { pageProjectionSchema } from '@/contracts/projection'
import { mediaEvidenceSchema, projectedNodeItemSchema, projectedPromptCardSchema } from '@/contracts/projection'
import { navigationProjectionSchema } from '@/contracts/projection'
import { edgeSchema } from '@/contracts/graph'
import { workflowRunJobTypeSchema } from '@/contracts/workflow-run'
import { Edges } from '@/collections/Edges'
import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { normalizeEdgeRelationCompatibilityInput } from '@/collections/edge-relation-normalization'

const HASH = `sha256:v1:${'0'.repeat(64)}`
const UUID_A = '00000000-0000-4000-8000-000000000001'
const UUID_B = '00000000-0000-4000-8000-000000000002'

const canonicalEdge = {
  id: UUID_A,
  schema_version: 1,
  from: { type: 'artifact' as const, id: UUID_A },
  relation: 'used_for',
  to: { type: 'taxonomy_node' as const, id: UUID_B },
  evidence_refs: [{ type: 'source' as const, id: UUID_A }],
  evidence_revision: HASH,
  confidence: 0.9,
  review_state: 'approved' as const,
  valid_from: null,
  valid_to: null,
}

const xPreviewMedia = {
  media_evidence_id: UUID_A,
  source_ref: 1,
  provider: 'x',
  provider_media_id: '1850000000000000000',
  media_type: 'image' as const,
  width: 1920,
  height: 1080,
  duration_ms: null,
  remote_url: 'https://pbs.twimg.com/media/example.jpg',
  thumbnail_url: null,
  observed_at: '2026-08-26T00:00:00.000Z',
  rights_state: 'display_licensed' as const,
  sensitive_content_state: 'allowed' as const,
  content_hash: HASH,
  visibility: 'internal_preview' as const,
  delivery_target: 'x_cdn' as const,
  preview_noindex: true,
  attribution_url: 'https://x.com/example/status/1850000000000000000',
}

describe('projection contracts', () => {
  it('rejects a candidate edge presented as a page link', () => {
    const page = P3_GOLDEN_FIXTURES.hub.complete
    expect(() => pageProjectionSchema.parse({
      projection_id: '00000000-0000-4000-8000-000000000601',
      page_id: page.page_id,
      locale: page.locale,
      family: page.page_type,
      state: 'validated',
      dependency_hash: HASH,
      page,
      navigation: { version: 'v1', items: [] },
      slots: [{
        slot_key: 'models',
        renderer: 'node_shelf',
        source_mode: 'graph_query',
        items: [{
          node_ref: 'model:nano-banana',
          evidence_state: 'candidate',
          link_policy: 'link',
          href: '/en/prompts/models/nano-banana',
          render_target: 'page',
          target_indexability: 'indexable',
        }],
      }],
      content_hash: HASH,
      link_hash: HASH,
      schema_hash: HASH,
    })).toThrow()
  })

  it('accepts every worker job required by the projection pipeline', () => {
    for (const type of ['extract_graph', 'generate_module', 'project_page', 'validate_release', 'observe_search'])
      expect(workflowRunJobTypeSchema.parse(type)).toBe(type)
  })

  it('rejects legacy graph relations at the canonical persistence boundary', () => {
    const relationField = Edges.fields?.find((field) => 'name' in field && field.name === 'relation')
    expect(relationField).toMatchObject({ options: expect.arrayContaining(['generated_with', 'used_for', 'produces']) })
    const normalize = Edges.hooks?.beforeValidate?.[0]
    for (const relation of ['authored_by', 'belongs_to', 'supports']) {
      expect(() => normalize?.({ data: { relation } } as never)).toThrow(/explicit contextual migration/i)
      expect(() => normalizeEdgeRelationCompatibilityInput({ relation })).toThrow(/explicit contextual migration/i)
      expect(() => edgeSchema.parse({ ...canonicalEdge, relation })).toThrow()
    }
    expect(normalizeEdgeRelationCompatibilityInput({ relation: 'used_for' })).toEqual({ relation: 'used_for' })
  })

  it('permits candidate filter state only for an explicitly noindex filter target', () => {
    expect(() => projectedNodeItemSchema.parse({
      node_ref: 'style:retro',
      edge_ref: UUID_A,
      evidence_state: 'candidate',
      link_policy: 'filter_state',
      href: '/en/prompts?style=retro',
      render_target: 'filter',
      target_indexability: 'indexable',
    })).toThrow(/noindex/i)
    expect(projectedNodeItemSchema.parse({
      node_ref: 'style:retro',
      edge_ref: UUID_A,
      evidence_state: 'candidate',
      link_policy: 'filter_state',
      href: '/en/prompts?style=retro',
      render_target: 'filter',
      target_indexability: 'noindex',
    })).toMatchObject({ link_policy: 'filter_state', target_indexability: 'noindex' })
    expect(projectedNodeItemSchema.parse({
      node_ref: 'style:retro',
      edge_ref: UUID_A,
      evidence_state: 'candidate',
      link_policy: 'dead_text',
      href: null,
      render_target: 'tag',
      target_indexability: 'none',
    })).toMatchObject({ render_target: 'tag' })
  })

  it('keeps noindex page destinations clickable and carries renderer-ready prompt media', () => {
    expect(projectedNodeItemSchema.parse({
      label: 'Image prompts',
      node_ref: 'output:image',
      edge_ref: UUID_A,
      evidence_state: 'reviewed',
      link_policy: 'link',
      href: '/en/prompts/image',
      render_target: 'page',
      target_indexability: 'noindex',
    })).toMatchObject({ href: '/en/prompts/image', target_indexability: 'noindex' })

    expect(projectedPromptCardSchema.parse({
      prompt_ref: { type: 'artifact', id: UUID_A },
      title: 'Media-backed prompt',
      summary: 'Reviewed preview',
      prompt_text: 'Keep these exact prompt bytes.',
      prompt_language: 'en',
      media: [xPreviewMedia],
      tags: [],
      evidence_state: 'reviewed',
      link_policy: 'link',
      href: `/en/prompts/media-backed-${UUID_A}`,
      render_target: 'page',
      target_indexability: 'noindex',
    })).toMatchObject({
      prompt_text: 'Keep these exact prompt bytes.',
      media: [expect.objectContaining({ media_evidence_id: UUID_A })],
    })
  })

  it('keeps X media in noindex preview and allows public media only from approved CDN rights', () => {
    expect(mediaEvidenceSchema.parse(xPreviewMedia)).toMatchObject({ visibility: 'internal_preview', preview_noindex: true })
    expect(() => mediaEvidenceSchema.parse({ ...xPreviewMedia, thumbnail_url: 'https://third-party.invalid/poster.jpg' })).toThrow(/thumbnail.*twimg/i)
    expect(() => mediaEvidenceSchema.parse({ ...xPreviewMedia, visibility: 'public', preview_noindex: false })).toThrow(/public media/i)
    expect(() => mediaEvidenceSchema.parse({
      ...xPreviewMedia,
      remote_url: 'https://media.example.invalid/public/example.jpg',
      visibility: 'public',
      delivery_target: 'approved_public_cdn',
      preview_noindex: false,
      rights_state: 'first_party',
      attribution_url: null,
    })).toThrow(/public media/i)
    expect(() => mediaEvidenceSchema.parse({
      ...xPreviewMedia,
      provider: 'approved_cdn',
      remote_url: 'https://media.example.invalid/public/example.jpg',
      thumbnail_url: 'https://pbs.twimg.com/media/example-thumb.jpg',
      visibility: 'public',
      delivery_target: 'approved_public_cdn',
      preview_noindex: false,
      rights_state: 'redistribution_licensed',
      attribution_url: null,
    })).toThrow(/public media/i)
    expect(() => mediaEvidenceSchema.parse({
      ...xPreviewMedia,
      provider: 'approved_cdn',
      remote_url: 'https://video.twimg.com/ext_tw_video/example.mp4',
      visibility: 'public',
      delivery_target: 'approved_public_cdn',
      preview_noindex: false,
      rights_state: 'redistribution_licensed',
      attribution_url: null,
    })).toThrow(/public media/i)
    expect(() => mediaEvidenceSchema.parse({
      ...xPreviewMedia,
      provider: 'approved_cdn',
      remote_url: 'https://media.example.invalid/public/example.jpg',
      visibility: 'public',
      delivery_target: 'approved_public_cdn',
      preview_noindex: false,
      rights_state: 'display_licensed',
      attribution_url: null,
    })).toThrow(/redistribution_licensed|first_party/i)
    expect(mediaEvidenceSchema.parse({
      ...xPreviewMedia,
      provider: 'approved_cdn',
      remote_url: 'https://media.example.invalid/public/example.jpg',
      visibility: 'public',
      delivery_target: 'approved_public_cdn',
      preview_noindex: false,
      rights_state: 'redistribution_licensed',
      attribution_url: null,
    })).toMatchObject({ visibility: 'public', delivery_target: 'approved_public_cdn' })
  })

  it('rejects candidate navigation with a page or sitemap target', () => {
    expect(() => navigationProjectionSchema.parse({
      version: 'v1',
      items: [{
        node_ref: 'style:retro',
        edge_ref: UUID_A,
        evidence_state: 'candidate',
        link_policy: 'filter_state',
        href: '/en/prompts?style=retro',
        render_target: 'filter',
        target_indexability: 'noindex',
        label: 'Retro',
        promotion_state: 'candidate',
        target_page_id: UUID_B,
      }],
    })).toThrow(/candidate navigation/i)
    expect(() => navigationProjectionSchema.parse({
      version: 'v1',
      items: [{
        node_ref: 'style:retro',
        edge_ref: UUID_A,
        evidence_state: 'candidate',
        link_policy: 'filter_state',
        href: '/en/prompts?style=retro',
        render_target: 'filter',
        target_indexability: 'indexable',
        label: 'Retro',
        promotion_state: 'candidate',
        target_page_id: null,
      }],
    })).toThrow()
  })

  it('rejects candidate or fabricated page-envelope links outside noindex filter navigation', () => {
    const page = P3_GOLDEN_FIXTURES.hub.complete
    expect(() => pageProjectionSchema.parse({
      projection_id: '00000000-0000-4000-8000-000000000601',
      page_id: page.page_id,
      locale: page.locale,
      family: page.page_type,
      state: 'validated',
      dependency_hash: HASH,
      page: {
        ...page,
        links: [{
          relation: 'related', href: '/en/prompts/fabricated', label: 'Fabricated',
          target_page_id: UUID_B, indexable: true, evidence_state: 'candidate',
          link_policy: 'link', render_target: 'page',
        }],
      },
      navigation: { version: 'v1', items: [] },
      slots: [], content_hash: HASH, link_hash: HASH, schema_hash: HASH,
      renderer_version: 'renderer-v1', validation_report_ref: 'private/validation/report-v1',
    })).toThrow(/candidate|reviewed|qualified/i)
  })

  it('requires immutable renderer and validation-report provenance', () => {
    const page = P3_GOLDEN_FIXTURES.hub.complete
    const base = {
      projection_id: '00000000-0000-4000-8000-000000000601', page_id: page.page_id,
      locale: page.locale, family: page.page_type, state: 'validated', dependency_hash: HASH,
      page, navigation: { version: 'v1', items: [] }, slots: [], content_hash: HASH,
      link_hash: HASH, schema_hash: HASH,
    }
    expect(() => pageProjectionSchema.parse(base)).toThrow(/renderer_version|validation_report_ref/i)
  })
})
