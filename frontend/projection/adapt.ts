import type { PageProjection, ProjectedSlot } from '@/contracts/projection'
import type { DetailPage, EntityPage, GalleryPage, HubPage } from '@/page/schema'

import {
  frontendDetailModelSchema,
  frontendEntityModelSchema,
  frontendGalleryModelSchema,
  frontendHubModelSchema,
  frontendPageModelSchema,
  type FrontendDetailModel,
  type FrontendEntityModel,
  type FrontendGalleryModel,
  type FrontendHubModel,
  type FrontendPageModel,
} from './types'

const freeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) freeze(nestedValue)
    Object.freeze(value)
  }
  return value
}

const adaptBasePage = (page: HubPage | GalleryPage | EntityPage | DetailPage) => ({
  title: page.title,
  h1: page.h1,
  description: page.description,
  route: page.route,
  locale: page.locale,
  index_state: page.index_state,
  translation_state: page.translation_state,
  navigation: page.links.map(({ href, label, relation }) => ({ href, label, relation })),
  breadcrumbs: page.breadcrumbs.map(({ href, label }) => ({ href, label })),
  slots: [],
})

export const adaptHubPage = (page: HubPage): FrontendHubModel => freeze(frontendHubModelSchema.parse({
  ...adaptBasePage(page),
  family: 'hub',
  inventory_count: page.inventory_count,
  snapshot_date: page.snapshot_date,
})) as FrontendHubModel

export const adaptGalleryPage = (page: GalleryPage): FrontendGalleryModel => freeze(frontendGalleryModelSchema.parse({
  ...adaptBasePage(page),
  family: 'gallery',
  media_type: page.media_type,
  page: page.page,
  page_size: page.page_size,
  total_items: page.total_items,
  filter_state: { ...page.filter_state },
  next_page: page.next_page,
  previous_page: page.previous_page,
})) as FrontendGalleryModel

export const adaptEntityPage = (page: EntityPage): FrontendEntityModel => freeze(frontendEntityModelSchema.parse({
  ...adaptBasePage(page),
  family: 'entity',
  entity_kind: page.entity_kind,
  entity_slug: page.entity_slug,
  qualification: {
    qualified: page.qualification.qualified,
    reason_codes: [...page.qualification.reason_codes],
    usable_items: page.qualification.usable_items,
    independent_creators: page.qualification.independent_creators,
  },
  item_count: page.item_count,
  creator_count: page.creator_count,
})) as FrontendEntityModel

export const adaptDetailPage = (page: DetailPage): FrontendDetailModel => freeze(frontendDetailModelSchema.parse({
  ...adaptBasePage(page),
  family: 'detail',
  detail: page.detail,
})) as FrontendDetailModel

const adaptSlots = (slots: readonly ProjectedSlot[]) => slots.map((slot) => ({
  key: slot.slot_key,
  items: slot.items.map((item) => 'prompt_ref' in item
    ? { ...item, kind: 'prompt_card' as const }
    : { ...item, kind: 'node' as const, label: item.label ?? item.node_ref }),
}))

/** Converts an already bound projection into the renderer-only model for its page family. */
export const adaptFrontendProjection = (projection: PageProjection): FrontendPageModel => {
  const slots = adaptSlots(projection.slots)
  const page = projection.page
  const base = page.page_type === 'hub'
    ? adaptHubPage(page)
    : page.page_type === 'gallery'
      ? adaptGalleryPage(page)
      : page.page_type === 'entity'
        ? adaptEntityPage(page)
        : adaptDetailPage(page)

  return freeze(frontendPageModelSchema.parse({ ...base, slots })) as FrontendPageModel
}
