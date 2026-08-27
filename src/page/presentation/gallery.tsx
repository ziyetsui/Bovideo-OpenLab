import type { ReactNode } from 'react'

import type { GalleryPage } from '@/page/schema'

import { evidenceTone, itemLinks, relatedLinks } from './model'
import {
  AxisRail,
  EvidenceBadge,
  MethodNote,
  PosterHero,
  PromptCard,
  RelatedLinkBand,
  SearchActionField,
  SectionHeading,
  StatBlock,
  UnavailablePanel,
} from './primitives'

export const GalleryComposer = ({ page, routeIntro }: Readonly<{ page: GalleryPage; routeIntro?: ReactNode }>) => {
  const links = itemLinks(page)
  const featured = links.slice(0, 4)
  const residual = links.slice(4)
  const totalPages = Math.max(1, Math.ceil(page.total_items / page.page_size))

  return <article className="page-frame" data-generated-filler-count={page.generated_filler_count} data-page-family="gallery">
    <section className="page-section" data-section="gallery-hero">
      <PosterHero tone="blue">
        <p className="poster-eyebrow">{page.media_type} prompt gallery</p>
        {routeIntro ?? <p>A finite, evidence-backed medium projection with crawlable pagination.</p>}
        <div className="stats-grid gallery-hero__stats" data-responsive-grid="stats">
          <StatBlock label="Qualified results" value={page.total_items} tone="yellow" />
          <StatBlock label="Current page" value={`${page.page}/${totalPages}`} tone="red" />
          <StatBlock label="Page size" value={page.page_size} />
          <StatBlock label="Rendered routes" value={links.length} tone="blue" />
        </div>
        <SearchActionField action={page.route} id="gallery-search" label={`Search approved ${page.media_type} prompts`} disabled reason="Search is unavailable until an approved graph-query contract exists." />
        <p className="gallery-filter" data-gallery-filter>Showing {page.filter_state.output} results · page {page.page} of {totalPages}</p>
      </PosterHero>
    </section>

    <section className="page-section" data-section="gallery-axes" data-browse-axes>
      <SectionHeading index="01" title="Browse the axes" description="Subject, output and style remain separate navigation dimensions." />
      <div className="axis-grid" data-responsive-grid="axes">
        <AxisRail title="Subject" items={[{ label: 'No approved subject facets in this snapshot' }]} />
        <AxisRail title="Output" items={[{ label: page.media_type, count: page.total_items }]} />
        <AxisRail title="Style" items={[{ label: 'No approved style facets in this snapshot' }]} />
      </div>
    </section>

    <section className="page-section" data-section="gallery-featured">
      <SectionHeading index="02" title="Featured routes" description="The first approved routes in this finite page window." />
      {featured.length === 0
        ? <UnavailablePanel title="Featured routes" reason="No approved item route is available for this page." />
        : <div className="prompt-grid" data-responsive-grid="prompts">{featured.map((link, index) => <PromptCard key={link.href} link={link} ordinal={index + 1} />)}</div>}
    </section>

    <section className="page-section" data-section="gallery-models">
      <SectionHeading index="03" title="Browse by model" />
      <div className="state-grid">
        <UnavailablePanel title="Model facets" reason="Model taxonomy is not present in the approved gallery envelope." />
        <UnavailablePanel title="Model shelves" reason="No model-to-item evidence can be asserted for this snapshot." />
      </div>
    </section>

    <section className="page-section" data-section="gallery-subject">
      <SectionHeading index="04" title="Subject band" />
      <UnavailablePanel title="Subject projection" reason="Subject labels are unavailable from approved evidence." />
    </section>

    <section className="page-section" data-section="gallery-residual" data-residual-inventory>
      <SectionHeading index="05" title="Residual inventory" description="Residual inventory is finite and remains noindex until release approval." />
      {residual.length === 0
        ? <UnavailablePanel title="No residual routes" reason="This page window has no remaining approved routes." />
        : <div className="prompt-grid" data-responsive-grid="prompts">{residual.map((link, index) => <PromptCard key={link.href} link={link} ordinal={index + featured.length + 1} />)}</div>}
    </section>

    <section className="page-section" data-section="gallery-method" data-page-modules>
      <SectionHeading index="06" title="Definition & method" />
      <div className="module-list">{page.modules.map((module) => <article key={module.module_id} className="module-row" data-module-state={module.state}>
        <span>{module.title}</span><EvidenceBadge label={module.state} tone={evidenceTone(module.state)} />
      </article>)}</div>
      <MethodNote><p data-methodology>Only approved, rights-backed, non-stale evidence is rendered. Mixed and unresolved media never enter this gallery.</p></MethodNote>
    </section>

    <section className="page-section" data-section="gallery-related">
      <RelatedLinkBand links={relatedLinks(page)} />
    </section>

    <section className="page-section" data-section="gallery-pagination">
      <nav className="pagination" aria-label="Gallery pagination">
        {page.previous_page === null ? <span aria-hidden="true" /> : <a rel="prev" href={page.previous_page}>Previous page</a>}
        <strong>Page {page.page} / {totalPages}</strong>
        {page.next_page === null ? <span aria-hidden="true" /> : <a rel="next" href={page.next_page}>Next page</a>}
      </nav>
    </section>
  </article>
}
