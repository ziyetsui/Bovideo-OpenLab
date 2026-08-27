import type { FrontendEntityModel } from '../projection/types'
import { ProjectionItem } from '../components/projection-item'

type SlotItem = FrontendEntityModel['slots'][number]['items'][number]

const slotItems = (model: FrontendEntityModel, key: string): readonly SlotItem[] =>
  model.slots.find((slot) => slot.key === key)?.items ?? []

const EntityShelf = ({ model, slot, title }: Readonly<{ model: FrontendEntityModel; slot: string; title: string }>) => {
  const items = slotItems(model, slot)
  return <section className="family-shelf" data-slot={slot} aria-labelledby={`entity-${slot}`}>
    <h2 id={`entity-${slot}`}>{title}</h2>
    {items.length === 0 ? <p className="family-empty" role="status">No {title.toLowerCase()} supplied.</p> : <ul>{items.map((item, index) => <li key={item.kind === 'prompt_card' ? item.prompt_ref.id : `${item.node_ref}-${index}`} data-evidence-state={item.evidence_state}>
      <ProjectionItem item={item} />
    </li>)}</ul>}
  </section>
}

export const EntityPage = ({ model }: Readonly<{ model: FrontendEntityModel }>) => {
  const qualification = model.qualification.qualified ? 'qualified' : 'unqualified'

  return <div className="page-family page-family--entity" data-qualification={qualification}>
    <section className="family-hero" data-slot="hero">
      <p>{model.description ?? model.title}</p>
    </section>
    <section className="family-stats" data-slot="stats" aria-label="Entity facts">
      <span>{model.entity_kind}</span><span>{model.item_count} prompts</span><span>{model.creator_count} creators</span>
    </section>
    <section className="family-generation-chrome" data-slot="generation_chrome" aria-label="Generation and search">
      <label htmlFor="entity-search">Visual search preview</label><input id="entity-search" type="search" disabled />
      <p role="status">Visual-only generation and search chrome; no product capability is asserted.</p>
    </section>
    <EntityShelf model={model} slot="top_prompts" title="Top prompts" />
    <EntityShelf model={model} slot="all_prompts" title="All prompts" />
    <EntityShelf model={model} slot="facets" title="Facets" />
    <EntityShelf model={model} slot="variables" title="Variables" />
    <EntityShelf model={model} slot="creators" title="Creators" />
    <EntityShelf model={model} slot="evidence" title="Evidence" />
    <EntityShelf model={model} slot="faq" title="FAQ" />
    <section className="family-qualification" data-slot="qualification" data-qualification={qualification} role="status">
      {model.qualification.qualified ? 'Qualified for publication.' : 'Noindex — entity is not qualified for publication.'}
      <ul>{model.qualification.reason_codes.map((code) => <li key={code}>{code}</li>)}</ul>
      <p>{model.qualification.usable_items} usable items across {model.qualification.independent_creators} independent creators.</p>
    </section>
    <EntityShelf model={model} slot="related" title="Related" />
    <section className="family-cta" data-slot="cta"><h2>Inspect evidence before reuse</h2><p>Only qualified destinations are represented by links.</p></section>
    <footer className="family-footer" data-slot="footer">Projection-led entity evidence.</footer>
  </div>
}
