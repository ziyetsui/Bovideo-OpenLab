import type { MediaEvidence, PageProjection, ProjectedPromptCard, ProjectedSlot } from '@/contracts/projection'
import type { DetailPageData } from '@/detail/schema'
import type { PageEnvelope, PageFamily } from '@/page/schema'
import { injectFrontendPreviewProjectionReader, type FrontendRouteRequest } from '../../../frontend/routes/preview-projection-reader'

const HASH = 'sha256:v1:0000000000000000000000000000000000000000000000000000000000000000'

const remotePreviewMediaEvidence: MediaEvidence = {
  media_evidence_id: '00000000-0000-4000-8000-000000000701',
  source_ref: 1,
  provider: 'x',
  provider_media_id: 'phase3-browser-evidence',
  media_type: 'image',
  width: 1200,
  height: 675,
  duration_ms: null,
  remote_url: 'https://pbs.twimg.com/media/phase3-browser-evidence.jpg',
  thumbnail_url: null,
  observed_at: '2026-08-26T00:00:00.000Z',
  rights_state: 'unknown',
  sensitive_content_state: 'allowed',
  content_hash: HASH,
  visibility: 'internal_preview',
  delivery_target: 'x_cdn',
  preview_noindex: true,
  attribution_url: 'https://x.com/example/status/phase3-browser-evidence',
}

const routes = {
  hub: '/en/prompts',
  gallery: '/en/prompts/image',
  entity: '/en/prompts/models/example-model',
  detail: '/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001',
} as const

const SOURCE = { type: 'source' as const, id: '00000000-0000-4000-8000-000000000701' }
const pageIds = {
  hub: '00000000-0000-4000-8000-000000000711',
  gallery: '00000000-0000-4000-8000-000000000712',
  entity: '00000000-0000-4000-8000-000000000713',
  detail: '00000000-0000-4000-8000-000000000714',
} as const

const basePage = (family: PageFamily) => ({
  schema_version: 1,
  page_id: pageIds[family],
  route: routes[family],
  locale: 'en' as const,
  index_state: 'discoverable_noindex' as const,
  title: `Preview ${family}`,
  description: `Projection-backed ${family} browser preview.`,
  h1: `Preview ${family}`,
  canonical: `https://preview.local${routes[family]}`,
  breadcrumbs: [{ label: 'Prompts', href: '/en/prompts' }],
  provenance: { state: 'explicit' as const, source_refs: [SOURCE], observed_at: '2026-08-26T00:00:00.000Z' },
  modules: [],
  links: [],
  snapshot_version: 1,
  content_hash: HASH,
  generated_filler_count: 0 as const,
})

const detailQuestions: DetailPageData['questions'] = [{
  id: 'identity',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { label: 'Cinematic product shot', artifactKind: 'prompt' },
}, {
  id: 'outcome',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { summary: 'A cinematic image of a product.', medium: 'image' },
}, {
  id: 'prompt',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { originalText: 'Use the supplied product at dusk.', originalLanguage: 'en', copyDefault: 'original' },
}, {
  id: 'inputs',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { required: ['product image'], optional: ['brand palette'] },
}, {
  id: 'parameters',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { items: [{ name: 'aspect ratio', value: '16:9', sourceRef: 'source-preview' }] },
}, {
  id: 'examples',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { mediaRefs: [] },
}, {
  id: 'workflow',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { steps: [{ text: 'Add the product image.', action: 'upload', assertion: 'The product is visible.', status: 'verified' }] },
}, {
  id: 'variations',
  state: 'present',
  provenance: 'candidate',
  sourceRefs: ['source-preview'],
  content: { artifactRefs: ['candidate-preview-variation'] },
}, {
  id: 'source_signals',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { sourceUrl: 'https://preview.local/source', observedAt: '2026-08-26T00:00:00.000Z', likes: 12, bookmarks: 3, views: 120 },
}, {
  id: 'actions',
  state: 'present',
  provenance: 'explicit',
  sourceRefs: ['source-preview'],
  content: { copyPrompt: true, productActionId: null },
}]

const previewPages: Readonly<Record<keyof typeof routes, PageEnvelope>> = {
  hub: {
    ...basePage('hub'),
    page_type: 'hub',
    inventory_count: 1,
    snapshot_date: '2026-08-26T00:00:00.000Z',
    featured_module_ids: [],
    diversity_rule_version: 'phase3-browser-preview-v1',
  },
  gallery: {
    ...basePage('gallery'),
    page_type: 'gallery',
    media_type: 'image',
    page: 1,
    page_size: 12,
    total_items: 1,
    filter_state: {},
    next_page: '/en/prompts/image?page=2',
    previous_page: null,
  },
  entity: {
    ...basePage('entity'),
    page_type: 'entity',
    entity_kind: 'model',
    entity_slug: 'example-model',
    qualification: {
      qualified: true,
      reason_codes: ['all_gates_passed'],
      usable_items: 1,
      independent_creators: 1,
      sibling_overlap_ratio: 0,
      demand_evidence_ref: SOURCE,
      keyword_owner: 'example-model-prompts',
    },
    item_count: 1,
    creator_count: 1,
  },
  detail: {
    ...basePage('detail'),
    page_type: 'detail',
    detail: {
      pageId: pageIds.detail,
      routeId: '00000000-0000-4000-8000-000000000001',
      artifactId: 'artifact-preview-001',
      locale: 'en',
      slug: 'cinematic-product-shot',
      title: 'Cinematic product shot',
      description: 'Projection-backed prompt detail preview.',
      robots: 'noindex,nofollow,noarchive,nosnippet',
      sourceHash: HASH,
      originalTextBytesHash: HASH,
      generatedFillerCount: 0,
      questions: detailQuestions,
    },
  },
}

const candidateFilter = (nodeRef: string): ProjectedSlot['items'][number] => ({
  node_ref: nodeRef,
  edge_ref: null,
  evidence_state: 'candidate',
  link_policy: 'filter_state',
  href: `${routes.gallery}?${nodeRef}=candidate`,
  render_target: 'filter',
  target_indexability: 'noindex',
})

const reviewedNode = (nodeRef: string): ProjectedSlot['items'][number] => ({
  node_ref: nodeRef,
  edge_ref: null,
  evidence_state: 'reviewed',
  link_policy: 'dead_text',
  href: null,
  render_target: 'tag',
  target_indexability: 'none',
})

const reviewedPageNode = (nodeRef: string, label: string, href: string, edgeRef: string): ProjectedSlot['items'][number] => ({
  node_ref: nodeRef,
  edge_ref: edgeRef,
  label,
  evidence_state: 'reviewed',
  link_policy: 'link',
  href,
  render_target: 'page',
  target_indexability: 'noindex',
})

const qualifiedCard = ({ id, title, summary, href, tags }: Readonly<{
  id: string
  title: string
  summary: string
  href: string
  tags: readonly string[]
}>): ProjectedPromptCard => ({
  prompt_ref: { type: 'artifact', id },
  title,
  summary,
  tags: tags.map((tag) => candidateFilter(tag) as ProjectedPromptCard['tags'][number]),
  prompt_text: 'Use the supplied product at dusk.',
  prompt_language: 'en',
  media: [remotePreviewMediaEvidence],
  evidence_state: 'qualified',
  link_policy: 'link',
  href,
  render_target: 'page',
  target_indexability: 'noindex',
})

const detailRoute = routes.detail

const slotsByFamily: Record<keyof typeof routes, ProjectedSlot[]> = {
  hub: [
    { slot_key: 'outputs', renderer: 'facet', source_mode: 'graph_query', items: [reviewedPageNode('output:image', 'Image prompts', routes.gallery, '00000000-0000-4000-8000-000000000721')] },
    { slot_key: 'use_cases', renderer: 'facet', source_mode: 'graph_query', items: [candidateFilter('campaign')] },
    { slot_key: 'featured', renderer: 'shelf', source_mode: 'content_envelope', items: [qualifiedCard({
      id: '00000000-0000-4000-8000-000000000801',
      title: 'Cinematic product shot',
      summary: 'A reviewed product prompt.',
      href: detailRoute,
      tags: ['image-output', 'campaign'],
    })] },
  ],
  gallery: [
    { slot_key: 'use_cases', renderer: 'facet', source_mode: 'graph_query', items: [candidateFilter('campaign')] },
    { slot_key: 'styles', renderer: 'facet', source_mode: 'graph_query', items: [candidateFilter('editorial')] },
    { slot_key: 'subjects', renderer: 'facet', source_mode: 'graph_query', items: [candidateFilter('portrait')] },
    { slot_key: 'models', renderer: 'shelf', source_mode: 'graph_query', items: [reviewedPageNode('model:example-model', 'Example model', routes.entity, '00000000-0000-4000-8000-000000000722')] },
    { slot_key: 'featured', renderer: 'shelf', source_mode: 'content_envelope', items: [qualifiedCard({
      id: '00000000-0000-4000-8000-000000000802',
      title: 'Editorial campaign portrait',
      summary: 'A qualified gallery prompt.',
      href: detailRoute,
      tags: ['campaign', 'editorial', 'portrait'],
    })] },
  ],
  entity: [
    { slot_key: 'top_prompts', renderer: 'shelf', source_mode: 'graph_query', items: [qualifiedCard({
      id: '00000000-0000-4000-8000-000000000803',
      title: 'Model prompt',
      summary: 'A qualified entity prompt.',
      href: detailRoute,
      tags: [],
    })] },
    { slot_key: 'related', renderer: 'mesh', source_mode: 'graph_query', items: [reviewedNode('related-model')] },
  ],
  detail: [{ slot_key: 'prompt', renderer: 'detail', source_mode: 'content_envelope', items: [qualifiedCard({
    id: '00000000-0000-4000-8000-000000000803',
    title: 'Cinematic product shot',
    summary: 'A source-backed prompt detail.',
    href: detailRoute,
    tags: [],
  })] }],
}

const projectionFor = (family: keyof typeof routes): PageProjection => {
  const fixture = previewPages[family]
  const route = routes[family]
  const page = { ...fixture, route, canonical: `https://preview.local${route}` }

  return {
    projection_id: fixture.page_id,
    page_id: page.page_id,
    locale: page.locale,
    family,
    state: 'released',
    dependency_hash: HASH,
    page,
    navigation: {
      version: 'phase3-browser-preview-v1',
      items: [{
        node_ref: 'prompt-hub',
        edge_ref: null,
        evidence_state: 'reviewed',
        link_policy: 'link',
        href: routes.hub,
        render_target: 'page',
        target_indexability: 'indexable',
        label: 'Prompt hub',
        promotion_state: 'qualified',
        target_page_id: pageIds.hub,
      }],
    },
    slots: slotsByFamily[family],
    content_hash: HASH,
    link_hash: HASH,
    schema_hash: HASH,
    renderer_version: 'phase3-browser-preview-v1',
    validation_report_ref: 'private/phase3/browser-preview',
  }
}

const projections = Object.values(routes).map((_, index) => projectionFor((Object.keys(routes) as (keyof typeof routes)[])[index]!))

export const phase3PreviewProjectionFor = (request: FrontendRouteRequest): PageProjection | undefined =>
  projections.find((projection) => projection.family === request.family && projection.page.route === request.route && projection.locale === request.locale)

/** A test-only seam for exercising the real public-media policy boundary. */
export const phase3PreviewMediaEvidence = (): MediaEvidence => remotePreviewMediaEvidence

export const installPhase3FrontendPreview = (): void => {
  injectFrontendPreviewProjectionReader({
    readBoundProjection: async (request) => {
      const projection = phase3PreviewProjectionFor(request)
      return projection === undefined ? undefined : { publishVersion: 1, projectionId: projection.projection_id, projection }
    },
  })
}
