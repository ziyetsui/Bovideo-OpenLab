import { INVENTORY_DETAIL_ROUTE_IDS, inventoryPageId, LOCAL_DETAIL_PAGES } from '@/detail/local-fixture'
import { APPLICATION_LOCALES, type ApplicationLocale } from '@/contracts/locale'
import type { PageEnvelope, PageFamily } from './schema'

const HASH = 'sha256:v1:0000000000000000000000000000000000000000000000000000000000000000' as const
const SOURCE = { type: 'source' as const, id: '00000000-0000-4000-8000-000000000001' }
const PAGE_IDS = {
  hub: '00000000-0000-4000-8000-000000000011',
  gallery: '00000000-0000-4000-8000-000000000012',
  entity: '00000000-0000-4000-8000-000000000013',
  detail: '00000000-0000-4000-8000-000000000014',
} as const
const MODULE_IDS = {
  case: '00000000-0000-4000-8000-000000000021',
  tutorial: '00000000-0000-4000-8000-000000000022',
  prompt: '00000000-0000-4000-8000-000000000023',
  comparison: '00000000-0000-4000-8000-000000000024',
  faq: '00000000-0000-4000-8000-000000000025',
} as const
const OBSERVED_AT = '2026-08-25T00:00:00.000Z' as const
const inventoryLinks = (locale: ApplicationLocale, ids: readonly string[]) => ids.map((routeId) => ({ relation: 'item' as const, href: `/${locale}/prompts/cinematic-product-shot-${routeId}`, label: `Cinematic product shot ${routeId.slice(-4)}`, target_page_id: inventoryPageId(routeId), indexable: true, evidence_state: 'reviewed' as const, link_policy: 'link' as const, render_target: 'page' as const }))

type FixtureState = 'complete' | 'partial' | 'stale'
type FixtureSet = Readonly<Record<FixtureState, PageEnvelope>>

const moduleRef = (moduleType: keyof typeof MODULE_IDS, state: 'available' | 'unavailable' | 'stale' | 'candidate' = 'available') => ({
  module_id: MODULE_IDS[moduleType],
  module_type: moduleType,
  state,
  title: `${moduleType} evidence`,
  source_refs: [SOURCE],
  content_hash: HASH,
})

const base = (family: PageFamily, state: FixtureState, locale: ApplicationLocale) => ({
  schema_version: 1,
  page_id: PAGE_IDS[family],
  route: `/${locale}/prompts${family === 'hub' ? '' : `/${family}`}`,
  locale,
  index_state: 'discoverable_noindex' as const,
  title: `Preview ${family} — ${state}`,
  description: `Evidence-backed ${family} preview fixture in ${locale}.`,
  h1: `Preview ${family}`,
  canonical: `https://preview.local/${locale}/prompts${family === 'hub' ? '' : `/${family}`}`,
  breadcrumbs: [{ label: 'Prompts', href: `/${locale}/prompts` }],
  provenance: { state: state === 'complete' ? 'explicit' as const : state === 'partial' ? 'unavailable' as const : 'candidate' as const, source_refs: [SOURCE], observed_at: OBSERVED_AT },
  modules: state === 'complete'
    ? [moduleRef('prompt'), moduleRef('case')]
    : state === 'partial'
      ? [moduleRef('prompt'), moduleRef('case', 'unavailable')]
      : [moduleRef('prompt', 'stale'), moduleRef('case', 'candidate')],
  links: [{ relation: 'canonical' as const, href: `/${locale}/prompts`, label: 'Prompts', target_page_id: PAGE_IDS.hub, indexable: false, evidence_state: 'reviewed' as const, link_policy: 'link' as const, render_target: 'page' as const }],
  snapshot_version: 1,
  content_hash: HASH,
  generated_filler_count: 0 as const,
})

const makeHub = (state: FixtureState): PageEnvelope => ({
  ...base('hub', state, 'en'),
  page_type: 'hub',
  inventory_count: state === 'complete' ? 24 : state === 'partial' ? 0 : 12,
  snapshot_date: OBSERVED_AT,
  featured_module_ids: state === 'complete' ? [MODULE_IDS.prompt] : [],
  diversity_rule_version: 'p3-diversity-v1',
  links: state === 'complete' ? [
    ...base('hub', state, 'en').links,
    ...inventoryLinks('en', INVENTORY_DETAIL_ROUTE_IDS),
  ] : base('hub', state, 'en').links,
})

const makeGallery = (state: FixtureState): PageEnvelope => ({
  ...base('gallery', state, 'en'),
  page_type: 'gallery',
  media_type: 'image',
  page: 1,
  page_size: 12,
  total_items: state === 'complete' ? 24 : state === 'partial' ? 0 : 8,
  filter_state: { output: 'image' },
  next_page: state === 'complete' ? '/en/prompts/image?page=2' : null,
  previous_page: null,
  links: state === 'complete' ? [
    ...base('gallery', state, 'en').links,
    ...inventoryLinks('en', INVENTORY_DETAIL_ROUTE_IDS.slice(0, 12)),
  ] : base('gallery', state, 'en').links,
})

const makeEntity = (state: FixtureState): PageEnvelope => ({
  ...base('entity', state, 'en'),
  page_type: 'entity',
  entity_kind: 'model',
  entity_slug: 'example-model',
  qualification: {
    qualified: state === 'complete',
    reason_codes: state === 'complete' ? ['all_gates_passed'] : ['insufficient_usable_items'],
    usable_items: state === 'complete' ? 12 : 3,
    independent_creators: state === 'complete' ? 2 : 1,
    sibling_overlap_ratio: state === 'complete' ? 0.2 : 0.8,
    demand_evidence_ref: state === 'complete' ? SOURCE : null,
    keyword_owner: state === 'complete' ? 'example-model-prompts' : null,
  },
  item_count: state === 'complete' ? 12 : 3,
  creator_count: state === 'complete' ? 2 : 1,
  links: state === 'complete' ? [
    ...base('entity', state, 'en').links,
    ...inventoryLinks('en', INVENTORY_DETAIL_ROUTE_IDS.slice(0, 12)),
  ] : base('entity', state, 'en').links,
})

const makeDetail = (state: FixtureState): PageEnvelope => {
  const detail = LOCAL_DETAIL_PAGES[0]!
  const questions = detail.questions.map((question) => {
    if (state === 'partial' && (question.id === 'inputs' || question.id === 'examples')) return { ...question, state: 'unavailable' as const, provenance: 'unavailable' as const }
    if (state === 'stale' && (question.id === 'source_signals' || question.id === 'variations')) return { ...question, state: 'stale' as const, provenance: 'candidate' as const }
    return question
  }) as typeof detail.questions
  return {
    ...base('detail', state, detail.locale),
    page_id: detail.pageId,
    route: `/${detail.locale}/prompts/${detail.slug}-${detail.routeId}`,
    canonical: `https://preview.local/${detail.locale}/prompts/${detail.slug}-${detail.routeId}`,
    title: state === 'complete' ? detail.title : `Preview detail — ${state}`,
    h1: state === 'complete' ? detail.title : `Preview detail — ${state}`,
    page_type: 'detail',
    detail: state === 'complete' ? detail : { ...detail, questions, generatedFillerCount: 0 },
  }
}

export const P3_GOLDEN_FIXTURES: Readonly<Record<PageFamily, FixtureSet>> = Object.freeze({
  hub: Object.freeze({ complete: makeHub('complete'), partial: makeHub('partial'), stale: makeHub('stale') }),
  gallery: Object.freeze({ complete: makeGallery('complete'), partial: makeGallery('partial'), stale: makeGallery('stale') }),
  entity: Object.freeze({ complete: makeEntity('complete'), partial: makeEntity('partial'), stale: makeEntity('stale') }),
  detail: Object.freeze({ complete: makeDetail('complete'), partial: makeDetail('partial'), stale: makeDetail('stale') }),
})

export const P3_GOLDEN_FIXTURE_LIST = Object.freeze(
  (Object.keys(P3_GOLDEN_FIXTURES) as PageFamily[]).flatMap((family) =>
    (Object.keys(P3_GOLDEN_FIXTURES[family]!) as FixtureState[]).map((state) => ({ family, state, page: P3_GOLDEN_FIXTURES[family]![state] }))),
)

const localize = (page: PageEnvelope, locale: ApplicationLocale): PageEnvelope => {
  if (page.page_type === 'detail') {
    const detail = LOCAL_DETAIL_PAGES.find((candidate) => candidate.locale === locale) ?? LOCAL_DETAIL_PAGES[0]!
    return { ...page, page_id: detail.pageId, locale, route: `/${locale}/prompts/${detail.slug}-${detail.routeId}`, canonical: `https://preview.local/${locale}/prompts/${detail.slug}-${detail.routeId}`, detail: { ...page.detail, locale, routeId: detail.routeId, pageId: detail.pageId, slug: detail.slug } }
  }
  return { ...page, locale, route: `/${locale}/prompts${page.page_type === 'hub' ? '' : `/${page.page_type}`}`, canonical: `https://preview.local/${locale}/prompts${page.page_type === 'hub' ? '' : `/${page.page_type}`}`, breadcrumbs: [{ label: 'Prompts', href: `/${locale}/prompts` }], links: page.links.map((link) => ({ ...link, href: link.href.replace(/^\/en(?=\/)/, `/${locale}`) })) }
}

const localeFixtures = {} as Record<PageFamily, Readonly<Record<FixtureState, readonly PageEnvelope[]>>>
for (const family of Object.keys(P3_GOLDEN_FIXTURES) as PageFamily[]) {
  const states = {} as Record<FixtureState, readonly PageEnvelope[]>
  for (const state of Object.keys(P3_GOLDEN_FIXTURES[family]!) as FixtureState[])
    states[state] = Object.freeze(APPLICATION_LOCALES.map((locale) => localize(P3_GOLDEN_FIXTURES[family]![state]!, locale)))
  localeFixtures[family] = Object.freeze(states)
}
export const P3_GOLDEN_LOCALE_FIXTURES: Readonly<Record<PageFamily, Readonly<Record<FixtureState, readonly PageEnvelope[]>>>> = Object.freeze(localeFixtures)
