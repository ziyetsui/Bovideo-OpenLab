'use client'

import { useState } from 'react'

import { FacetControl } from '../components/controls'
import { canRenderPageLink, NodeEdge } from '../components/node-edge'
import { ProjectionItem, projectionEvidenceLabel } from '../components/projection-item'
import type { FrontendHubModel, FrontendRenderItem } from '../projection/types'
import { messagesForFrontendLocale } from '../localization/messages'

type SlotItem = FrontendHubModel['slots'][number]['items'][number]
type PromptCardItem = Extract<FrontendRenderItem, { kind: 'prompt_card' }>
type NodeItem = Extract<FrontendRenderItem, { kind: 'node' }>

const slotItems = (model: FrontendHubModel, key: string): readonly SlotItem[] =>
  model.slots.find((slot) => slot.key === key)?.items ?? []

const slotNodes = (model: FrontendHubModel, keys: readonly string[]): readonly NodeItem[] =>
  keys.flatMap((key) => slotItems(model, key)).filter((item): item is NodeItem => item.kind === 'node')

const uniqueCards = (model: FrontendHubModel): readonly PromptCardItem[] => {
  const cards = ['featured', 'trending', 'tasks', 'camera_motion', 'models', 'styles', 'collections', 'creators']
    .flatMap((key) => slotItems(model, key))
    .filter((item): item is PromptCardItem => item.kind === 'prompt_card')
  return [...new Map(cards.map((card) => [card.prompt_ref.id, card])).values()]
}

const HubAxis = ({ model, axis, aliases, title, selected, onToggle }: Readonly<{
  model: FrontendHubModel
  axis: string
  aliases: readonly string[]
  title: string
  selected: readonly string[]
  onToggle: (nodeRef: string, pressed: boolean) => void
}>) => {
  const items = slotNodes(model, aliases)

  return <section className="family-axis" data-axis={axis} aria-labelledby={`hub-axis-${axis}`}>
    <h3 id={`hub-axis-${axis}`}>{title}</h3>
    {items.length === 0
      ? <p className="family-empty" role="status">No {title.toLowerCase()} supplied.</p>
      : <ul>{items.map((item) => <li key={item.node_ref} data-evidence-state={item.evidence_state}>
        {canRenderPageLink(item)
          ? <NodeEdge item={item} />
          : <FacetControl label={item.label} pressed={selected.includes(item.node_ref)} onPressedChange={(pressed) => onToggle(item.node_ref, pressed)} />}
        <span className="family-evidence-label">{projectionEvidenceLabel(item.evidence_state)}</span>
      </li>)}</ul>}
  </section>
}

const Shelf = ({ model, slot, title, hidden }: Readonly<{ model: FrontendHubModel; slot: string; title: string; hidden: boolean }>) => {
  const items = slotItems(model, slot)
  const mode = model.index_state === 'indexable' ? 'public' : 'preview'

  return <section className="family-shelf" data-slot={slot} aria-labelledby={`hub-${slot}`} hidden={hidden}>
    <h2 id={`hub-${slot}`}>{title}</h2>
    {items.length === 0
      ? <p className="family-empty" role="status">No {title.toLowerCase()} supplied.</p>
      : <ul>{items.map((item, index) => <li key={item.kind === 'prompt_card' ? item.prompt_ref.id : `${item.node_ref}-${index}`} data-evidence-state={item.evidence_state}>
        <ProjectionItem item={item} mode={mode} />
      </li>)}</ul>}
  </section>
}

export const HubPage = ({ model }: Readonly<{ model: FrontendHubModel }>) => {
  const messages = messagesForFrontendLocale(model.locale)
  const [query, setQuery] = useState('')
  const [selectedByAxis, setSelectedByAxis] = useState<Readonly<Record<string, readonly string[]>>>({})
  const cards = uniqueCards(model)
  const mode = model.index_state === 'indexable' ? 'public' : 'preview'
  const normalizedQuery = query.trim().toLowerCase()
  const activeAxes = Object.values(selectedByAxis).filter((values) => values.length > 0)
  const filterActive = normalizedQuery.length > 0 || activeAxes.length > 0
  const filteredCards = cards.filter((card) => {
    const tagRefs = new Set(card.tags.map((tag) => tag.node_ref))
    const matchesAxes = activeAxes.every((selected) => selected.some((nodeRef) => tagRefs.has(nodeRef)))
    const searchText = [card.title, card.summary ?? '', ...card.tags.map((tag) => tag.node_ref)].join(' ').toLowerCase()
    return matchesAxes && (normalizedQuery.length === 0 || searchText.includes(normalizedQuery))
  })
  const toggleFacet = (axis: string, nodeRef: string, pressed: boolean) => setSelectedByAxis((current) => ({
    ...current,
    [axis]: pressed
      ? [...new Set([...(current[axis] ?? []), nodeRef])]
      : (current[axis] ?? []).filter((value) => value !== nodeRef),
  }))

  return <div className="page-family page-family--hub">
    <section className="family-hero" data-slot="hero">
      <p>{model.description ?? model.title}</p>
      {model.inventory_count === undefined ? null : <p data-slot="inventory-count">{model.inventory_count} available prompts</p>}
      {model.snapshot_date === undefined ? null : <time data-slot="snapshot" dateTime={model.snapshot_date}>Snapshot: {model.snapshot_date}</time>}
    </section>
    <section className="family-search" data-slot="search" aria-label={messages.chrome.searchPrompts}>
      <label htmlFor="hub-search">{messages.chrome.searchPrompts}</label>
      <input id="hub-search" type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
    </section>
    <section className="family-axes" data-slot="axes">
      <h2>{messages.chrome.explore}</h2>
      <HubAxis model={model} axis="outputs" aliases={['outputs', 'output', 'axis_outputs', 'axis_output']} title={messages.chrome.outputs} selected={selectedByAxis.outputs ?? []} onToggle={(nodeRef, pressed) => toggleFacet('outputs', nodeRef, pressed)} />
      <HubAxis model={model} axis="use_cases" aliases={['use_cases', 'use_case', 'axis_use_cases', 'axis_use_case']} title={messages.chrome.useCases} selected={selectedByAxis.use_cases ?? []} onToggle={(nodeRef, pressed) => toggleFacet('use_cases', nodeRef, pressed)} />
      <HubAxis model={model} axis="styles" aliases={['styles', 'style', 'axis_styles', 'axis_style']} title={messages.chrome.styles} selected={selectedByAxis.styles ?? []} onToggle={(nodeRef, pressed) => toggleFacet('styles', nodeRef, pressed)} />
      <HubAxis model={model} axis="techniques" aliases={['techniques', 'technique', 'axis_techniques', 'axis_technique']} title={messages.chrome.techniques} selected={selectedByAxis.techniques ?? []} onToggle={(nodeRef, pressed) => toggleFacet('techniques', nodeRef, pressed)} />
    </section>
    <section className="family-results" data-slot="results" data-testid="hub-results" aria-live="polite">
      {!filterActive
        ? <p>Browse state — no filter is active.</p>
        : <><p>{filteredCards.length} {filteredCards.length === 1 ? 'result' : 'results'}.</p><ul>{filteredCards.map((card) => <li key={card.prompt_ref.id}><ProjectionItem item={card} mode={mode} /></li>)}</ul></>}
    </section>
    <Shelf model={model} slot="featured" title={messages.chrome.featured} hidden={filterActive} />
    <Shelf model={model} slot="trending" title={messages.chrome.trending} hidden={filterActive} />
    <Shelf model={model} slot="tasks" title={messages.chrome.tasks} hidden={filterActive} />
    <Shelf model={model} slot="camera_motion" title={messages.chrome.cameraMotion} hidden={filterActive} />
    <Shelf model={model} slot="models" title={messages.chrome.models} hidden={filterActive} />
    <Shelf model={model} slot="styles" title={messages.chrome.styles} hidden={filterActive} />
    <Shelf model={model} slot="collections" title={messages.chrome.collections} hidden={filterActive} />
    <Shelf model={model} slot="creators" title={messages.chrome.creators} hidden={filterActive} />
    <section className="family-cta" data-slot="cta"><h2>Keep the original prompt close</h2><p>Copy actions appear only for supplied prompt records.</p></section>
    <footer className="family-footer" data-slot="footer">Projection-led prompt discovery.</footer>
  </div>
}
