import type { ProjectedNodeItem } from '@/contracts/projection'

export type NodeEdgeItem = ProjectedNodeItem & Readonly<{ label: string }>

type PageLinkPolicy = Pick<ProjectedNodeItem,
  'evidence_state' | 'link_policy' | 'href' | 'render_target' | 'target_indexability'
>

export const canRenderPageLink = <Item extends PageLinkPolicy>(item: Item): item is Item & Readonly<{ href: string }> => item.evidence_state !== 'candidate' &&
  item.link_policy === 'link' &&
  item.href !== null &&
  item.render_target === 'page' &&
  item.target_indexability !== 'none'

export const NodeEdge = ({ item }: Readonly<{ item: NodeEdgeItem }>) => {
  const attributes = {
    'data-link-policy': item.link_policy,
    'data-evidence-state': item.evidence_state,
    'data-target-indexability': item.target_indexability,
  }

  if (canRenderPageLink(item))
    return <a {...attributes} href={item.href}>{item.label}</a>

  if (item.link_policy === 'filter_state')
    return <span {...attributes} data-noindex="true" aria-label={`${item.label}: filter state, not a canonical page`}>{item.label}</span>

  return <span {...attributes}>{item.label}</span>
}
