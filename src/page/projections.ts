import type { EntityPage, GalleryPage, HubPage } from './schema'

export type HubCandidate = Readonly<{ id: string; qualified: boolean; creatorId: string; sourceId: string; score: number }>
export type GalleryProjectionInput = Readonly<{ mediaType: 'image' | 'video' | 'mixed' | 'unresolved'; page: number; pageSize: number; totalItems: number; filterState: Readonly<Record<string, string>> }>
/**
 * The entity gate inputs are deliberately explicit.  A page cannot become a
 * discoverable candidate just because it has enough rows: identity, useful
 * information gain, and a deliverable rights path are independent gates.
 */
export type EntityQualificationInput = Readonly<{
  usableItems: number
  independentCreators: number
  siblingOverlapRatio: number
  demandEvidence: boolean
  uniqueLocalizedBody: boolean
  keywordOwner: string | null
  identityValid: boolean
  informationGain: boolean
  rightsDelivery: boolean
}>

const pageLink = (href: string, label: string, targetPageId: string | null, relation: 'canonical' | 'related' | 'facet' | 'item' | 'next' | 'previous' = 'item') => ({ relation, href, label, target_page_id: targetPageId, indexable: true, evidence_state: 'reviewed' as const, link_policy: 'link' as const, render_target: 'page' as const })

export const selectFeaturedCandidates = (candidates: readonly HubCandidate[], limit = 6): string[] => {
  const selected: HubCandidate[] = []
  const creators = new Set<string>()
  const sources = new Set<string>()
  const qualified = [...candidates]
    .filter((item) => item.qualified)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))

  // First pass maximises both creator and source diversity.  A second pass is
  // intentionally allowed when the qualified inventory is smaller than the
  // requested featured limit, but remains deterministic.
  for (const diversityPass of [true, false]) {
    for (const candidate of qualified) {
      if (selected.length >= limit) break
      if (selected.some((item) => item.id === candidate.id)) continue
      if (diversityPass && (creators.has(candidate.creatorId) || sources.has(candidate.sourceId))) continue
      selected.push(candidate)
      creators.add(candidate.creatorId)
      sources.add(candidate.sourceId)
    }
  }
  return selected.map((candidate) => candidate.id)
}

export const projectHubPage = (page: HubPage, candidates: readonly HubCandidate[]): HubPage => {
  const qualified = candidates.filter((candidate) => candidate.qualified)
  const featured = selectFeaturedCandidates(candidates)
  return {
    ...page,
    inventory_count: qualified.length,
    featured_module_ids: featured,
    links: [
      ...page.links.filter((link) => link.relation === 'canonical'),
      ...qualified.sort((left, right) => left.id.localeCompare(right.id)).map((candidate) => pageLink(`/${page.locale}/prompts/${candidate.id}`, candidate.id, candidate.id)),
    ],
  }
}

export const projectGalleryPage = (page: GalleryPage, input: GalleryProjectionInput): GalleryPage => {
  if (input.mediaType === 'mixed' || input.mediaType === 'unresolved') throw new Error('gallery route requires one resolved media type')
  if (!Number.isInteger(input.page) || input.page < 1 || !Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) throw new Error('gallery pagination is invalid')
  const nextPage = input.page * input.pageSize < input.totalItems ? `/${page.locale}/prompts/${input.mediaType}?page=${input.page + 1}` : null
  const previousPage = input.page > 1 ? `/${page.locale}/prompts/${input.mediaType}?page=${input.page - 1}` : null
  return { ...page, media_type: input.mediaType, page: input.page, page_size: input.pageSize, total_items: input.totalItems, filter_state: { ...input.filterState }, next_page: nextPage, previous_page: previousPage }
}

export const qualifyEntity = (input: EntityQualificationInput): Readonly<{ qualified: boolean; reasonCodes: string[] }> => {
  const reasons: string[] = []
  if (input.usableItems < 10) reasons.push('insufficient_usable_items')
  if (input.independentCreators < 2) reasons.push('insufficient_independent_creators')
  if (input.siblingOverlapRatio >= 0.6) reasons.push('sibling_overlap_too_high')
  if (!input.demandEvidence) reasons.push('missing_demand_evidence')
  if (!input.uniqueLocalizedBody) reasons.push('missing_unique_localized_body')
  if (input.keywordOwner === null) reasons.push('missing_keyword_owner')
  if (!input.identityValid) reasons.push('invalid_identity')
  if (!input.informationGain) reasons.push('insufficient_information_gain')
  if (!input.rightsDelivery) reasons.push('rights_delivery_not_ready')
  return { qualified: reasons.length === 0, reasonCodes: reasons.length === 0 ? ['all_gates_passed'] : reasons }
}

export const projectEntityPage = (page: EntityPage, input: EntityQualificationInput): EntityPage => {
  const result = qualifyEntity(input)
  return {
    ...page,
    index_state: result.qualified ? 'discoverable_noindex' : 'not_generated',
    qualification: {
      qualified: result.qualified,
      reason_codes: result.reasonCodes,
      usable_items: input.usableItems,
      independent_creators: input.independentCreators,
      sibling_overlap_ratio: input.siblingOverlapRatio,
      demand_evidence_ref: input.demandEvidence ? page.provenance.source_refs[0] ?? null : null,
      keyword_owner: input.keywordOwner,
    },
    item_count: input.usableItems,
    creator_count: input.independentCreators,
  }
}
