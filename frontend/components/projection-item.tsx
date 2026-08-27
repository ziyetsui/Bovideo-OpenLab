import { NodeEdge } from './node-edge'
import { PromptCard } from './prompt-card'
import type { FrontendRenderItem } from '../projection/types'

export const projectionEvidenceLabel = (state: FrontendRenderItem['evidence_state']): string => ({
  candidate: 'Candidate evidence; not indexable',
  reviewed: 'Reviewed evidence',
  qualified: 'Qualified evidence',
})[state]

export const ProjectionItem = ({ item, mode = 'public' }: Readonly<{ item: FrontendRenderItem; mode?: 'preview' | 'public' }>) => <>
  {item.kind === 'prompt_card'
    ? <PromptCard card={item} mode={mode} actions={{ detail: { ...item, label: 'Detail' } }} />
    : <NodeEdge item={item} />}
  <span className="family-evidence-label">{projectionEvidenceLabel(item.evidence_state)}</span>
</>
