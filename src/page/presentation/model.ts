import type { PageEnvelope } from '@/page/schema'

export type PageLink = PageEnvelope['links'][number]
export type EvidenceTone = 'available' | 'unavailable' | 'stale' | 'candidate'

export const itemLinks = (page: PageEnvelope): PageLink[] => page.links.filter(
  (link) => link.relation === 'item' && link.indexable,
)

export const relatedLinks = (page: PageEnvelope): PageLink[] => page.links.filter(
  (link) => (link.relation === 'related' || link.relation === 'facet') && link.indexable,
)

export const evidenceTone = (state: PageEnvelope['modules'][number]['state']): EvidenceTone => (
  state === 'available' ? 'available' : state
)
