import { createHash } from 'node:crypto'

import type { ApplicationLocale } from '@/contracts/locale'
import { pageProjectionSchema, type PageProjection, type ProjectedPromptCard } from '@/contracts/projection'

const RENDERER_VERSION = 'local-internal-projector-v1'
const schemaHash = `sha256:v1:${createHash('sha256').update('page-projection-schema-v1').digest('hex')}`

export type ImportedProjectionArtifact = Readonly<{
  id: string
  sourceID: string
  sourceVersion: string
  title: string
  text: string
  mediaType: 'image' | 'video' | 'unresolved'
  observedAt: string
  canonicalURL?: string
}>

export type InternalProjectionInput = Readonly<{
  locale: ApplicationLocale
  publishVersion: number
  artifacts: readonly ImportedProjectionArtifact[]
}>

const hash = (value: string): string => `sha256:v1:${createHash('sha256').update(value, 'utf8').digest('hex')}`

const stable = (value: string): string => {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16]!, 16) % 4]!
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

const slug = (value: string): string => {
  const result = value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return result || 'prompt'
}

const canonical = (locale: ApplicationLocale, path: string): string => `https://internal.local${path.replace(`/${locale}`, '')}`

const card = (artifact: ImportedProjectionArtifact, locale: ApplicationLocale): ProjectedPromptCard => {
  const routeID = stable(`detail-route:${artifact.id}:${artifact.sourceVersion}`)
  return {
    prompt_ref: { type: 'artifact', id: artifact.id },
    title: artifact.title,
    summary: artifact.text.slice(0, 240),
    tags: [],
    evidence_state: 'reviewed',
    link_policy: 'filter_state',
    href: `/${locale}/prompts/${slug(artifact.title)}-${routeID}`,
    render_target: 'filter',
    target_indexability: 'noindex',
  }
}

const base = (input: InternalProjectionInput, pageID: string, route: string, title: string, description: string, sourceRefs: readonly string[], observedAt: string) => ({
  schema_version: 1,
  page_id: pageID,
  route,
  locale: input.locale,
  index_state: 'discoverable_noindex' as const,
  title,
  description,
  h1: title,
  canonical: canonical(input.locale, route),
  breadcrumbs: [{ label: 'Prompts', href: `/${input.locale}/prompts` }],
  provenance: { state: 'explicit' as const, source_refs: sourceRefs.map((id) => ({ type: 'source' as const, id })), observed_at: observedAt },
  modules: [],
  links: [{ relation: 'canonical' as const, href: route, label: title, target_page_id: pageID, indexable: false, evidence_state: 'reviewed' as const, link_policy: 'link' as const, render_target: 'page' as const }],
  snapshot_version: input.publishVersion,
  content_hash: hash(`${pageID}:${input.publishVersion}:${sourceRefs.join('|')}`),
  generated_filler_count: 0 as const,
})

const projection = (input: InternalProjectionInput, family: PageProjection['family'], page: unknown, slots: unknown): PageProjection => {
  const parsedPage = pageProjectionSchema.shape.page.parse(page)
  const parsedSlots = pageProjectionSchema.shape.slots.parse(slots)
  const identity = `${family}:${parsedPage.page_id}:${parsedPage.content_hash}:${input.publishVersion}`
  return pageProjectionSchema.parse({
    projection_id: stable(`projection:${identity}`),
    page_id: parsedPage.page_id,
    locale: input.locale,
    family,
    state: 'released',
    dependency_hash: hash(input.artifacts.map((artifact) => `${artifact.id}:${artifact.sourceVersion}`).sort().join('|')),
    page: parsedPage,
    navigation: { version: `local-internal:${input.publishVersion}`, items: [] },
    slots: parsedSlots,
    content_hash: hash(JSON.stringify({ page: parsedPage, slots: parsedSlots })),
    link_hash: hash(JSON.stringify(parsedPage.links)),
    schema_hash: schemaHash,
    renderer_version: RENDERER_VERSION,
    validation_report_ref: `private/local-internal/validation/${stable(identity)}`,
  })
}

/**
 * Materializes the four frontend families from Payload-approved source facts.
 * These are deliberately internal preview pages: they retain no remote media
 * URLs and every interactive destination is noindex filter state.
 */
export const buildInternalNoindexProjections = (input: InternalProjectionInput): readonly PageProjection[] => {
  if (!Number.isSafeInteger(input.publishVersion) || input.publishVersion < 1) throw new Error('publishVersion must be a positive integer')
  const artifacts = [...input.artifacts].sort((left, right) => left.id.localeCompare(right.id))
  if (artifacts.length === 0) throw new Error('at least one imported prompt artifact is required')
  const first = artifacts[0]!
  const sourceRefs = [...new Set(artifacts.map((artifact) => artifact.sourceID))]
  const observedAt = artifacts.map((artifact) => artifact.observedAt).sort().at(-1)!
  const cards = artifacts.map((artifact) => card(artifact, input.locale))
  const hubRoute = `/${input.locale}/prompts`
  const hubID = stable(`hub:${input.locale}`)
  const hub = {
    ...base(input, hubID, hubRoute, 'Higgsfield Prompt Hub', `${artifacts.length} imported prompts available in this internal preview.`, sourceRefs, observedAt),
    page_type: 'hub' as const,
    inventory_count: artifacts.length,
    snapshot_date: observedAt,
    featured_module_ids: [],
    diversity_rule_version: 'local-internal-v1',
  }
  const galleryRoute = `/${input.locale}/prompts/image`
  const galleryID = stable(`gallery:image:${input.locale}`)
  const gallery = {
    ...base(input, galleryID, galleryRoute, 'Image Prompt Gallery', `${artifacts.length} internal image prompt cards.`, sourceRefs, observedAt),
    page_type: 'gallery' as const,
    media_type: 'image' as const,
    page: 1,
    page_size: Math.min(100, Math.max(1, artifacts.length)),
    total_items: artifacts.length,
    filter_state: { output: 'image' },
    next_page: null,
    previous_page: null,
  }
  const entityRoute = `/${input.locale}/prompts/models/higgsfield`
  const entityID = stable(`entity:model:higgsfield:${input.locale}`)
  const entity = {
    ...base(input, entityID, entityRoute, 'Higgsfield Prompt Entity', 'Internal entity grouping from imported Higgsfield prompt artifacts.', sourceRefs, observedAt),
    page_type: 'entity' as const,
    entity_kind: 'model' as const,
    entity_slug: 'higgsfield',
    qualification: {
      qualified: false,
      reason_codes: ['internal_noindex_publication'],
      usable_items: artifacts.length,
      independent_creators: 0,
      sibling_overlap_ratio: 1,
      demand_evidence_ref: null,
      keyword_owner: null,
    },
    item_count: artifacts.length,
    creator_count: 0,
  }
  const detailRouteID = stable(`detail-route:${first.id}:${first.sourceVersion}`)
  const detailPageID = stable(`detail-page:${first.id}:${input.locale}:${first.sourceVersion}`)
  const detailRoute = `/${input.locale}/prompts/${slug(first.title)}-${detailRouteID}`
  const unavailable = { state: 'unavailable' as const, provenance: 'unavailable' as const, sourceRefs: [first.sourceID] }
  const detail = {
    ...base(input, detailPageID, detailRoute, first.title, first.text.slice(0, 320), [first.sourceID], first.observedAt),
    page_type: 'detail' as const,
    detail: {
      pageId: detailPageID,
      routeId: detailRouteID,
      artifactId: first.id,
      locale: input.locale,
      slug: slug(first.title),
      title: first.title,
      description: first.text.slice(0, 320),
      robots: 'noindex,nofollow,noarchive,nosnippet' as const,
      sourceHash: first.sourceVersion,
      originalTextBytesHash: hash(first.text),
      generatedFillerCount: 0 as const,
      questions: [
        { id: 'identity' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [first.sourceID], content: { label: first.title, artifactKind: 'prompt' } },
        { id: 'outcome' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [first.sourceID], content: { summary: `Imported ${first.mediaType} prompt evidence.`, medium: first.mediaType } },
        { id: 'prompt' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [first.sourceID], content: { originalText: first.text, originalLanguage: 'en', copyDefault: 'original' as const } },
        { id: 'inputs' as const, ...unavailable, content: { required: [], optional: [] } },
        { id: 'parameters' as const, ...unavailable, content: { items: [] } },
        { id: 'examples' as const, ...unavailable, content: { mediaRefs: [] } },
        { id: 'workflow' as const, ...unavailable, content: { steps: [] } },
        { id: 'variations' as const, ...unavailable, content: { artifactRefs: [] } },
        { id: 'source_signals' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [first.sourceID], content: { sourceUrl: first.canonicalURL ?? `https://internal.local/sources/${first.sourceID}`, observedAt: first.observedAt, likes: null, bookmarks: null, views: null } },
        { id: 'actions' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [first.sourceID], content: { copyPrompt: true, productActionId: null } },
      ],
    },
  }
  return Object.freeze([
    projection(input, 'hub', hub, [{ slot_key: 'prompt_shelf', renderer: 'prompt_shelf', source_mode: 'content_envelope', items: cards }]),
    projection(input, 'gallery', gallery, [{ slot_key: 'gallery', renderer: 'prompt_shelf', source_mode: 'content_envelope', items: cards }]),
    projection(input, 'entity', entity, [{ slot_key: 'entity_prompts', renderer: 'prompt_shelf', source_mode: 'content_envelope', items: cards }]),
    projection(input, 'detail', detail, [{ slot_key: 'prompt', renderer: 'prompt', source_mode: 'content_envelope', items: [cards[0]!] }]),
  ])
}
