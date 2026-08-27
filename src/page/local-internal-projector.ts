import { createHash } from 'node:crypto'

import type { ApplicationLocale } from '@/contracts/locale'
import { pageProjectionSchema, type MediaEvidence, type NavigationProjection, type PageProjection, type ProjectedNodeItem, type ProjectedPromptCard, type ProjectedSlot } from '@/contracts/projection'

const RENDERER_VERSION = 'local-internal-projector-v2'
const schemaHash = `sha256:v1:${createHash('sha256').update('page-projection-schema-v2').digest('hex')}`
const GALLERY_PAGE_SIZE = 100

export type ImportedProjectionArtifact = Readonly<{
  id: string
  sourceID: string
  sourceVersion: string
  title: string
  text: string
  originalLanguage?: string
  mediaType: 'image' | 'video' | 'unresolved'
  media?: readonly MediaEvidence[]
  observedAt: string
  canonicalURL?: string
  entityRefs?: readonly ImportedProjectionEntity[]
}>

/**
 * Entity routes are permitted only for existing, reviewed taxonomy records.
 * We deliberately do not derive taxonomy from prompt prose in this publisher.
 */
export type ImportedProjectionEntity = Readonly<{
  id: string
  kind: 'model' | 'use_case' | 'style'
  stableKey: string
  label: string
  promotionState: 'candidate' | 'reviewed' | 'qualified' | 'retired'
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

const reviewedEntityRefs = (artifact: ImportedProjectionArtifact): readonly ImportedProjectionEntity[] => Object.freeze(
  [...(artifact.entityRefs ?? [])]
    .filter((entity) => entity.promotionState === 'reviewed' || entity.promotionState === 'qualified')
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey, 'en-US')),
)

const taxonomyNode = (entity: ImportedProjectionEntity, locale: ApplicationLocale): ProjectedNodeItem => ({
  label: entity.label,
  node_ref: entity.stableKey,
  edge_ref: null,
  evidence_state: entity.promotionState === 'qualified' ? 'qualified' : 'reviewed',
  link_policy: 'filter_state',
  href: `/${locale}/prompts?facet=${encodeURIComponent(entity.stableKey)}`,
  render_target: 'filter',
  target_indexability: 'noindex',
})

const uniqueNodes = (nodes: readonly ProjectedNodeItem[]): readonly ProjectedNodeItem[] => Object.freeze(
  [...new Map(nodes.map((node) => [node.node_ref, node])).values()].sort((left, right) => left.node_ref.localeCompare(right.node_ref, 'en-US')),
)

const taxonomyNodesFor = (artifacts: readonly ImportedProjectionArtifact[], locale: ApplicationLocale, kinds: readonly ImportedProjectionEntity['kind'][]): readonly ProjectedNodeItem[] =>
  uniqueNodes(artifacts.flatMap((artifact) =>
    reviewedEntityRefs(artifact).filter((entity) => kinds.includes(entity.kind)).map((entity) => taxonomyNode(entity, locale))))

const card = (artifact: ImportedProjectionArtifact, locale: ApplicationLocale): ProjectedPromptCard => {
  const routeID = stable(`detail-route:${artifact.id}`)
  return {
    prompt_ref: { type: 'artifact', id: artifact.id },
    title: artifact.title,
    summary: artifact.text.slice(0, 240),
    prompt_text: artifact.text,
    prompt_language: artifact.originalLanguage ?? 'en',
    media: [...(artifact.media ?? [])].slice(0, 4),
    tags: reviewedEntityRefs(artifact).map((entity) => taxonomyNode(entity, locale)),
    evidence_state: 'reviewed',
    link_policy: 'link',
    href: `/${locale}/prompts/${slug(artifact.title)}-${routeID}`,
    render_target: 'page',
    target_indexability: 'noindex',
  }
}

const pageNode = (input: Readonly<{
  nodeRef: string
  label: string
  href: string
  edgeSeed: string
}>): ProjectedNodeItem => ({
  label: input.label,
  node_ref: input.nodeRef,
  edge_ref: stable(`edge:${input.edgeSeed}`),
  evidence_state: 'reviewed',
  link_policy: 'link',
  href: input.href,
  render_target: 'page',
  target_indexability: 'noindex',
})

const promptSlot = (slotKey: string, artifacts: readonly ImportedProjectionArtifact[], locale: ApplicationLocale, limit = 12): ProjectedSlot => ({
  slot_key: slotKey,
  renderer: 'prompt_shelf',
  source_mode: 'content_envelope',
  items: artifacts.slice(0, limit).map((artifact) => card(artifact, locale)),
})

const nodeSlot = (slotKey: string, items: readonly ProjectedNodeItem[]): ProjectedSlot => ({
  slot_key: slotKey,
  renderer: 'facet_rail',
  source_mode: 'content_envelope',
  items: [...items],
})

const emptySlot = (slotKey: string): ProjectedSlot => nodeSlot(slotKey, [])

const artifactsForEntityKind = (artifacts: readonly ImportedProjectionArtifact[], kind: ImportedProjectionEntity['kind']): readonly ImportedProjectionArtifact[] =>
  artifacts.filter((artifact) => reviewedEntityRefs(artifact).some((entity) => entity.kind === kind))

const compare = (left: string, right: string): number => left.localeCompare(right, 'en-US')

const equivalentArtifact = (left: ImportedProjectionArtifact, right: ImportedProjectionArtifact): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

/** Payload stable IDs represent a durable artifact. Repeated equal input may
 * occur through relationship fan-out; conflicting bytes are unsafe to publish. */
const uniqueArtifacts = (artifacts: readonly ImportedProjectionArtifact[]): readonly ImportedProjectionArtifact[] => {
  const byID = new Map<string, ImportedProjectionArtifact>()
  for (const artifact of artifacts) {
    const existing = byID.get(artifact.id)
    if (existing !== undefined && !equivalentArtifact(existing, artifact))
      throw new Error(`conflicting imported projection artifact ${artifact.id}`)
    if (existing === undefined) byID.set(artifact.id, artifact)
  }
  return Object.freeze([...byID.values()].sort((left, right) => compare(left.id, right.id)))
}

const entitySlug = (entity: ImportedProjectionEntity): string | undefined => {
  const prefix = `${entity.kind}:`
  const suffix = entity.stableKey.startsWith(prefix) ? entity.stableKey.slice(prefix.length) : ''
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(suffix) ? suffix : undefined
}

type EntityGroup = Readonly<{
  entity: ImportedProjectionEntity
  slug: string
  artifacts: readonly ImportedProjectionArtifact[]
}>

const groupedEntities = (artifacts: readonly ImportedProjectionArtifact[]): readonly EntityGroup[] => {
  const groups = new Map<string, { entity: ImportedProjectionEntity; slug: string; artifacts: Map<string, ImportedProjectionArtifact> }>()
  for (const artifact of artifacts) for (const entity of artifact.entityRefs ?? []) {
    if (entity.promotionState !== 'reviewed' && entity.promotionState !== 'qualified') continue
    const slugValue = entitySlug(entity)
    if (slugValue === undefined) continue
    const key = `${entity.kind}\u0000${entity.stableKey}`
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { entity, slug: slugValue, artifacts: new Map([[artifact.id, artifact]]) })
      continue
    }
    if (existing.entity.label !== entity.label || existing.entity.id !== entity.id)
      throw new Error(`conflicting imported projection entity ${entity.stableKey}`)
    existing.artifacts.set(artifact.id, artifact)
  }
  const familyOrder: Record<ImportedProjectionEntity['kind'], number> = { model: 0, use_case: 1, style: 2 }
  return Object.freeze([...groups.values()]
    .map((group): EntityGroup => Object.freeze({ entity: group.entity, slug: group.slug, artifacts: Object.freeze([...group.artifacts.values()].sort((left, right) => compare(left.id, right.id))) }))
    .sort((left, right) => familyOrder[left.entity.kind] - familyOrder[right.entity.kind] || compare(left.slug, right.slug)))
}

const entityRouteSegment: Record<ImportedProjectionEntity['kind'], string> = {
  model: 'models',
  use_case: 'use-cases',
  style: 'styles',
}

const assertUniqueRoutes = (projections: readonly PageProjection[]): readonly PageProjection[] => {
  const routes = new Set<string>()
  for (const page of projections) {
    if (routes.has(page.page.route)) throw new Error(`duplicate internal projection route ${page.page.route}`)
    routes.add(page.page.route)
  }
  return Object.freeze([...projections])
}

const base = (input: InternalProjectionInput, pageID: string, route: string, title: string, description: string, sourceRefs: readonly string[], observedAt: string) => ({
  schema_version: 1,
  page_id: pageID,
  route,
  locale: input.locale,
  translation_state: 'source' as const,
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
    dependency_hash: hash(input.artifacts.map((artifact) => `${artifact.id}:${artifact.sourceVersion}:${(artifact.media ?? []).map((media) => media.content_hash).join(',')}`).sort().join('|')),
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

const navigationItemForProjection = (projectionValue: PageProjection): NavigationProjection['items'][number] | undefined => {
  const page = projectionValue.page
  if (page.page_type === 'gallery' && page.page !== 1) return undefined
  const identity = page.page_type === 'hub'
    ? { nodeRef: 'hub:prompts', label: page.h1 }
    : page.page_type === 'gallery'
      ? { nodeRef: `output:${page.media_type}`, label: page.h1 }
      : page.page_type === 'entity' && page.entity_kind === 'model'
        ? { nodeRef: `model:${page.entity_slug}`, label: page.h1 }
        : undefined
  if (identity === undefined) return undefined
  return {
    ...pageNode({ nodeRef: identity.nodeRef, label: identity.label, href: page.route, edgeSeed: `navigation:${page.page_id}` }),
    label: identity.label,
    promotion_state: 'reviewed',
    target_page_id: page.page_id,
  }
}

const attachNavigation = (projections: readonly PageProjection[]): readonly PageProjection[] => {
  const items = uniqueNodes(projections.flatMap((projectionValue) => {
    const item = navigationItemForProjection(projectionValue)
    return item === undefined ? [] : [item]
  })) as NavigationProjection['items']
  const navigation: NavigationProjection = {
    version: `${RENDERER_VERSION}:${projections[0]?.page.snapshot_version ?? 0}`,
    items,
  }
  return projections.map((projectionValue) => pageProjectionSchema.parse({
    ...projectionValue,
    navigation,
    content_hash: hash(JSON.stringify({ page: projectionValue.page, slots: projectionValue.slots, navigation })),
    link_hash: hash(JSON.stringify({ pageLinks: projectionValue.page.links, navigation })),
  }))
}

/**
 * Materializes the four frontend families from Payload-approved source facts.
 * These are deliberately noindex preview pages. Only explicitly projected
 * internal-preview/public media and reviewed page edges can become interactive.
 */
export const buildInternalNoindexProjections = (input: InternalProjectionInput): readonly PageProjection[] => {
  if (!Number.isSafeInteger(input.publishVersion) || input.publishVersion < 1) throw new Error('publishVersion must be a positive integer')
  const artifacts = uniqueArtifacts(input.artifacts)
  if (artifacts.length === 0) throw new Error('at least one imported prompt artifact is required')
  const sourceRefs = [...new Set(artifacts.map((artifact) => artifact.sourceID))]
  const observedAt = artifacts.map((artifact) => artifact.observedAt).sort().at(-1)!
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
  const useCaseArtifacts = artifactsForEntityKind(artifacts, 'use_case')
  const styleArtifacts = artifactsForEntityKind(artifacts, 'style')
  const entityGroups = groupedEntities(artifacts)
  const entityNode = (group: EntityGroup): ProjectedNodeItem => pageNode({
    nodeRef: group.entity.stableKey,
    label: group.entity.label,
    href: `/${input.locale}/prompts/${entityRouteSegment[group.entity.kind]}/${group.slug}`,
    edgeSeed: `entity:${group.entity.stableKey}`,
  })
  const outputNodes = (['image', 'video'] as const).flatMap((mediaType) =>
    artifacts.some((artifact) => artifact.mediaType === mediaType)
      ? [pageNode({
          nodeRef: `output:${mediaType}`,
          label: `${mediaType === 'image' ? 'Image' : 'Video'} prompts`,
          href: `/${input.locale}/prompts/${mediaType}`,
          edgeSeed: `output:${mediaType}`,
        })]
      : [])
  const projections: PageProjection[] = [projection(input, 'hub', hub, [
    promptSlot('featured', artifacts, input.locale),
    emptySlot('trending'),
    promptSlot('tasks', useCaseArtifacts, input.locale),
    emptySlot('camera_motion'),
    nodeSlot('models', entityGroups.filter((group) => group.entity.kind === 'model').map(entityNode)),
    promptSlot('styles', styleArtifacts, input.locale),
    emptySlot('collections'),
    emptySlot('creators'),
    nodeSlot('outputs', outputNodes),
    nodeSlot('use_cases', taxonomyNodesFor(artifacts, input.locale, ['use_case'])),
    emptySlot('techniques'),
  ])]

  for (const mediaType of ['image', 'video'] as const) {
    const galleryArtifacts = artifacts.filter((artifact) => artifact.mediaType === mediaType)
    if (galleryArtifacts.length === 0) continue
    const galleryBaseRoute = `/${input.locale}/prompts/${mediaType}`
    const totalPages = Math.ceil(galleryArtifacts.length / GALLERY_PAGE_SIZE)
    const routeForPage = (page: number): string => page === 1 ? galleryBaseRoute : `${galleryBaseRoute}/page/${page}`
    for (let page = 1; page <= totalPages; page += 1) {
      const pageArtifacts = galleryArtifacts.slice((page - 1) * GALLERY_PAGE_SIZE, page * GALLERY_PAGE_SIZE)
      const galleryRoute = routeForPage(page)
      const galleryID = stable(`gallery:${mediaType}:${input.locale}:${page}`)
      const gallery = {
        ...base(input, galleryID, galleryRoute, `${mediaType === 'image' ? 'Image' : 'Video'} Prompt Gallery`, `${galleryArtifacts.length} internal ${mediaType} prompt cards.`, [...new Set(pageArtifacts.map((artifact) => artifact.sourceID))], pageArtifacts.map((artifact) => artifact.observedAt).sort().at(-1)!),
        page_type: 'gallery' as const,
        media_type: mediaType,
        page,
        page_size: pageArtifacts.length,
        total_items: galleryArtifacts.length,
        filter_state: { output: mediaType },
        next_page: page < totalPages ? routeForPage(page + 1) : null,
        previous_page: page > 1 ? routeForPage(page - 1) : null,
      }
      projections.push(projection(input, 'gallery', gallery, [
        nodeSlot('use_cases', taxonomyNodesFor(pageArtifacts, input.locale, ['use_case'])),
        nodeSlot('styles', taxonomyNodesFor(pageArtifacts, input.locale, ['style'])),
        emptySlot('subjects'),
        promptSlot('featured', pageArtifacts, input.locale, GALLERY_PAGE_SIZE),
        nodeSlot('models', entityGroups
          .filter((group) => group.entity.kind === 'model' && group.artifacts.some((artifact) => pageArtifacts.some((pageArtifact) => pageArtifact.id === artifact.id)))
          .map(entityNode)),
        emptySlot('subject_band'),
        emptySlot('residual'),
        emptySlot('related'),
      ]))
    }
  }

  for (const group of entityGroups) {
    const entityRoute = `/${input.locale}/prompts/${entityRouteSegment[group.entity.kind]}/${group.slug}`
    const entityID = stable(`entity:${group.entity.kind}:${group.entity.stableKey}:${input.locale}`)
    const groupSourceRefs = [...new Set(group.artifacts.map((artifact) => artifact.sourceID))]
    const groupObservedAt = group.artifacts.map((artifact) => artifact.observedAt).sort().at(-1)!
    const entity = {
      ...base(input, entityID, entityRoute, `${group.entity.label} Prompts`, `Internal ${group.entity.kind.replace('_', ' ')} grouping from imported prompt artifacts.`, groupSourceRefs, groupObservedAt),
      page_type: 'entity' as const,
      entity_kind: group.entity.kind,
      entity_slug: group.slug,
      qualification: {
        qualified: false,
        reason_codes: ['internal_noindex_publication'],
        usable_items: group.artifacts.length,
        independent_creators: 0,
        sibling_overlap_ratio: 1,
        demand_evidence_ref: null,
        keyword_owner: null,
      },
      item_count: group.artifacts.length,
      creator_count: 0,
    }
    projections.push(projection(input, 'entity', entity, [
      promptSlot('top_prompts', group.artifacts, input.locale, 12),
      promptSlot('all_prompts', group.artifacts, input.locale, 100),
      nodeSlot('facets', [taxonomyNode(group.entity, input.locale)]),
      emptySlot('variables'),
      emptySlot('creators'),
      emptySlot('evidence'),
      emptySlot('faq'),
      emptySlot('related'),
    ]))
  }

  for (const artifact of artifacts) {
    const detailRouteID = stable(`detail-route:${artifact.id}`)
    const detailPageID = stable(`detail-page:${artifact.id}:${input.locale}`)
    const detailRoute = `/${input.locale}/prompts/${slug(artifact.title)}-${detailRouteID}`
    const unavailable = { state: 'unavailable' as const, provenance: 'unavailable' as const, sourceRefs: [artifact.sourceID] }
    const relatedNodes = uniqueNodes([
      ...(artifact.mediaType === 'image' || artifact.mediaType === 'video'
        ? [pageNode({
            nodeRef: `output:${artifact.mediaType}`,
            label: `${artifact.mediaType === 'image' ? 'Image' : 'Video'} prompts`,
            href: `/${input.locale}/prompts/${artifact.mediaType}`,
            edgeSeed: `detail:${artifact.id}:output:${artifact.mediaType}`,
          })]
        : []),
      ...entityGroups
        .filter((group) => group.artifacts.some((groupArtifact) => groupArtifact.id === artifact.id))
        .map(entityNode),
    ])
    const detail = {
      ...base(input, detailPageID, detailRoute, artifact.title, artifact.text.slice(0, 320), [artifact.sourceID], artifact.observedAt),
      page_type: 'detail' as const,
      detail: {
        pageId: detailPageID,
        routeId: detailRouteID,
        artifactId: artifact.id,
        locale: input.locale,
        slug: slug(artifact.title),
        title: artifact.title,
        description: artifact.text.slice(0, 320),
        robots: 'noindex,nofollow,noarchive,nosnippet' as const,
        sourceHash: artifact.sourceVersion,
        originalTextBytesHash: hash(artifact.text),
        generatedFillerCount: 0 as const,
        questions: [
          { id: 'identity' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [artifact.sourceID], content: { label: artifact.title, artifactKind: 'prompt' } },
          { id: 'outcome' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [artifact.sourceID], content: { summary: `Imported ${artifact.mediaType} prompt evidence.`, medium: artifact.mediaType } },
          { id: 'prompt' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [artifact.sourceID], content: { originalText: artifact.text, originalLanguage: artifact.originalLanguage ?? 'en', copyDefault: 'original' as const } },
          { id: 'inputs' as const, ...unavailable, content: { required: [], optional: [] } },
          { id: 'parameters' as const, ...unavailable, content: { items: [] } },
          artifact.media !== undefined && artifact.media.length > 0
            ? { id: 'examples' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [artifact.sourceID], content: { mediaRefs: artifact.media.slice(0, 4).map((media) => media.media_evidence_id) } }
            : { id: 'examples' as const, ...unavailable, content: { mediaRefs: [] } },
          { id: 'workflow' as const, ...unavailable, content: { steps: [] } },
          { id: 'variations' as const, ...unavailable, content: { artifactRefs: [] } },
          { id: 'source_signals' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [artifact.sourceID], content: { sourceUrl: artifact.canonicalURL ?? `https://internal.local/sources/${artifact.sourceID}`, observedAt: artifact.observedAt, likes: null, bookmarks: null, views: null } },
          { id: 'actions' as const, state: 'present' as const, provenance: 'explicit' as const, sourceRefs: [artifact.sourceID], content: { copyPrompt: true, productActionId: null } },
        ],
      },
    }
    projections.push(projection(input, 'detail', detail, [
      { slot_key: 'prompt', renderer: 'prompt', source_mode: 'content_envelope', items: [card(artifact, input.locale)] },
      nodeSlot('related', relatedNodes),
    ]))
  }
  return assertUniqueRoutes(attachNavigation(projections))
}
