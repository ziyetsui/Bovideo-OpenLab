import type { DetailPageData } from './schema'
import type { DetailPage } from '@/page/schema'

const HASH = 'sha256:v1:0000000000000000000000000000000000000000000000000000000000000000' as const
const SOURCE = { type: 'source' as const, id: '00000000-0000-4000-8000-000000000001' }

export const toDetailPageEnvelope = (page: DetailPageData): DetailPage => ({
  schema_version: 1,
  page_id: page.pageId,
  page_type: 'detail',
  route: `/${page.locale}/prompts/${page.slug}-${page.routeId}`,
  locale: page.locale,
  index_state: 'discoverable_noindex',
  title: page.title,
  description: page.description,
  h1: page.title,
  canonical: `https://preview.local/${page.locale}/prompts/${page.slug}-${page.routeId}`,
  breadcrumbs: [{ label: 'Prompts', href: `/${page.locale}/prompts` }, { label: page.title, href: `/${page.locale}/prompts/${page.slug}-${page.routeId}` }],
  provenance: { state: page.questions.some((question) => question.provenance === 'candidate') ? 'candidate' : 'explicit', source_refs: [SOURCE], observed_at: '2026-08-25T00:00:00.000Z' },
  modules: page.questions.map((question, index) => ({ module_id: `00000000-0000-4000-8000-${String(index + 101).padStart(12, '0')}`, module_type: question.id === 'actions' ? 'action' as const : question.id === 'prompt' ? 'prompt' as const : 'provenance' as const, state: question.state === 'present' ? 'available' as const : question.state === 'stale' ? 'stale' as const : 'unavailable' as const, title: question.id, source_refs: [SOURCE], content_hash: HASH })),
  links: [{ relation: 'canonical', href: `/${page.locale}/prompts/${page.slug}-${page.routeId}`, label: page.title, target_page_id: page.pageId, indexable: false, evidence_state: 'reviewed', link_policy: 'link', render_target: 'page' }],
  snapshot_version: 1,
  content_hash: page.sourceHash,
  generated_filler_count: page.generatedFillerCount,
  detail: page,
})
