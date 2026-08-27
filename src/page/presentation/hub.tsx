import type { ReactNode } from 'react'

import type { HubPage } from '@/page/schema'
import { PageAction } from '@/page/shell'

import { evidenceTone, itemLinks, relatedLinks } from './model'
import {
  AxisRail,
  EvidenceBadge,
  FinalCta,
  MethodNote,
  PosterHero,
  PromptCard,
  RelatedLinkBand,
  SearchActionField,
  SectionHeading,
  StatBlock,
  UnavailablePanel,
} from './primitives'

const unavailableReason = 'No approved taxonomy evidence is present in this page snapshot.'

export const HubComposer = ({ page, routeIntro }: Readonly<{ page: HubPage; routeIntro?: ReactNode }>) => {
  const links = itemLinks(page)
  const featuredModules = page.modules.filter((module) => page.featured_module_ids.includes(module.module_id))

  return <article className="page-frame" data-generated-filler-count={page.generated_filler_count} data-page-family="hub">
    <section className="page-section" data-section="hub-hero">
      <PosterHero tone="yellow">
        <div className="hero-copy">
          <p className="poster-eyebrow">Evidence-backed prompt discovery</p>
          {routeIntro ?? <p>Browse the approved prompt inventory and choose a real discovery path.</p>}
        </div>
        <div className="stats-grid hub-hero__stats" data-responsive-grid="stats">
          <StatBlock label="Qualified inventory" value={page.inventory_count} tone="red" />
          <StatBlock label="Approved routes" value={links.length} tone="blue" />
          <StatBlock label="Evidence modules" value={page.modules.length} />
          <StatBlock label="Generated filler" value={page.generated_filler_count} tone="yellow" />
        </div>
        <p className="inventory-truth" data-inventory-count>{page.inventory_count} qualified inventory items</p>
        <SearchActionField action={page.route} id="hub-search" label="Search approved prompts" disabled reason="Search is unavailable until an approved graph-query contract exists." />
        <span hidden data-hub-search />
      </PosterHero>
    </section>

    <section className="page-section" data-section="hub-axes">
      <SectionHeading index="01" title="Browse by output" description="The hierarchy follows the discovery wireframe; unsupported facets remain explicit." />
      <div className="axis-grid" data-responsive-grid="axes">
        <AxisRail title="Image" items={[{ label: 'Facet unavailable in approved snapshot' }]} />
        <AxisRail title="Video" items={[{ label: 'Facet unavailable in approved snapshot' }]} />
        <AxisRail title="Mixed / other" items={[{ label: 'Not eligible for gallery projection' }]} />
      </div>
    </section>

    <section className="page-section" data-section="hub-featured" data-featured-modules>
      <SectionHeading index="02" title="Featured evidence" description="Only modules explicitly selected by the envelope are surfaced here." />
      {featuredModules.length === 0
        ? <UnavailablePanel title="Featured evidence" reason="No featured module is available in this snapshot." />
        : <div className="featured-evidence">{featuredModules.map((module) => <article key={module.module_id} className="evidence-card" data-module-state={module.state}>
          <p className="poster-eyebrow">{module.module_type}</p>
          <h3>{module.title}</h3>
          <EvidenceBadge label={module.state} tone={evidenceTone(module.state)} />
        </article>)}</div>}
    </section>

    <section className="page-section" data-section="hub-shelves" data-browse-shelves>
      <SectionHeading index="03" title="Discovery shelves" description="Models, uses, styles, techniques and creators stay independent axes." />
      <div className="state-grid">
        {['Models', 'Use cases', 'Styles', 'Techniques', 'Creators'].map((title) => <UnavailablePanel key={title} title={title} reason={unavailableReason} />)}
      </div>
    </section>

    <section className="page-section" data-section="hub-residual">
      <SectionHeading index="04" title="Qualified inventory" description="Every card below comes from an indexable item link in the current envelope." />
      {links.length === 0
        ? <UnavailablePanel title="Inventory unavailable" reason="This snapshot contains no approved item routes." />
        : <div className="prompt-grid" data-responsive-grid="prompts">{links.map((link, index) => <PromptCard key={link.href} link={link} ordinal={index + 1} />)}</div>}
    </section>

    <section className="page-section" data-section="hub-method" data-page-modules>
      <SectionHeading index="05" title="Methodology" />
      <div className="module-list">{page.modules.map((module) => <article key={module.module_id} className="module-row" data-module-state={module.state}>
        <span>{module.title}</span><EvidenceBadge label={module.state} tone={evidenceTone(module.state)} />
      </article>)}</div>
      <MethodNote><p data-methodology>Only approved, rights-backed, non-stale evidence is rendered. Unavailable fields are never filled with generated facts.</p></MethodNote>
      <p className="snapshot-note" data-snapshot-date>Snapshot: {page.snapshot_date}</p>
    </section>

    <section className="page-section" data-section="hub-related">
      <RelatedLinkBand links={relatedLinks(page)} />
    </section>

    <section className="page-section" data-section="hub-cta">
      <FinalCta title="Choose evidence, then act" description="Product execution stays disabled until an approved action contract is attached." action={<PageAction enabled={false} label="Run prompt" unavailableReason="No approved product action is available in the internal preview." />} />
    </section>
  </article>
}
