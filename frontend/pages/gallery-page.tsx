'use client'

import { useState } from 'react'

import { FacetControl } from '../components/controls'
import { ProjectionItem, projectionEvidenceLabel } from '../components/projection-item'
import type { FrontendGalleryModel, FrontendRenderItem } from '../projection/types'

type SlotItem = FrontendGalleryModel['slots'][number]['items'][number]
type PromptCardItem = Extract<FrontendRenderItem, { kind: 'prompt_card' }>
type NodeItem = Extract<FrontendRenderItem, { kind: 'node' }>

const slotItems = (model: FrontendGalleryModel, key: string): readonly SlotItem[] =>
  model.slots.find((slot) => slot.key === key)?.items ?? []

const galleryCards = (model: FrontendGalleryModel): readonly PromptCardItem[] => {
  const cards = ['featured', 'models', 'subject_band']
    .flatMap((key) => slotItems(model, key))
    .filter((item): item is PromptCardItem => item.kind === 'prompt_card')
  return [...new Map(cards.map((card) => [card.prompt_ref.id, card])).values()]
}

const Facet = ({ model, slot, title, selected, onToggle }: Readonly<{
  model: FrontendGalleryModel
  slot: string
  title: string
  selected: readonly string[]
  onToggle: (nodeRef: string, pressed: boolean) => void
}>) => {
  const items = slotItems(model, slot).filter((item): item is NodeItem => item.kind === 'node')

  return <section className="family-facet" data-slot={slot} aria-labelledby={`gallery-${slot}`}>
    <h2 id={`gallery-${slot}`}>{title}</h2>
    {items.length === 0
      ? <p className="family-empty" role="status">No {title.toLowerCase()} facets supplied.</p>
      : <ul>{items.map((item) => <li key={item.node_ref} data-evidence-state={item.evidence_state}>
        <FacetControl label={item.label} pressed={selected.includes(item.node_ref)} onPressedChange={(pressed) => onToggle(item.node_ref, pressed)} />
        <span className="family-evidence-label">{projectionEvidenceLabel(item.evidence_state)}</span>
      </li>)}</ul>}
  </section>
}

const Shelf = ({ model, slot, title, hidden = false }: Readonly<{ model: FrontendGalleryModel; slot: string; title: string; hidden?: boolean }>) => {
  const items = slotItems(model, slot)
  return <section className="family-shelf" data-slot={slot} aria-labelledby={`gallery-${slot}`} hidden={hidden}>
    <h2 id={`gallery-${slot}`}>{title}</h2>
    {items.length === 0 ? <p className="family-empty" role="status">No {title.toLowerCase()} supplied.</p> : <ul>{items.map((item, index) => <li key={item.kind === 'prompt_card' ? item.prompt_ref.id : `${item.node_ref}-${index}`} data-evidence-state={item.evidence_state}>
      <ProjectionItem item={item} />
    </li>)}</ul>}
  </section>
}

const Residual = ({ model, hidden }: Readonly<{ model: FrontendGalleryModel; hidden: boolean }>) => {
  const items = slotItems(model, 'residual')

  return <section className="family-residual" data-slot="residual" aria-labelledby="gallery-residual" hidden={hidden}>
    <h2 id="gallery-residual">Residual state</h2>
    {items.length === 0
      ? <p className="family-empty" role="status">No residual state supplied.</p>
      : <ul>{items.map((item, index) => <li key={item.kind === 'prompt_card' ? item.prompt_ref.id : `${item.node_ref}-${index}`} data-evidence-state={item.evidence_state}>
        <ProjectionItem item={item} />
      </li>)}</ul>}
  </section>
}

export const GalleryPage = ({ model }: Readonly<{ model: FrontendGalleryModel }>) => {
  const [selectedByAxis, setSelectedByAxis] = useState<Readonly<Record<string, readonly string[]>>>({})
  const activeAxes = Object.values(selectedByAxis).filter((values) => values.length > 0)
  const filterActive = activeAxes.length > 0
  const filteredCards = galleryCards(model).filter((card) => {
    const tagRefs = new Set(card.tags.map((tag) => tag.node_ref))
    return activeAxes.every((selected) => selected.some((nodeRef) => tagRefs.has(nodeRef)))
  })
  const toggleFacet = (axis: string, nodeRef: string, pressed: boolean) => setSelectedByAxis((current) => ({
    ...current,
    [axis]: pressed
      ? [...new Set([...(current[axis] ?? []), nodeRef])]
      : (current[axis] ?? []).filter((value) => value !== nodeRef),
  }))

  return <div className="page-family page-family--gallery">
    <section className="family-hero" data-slot="hero"><p>{model.description ?? model.title}</p></section>
    <section className="family-stats" data-slot="stats" aria-label="Gallery statistics"><strong>{model.total_items}</strong><span>{model.media_type} prompts</span><span>Page {model.page}</span></section>
    <section className="family-search" data-slot="search" aria-label="Search gallery">
      <label htmlFor="gallery-search">Search {model.media_type} prompts</label>
      <input id="gallery-search" type="search" disabled aria-describedby="gallery-search-state" />
      <p id="gallery-search-state" role="status">Search is unavailable without an approved graph-query contract.</p>
    </section>
    <section className="family-facets" data-slot="facets"><p>Facet selections are noindex in-page filter states.</p></section>
    <Facet model={model} slot="use_cases" title="Use cases" selected={selectedByAxis.use_cases ?? []} onToggle={(nodeRef, pressed) => toggleFacet('use_cases', nodeRef, pressed)} />
    <Facet model={model} slot="styles" title="Styles" selected={selectedByAxis.styles ?? []} onToggle={(nodeRef, pressed) => toggleFacet('styles', nodeRef, pressed)} />
    <Facet model={model} slot="subjects" title="Subjects" selected={selectedByAxis.subjects ?? []} onToggle={(nodeRef, pressed) => toggleFacet('subjects', nodeRef, pressed)} />
    <section className="family-results" data-slot="results" data-testid="gallery-results" aria-live="polite">
      {!filterActive
        ? <p>Browse state — no filter is active.</p>
        : <><p>{filteredCards.length} {filteredCards.length === 1 ? 'result' : 'results'}.</p><ul>{filteredCards.map((card) => <li key={card.prompt_ref.id}><ProjectionItem item={card} /></li>)}</ul></>}
    </section>
    <Shelf model={model} slot="featured" title="Featured" hidden={filterActive} />
    <Shelf model={model} slot="models" title="Models" hidden={filterActive} />
    <Shelf model={model} slot="subject_band" title="Subject band" hidden={filterActive} />
    <Residual model={model} hidden={filterActive} />
    <Shelf model={model} slot="related" title="Related" hidden={filterActive} />
    {model.previous_page === null && model.next_page === null ? null : <nav className="family-pagination" data-slot="pagination" aria-label="Gallery pagination">
      {model.previous_page === null ? null : <a rel="prev" href={model.previous_page}>Previous page</a>}
      {model.next_page === null ? null : <a rel="next" href={model.next_page}>Next page</a>}
    </nav>}
    <section className="family-cta" data-slot="cta"><h2>Use supplied prompt records</h2><p>Copy actions remain available only where prompt text is supplied.</p></section>
    <footer className="family-footer" data-slot="footer">Projection-led {model.media_type} gallery.</footer>
  </div>
}
