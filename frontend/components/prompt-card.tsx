import type { ProjectedPromptCard } from '@/contracts/projection'

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

type ReadonlyDeep<Value> = Value extends readonly (infer Item)[]
  ? readonly ReadonlyDeep<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: ReadonlyDeep<Value[Key]> }
    : Value

type PromptCardData = ReadonlyDeep<ProjectedPromptCard>

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
  media?: RenderableMedia | readonly RenderableMedia[] | null
  mode?: 'preview' | 'public'
  promptText?: string
  actions?: PromptCardActions
}>) => {
  const resolvedMedia = media === null
    ? card.media ?? []
    : Array.isArray(media) ? media : [media]
  const resolvedPromptText = promptText ?? card.prompt_text

  return <article className="prompt-card" data-link-policy={card.link_policy} data-evidence-state={card.evidence_state}>
  <header>
    {canRenderPageLink(card)
      ? <a href={card.href}>{card.title}</a>
      : <span>{card.title}</span>}
  </header>
  {card.summary === null ? null : <p>{card.summary}</p>}
  {resolvedPromptText === undefined ? null : <pre className="prompt-card__prompt">{resolvedPromptText}</pre>}
  {resolvedMedia.length === 0
    ? <MediaBlock media={null} mode={mode} />
    : <div className="prompt-card__media" data-media-count={resolvedMedia.length}>{resolvedMedia.map((item, index) => <MediaBlock key={'media_evidence_id' in item ? item.media_evidence_id : `${item.approved_media_id}-${index}`} media={item} mode={mode} />)}</div>}
  {card.tags.length === 0 ? null : <ul aria-label="Tags">{card.tags.map((tag) => <li key={tag.node_ref}><NodeEdge item={{ ...tag, label: tag.label ?? tag.node_ref }} /></li>)}</ul>}
  <footer className="prompt-card__actions">
    <CardAction name="source" action={actions.source} />
    <CardAction name="metrics" action={actions.metrics} />
    {resolvedPromptText === undefined
      ? <span data-prompt-action="copy" data-action-state="unavailable" role="status">Copy unavailable</span>
      : <CopyPromptButton text={resolvedPromptText} />}
    <CardAction name="detail" action={actions.detail} />
  </footer>
</article>
}
