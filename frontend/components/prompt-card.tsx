import type { ProjectedNodeItem, ProjectedPromptCard } from '@/contracts/projection'

import { CopyPromptButton } from './controls'
import { MediaBlock, type RenderableMedia } from './media-block'
import { canRenderPageLink, NodeEdge } from './node-edge'

export type PromptCardAction = Readonly<{
  label: string
  evidence_state: ProjectedPromptCard['evidence_state']
  link_policy: ProjectedPromptCard['link_policy']
  href: string | null
  render_target: ProjectedPromptCard['render_target']
  target_indexability: ProjectedPromptCard['target_indexability']
}>

type PromptCardData = Readonly<Omit<ProjectedPromptCard, 'prompt_ref' | 'tags'> & {
  prompt_ref: Readonly<ProjectedPromptCard['prompt_ref']>
  tags: readonly Readonly<ProjectedNodeItem>[]
}>

type PromptCardActions = Readonly<{
  source?: PromptCardAction
  metrics?: PromptCardAction
  detail?: PromptCardAction
}>

const CardAction = ({ name, action }: Readonly<{ name: 'source' | 'metrics' | 'detail'; action?: PromptCardAction }>) => {
  if (action !== undefined && canRenderPageLink(action))
    return <a data-prompt-action={name} href={action.href}>{action.label}</a>

  return <span data-prompt-action={name} data-action-state="unavailable" role="status">{action?.label ?? `${name[0].toUpperCase()}${name.slice(1)}`} unavailable</span>
}

export const PromptCard = ({ card, media = null, mode = 'public', promptText, actions = {} }: Readonly<{
  card: PromptCardData
  media?: RenderableMedia | null
  mode?: 'preview' | 'public'
  promptText?: string
  actions?: PromptCardActions
}>) => <article className="prompt-card" data-link-policy={card.link_policy} data-evidence-state={card.evidence_state}>
  <header>
    {canRenderPageLink(card)
      ? <a href={card.href}>{card.title}</a>
      : <span>{card.title}</span>}
  </header>
  {card.summary === null ? null : <p>{card.summary}</p>}
  <MediaBlock media={media} mode={mode} />
  {card.tags.length === 0 ? null : <ul aria-label="Tags">{card.tags.map((tag) => <li key={tag.node_ref}><NodeEdge item={{ ...tag, label: tag.node_ref }} /></li>)}</ul>}
  <footer className="prompt-card__actions">
    <CardAction name="source" action={actions.source} />
    <CardAction name="metrics" action={actions.metrics} />
    {promptText === undefined
      ? <span data-prompt-action="copy" data-action-state="unavailable" role="status">Copy unavailable</span>
      : <CopyPromptButton text={promptText} />}
    <CardAction name="detail" action={actions.detail} />
  </footer>
</article>
