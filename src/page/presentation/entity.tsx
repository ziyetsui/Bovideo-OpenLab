import type { ReactNode } from 'react'

import type { EntityPage } from '@/page/schema'
import { PageAction } from '@/page/shell'

import { evidenceTone, itemLinks, relatedLinks } from './model'
import {
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

export const EntityComposer = ({ page, routeIntro }: Readonly<{ page: EntityPage; routeIntro?: ReactNode }>) => {
  const links = itemLinks(page)
  const recent = links.slice(0, 3)
  const inventory = links
  const qualificationLabel = page.qualification.qualified ? 'Qualified entity' : 'Entity not qualified for publication'

  return <article className="page-frame" data-generated-filler-count={page.generated_filler_count} data-page-family="entity">
    <section className="page-section" data-section="entity-hero">
      <PosterHero tone={page.qualification.qualified ? 'yellow' : 'red'}>
        <p className="poster-eyebrow">{page.entity_kind.replace('_', ' ')} / {page.entity_slug}</p>
        {routeIntro ?? <p data-entity-identity>Entity identity: {page.entity_slug}. Capability evidence is limited to approved modules.</p>}
        <p className="qualification-banner" data-qualified={page.qualification.qualified} data-entity-qualification>{qualificationLabel}</p>
        <div className="stats-grid entity-hero__stats" data-responsive-grid="stats">
          <StatBlock label="Usable items" value={page.qualification.usable_items} tone="blue" />
          <StatBlock label="Independent creators" value={page.qualification.independent_creators} tone="red" />
          <StatBlock label="Sibling overlap" value={page.qualification.sibling_overlap_ratio} />
          <StatBlock label="Rendered routes" value={links.length} tone="yellow" />
        </div>
        <SearchActionField action={page.route} id="entity-generation" label="Describe a prompt outcome" buttonLabel="Generate" disabled reason="Generation is unavailable without an approved product action." />
      </PosterHero>
    </section>

    <section className="page-section" data-section="entity-recent">
      <SectionHeading index="01" title="Recent snapshot" description="The first approved routes in this entity inventory." />
      {recent.length === 0
        ? <UnavailablePanel title="Recent routes" reason="No approved recent routes are present." />
        : <div className="prompt-grid" data-responsive-grid="prompts">{recent.map((link, index) => <PromptCard key={link.href} link={link} ordinal={index + 1} />)}</div>}
    </section>

    <section className="page-section" data-section="entity-inventory">
      <SectionHeading index="02" title="All qualified prompts" description="Every visible card is backed by an indexable item link." />
      {inventory.length === 0
        ? <UnavailablePanel title="Entity inventory" reason="No residual approved item routes are present." />
        : <div className="prompt-grid" data-responsive-grid="prompts">{inventory.map((link, index) => <PromptCard key={link.href} link={link} ordinal={index + 1} />)}</div>}
    </section>

    <section className="page-section" data-section="entity-variables">
      <SectionHeading index="03" title="Variable-bearing prompts" />
      <UnavailablePanel title="Variable evidence" reason="The entity envelope does not provide approved variable definitions." />
    </section>

    <section className="page-section" data-section="entity-creators">
      <SectionHeading index="04" title="Creators" description={`${page.creator_count} independent creator records qualify, but identities are not included in this envelope.`} />
      <UnavailablePanel title="Creator identities" reason="Creator names are unavailable from approved evidence." />
    </section>

    <section className="page-section" data-section="entity-about" data-page-modules>
      <SectionHeading index="05" title="About & evidence" />
      <div className="module-list">{page.modules.map((module) => <article key={module.module_id} className="module-row" data-module-state={module.state}>
        <span>{module.title}</span><EvidenceBadge label={module.state} tone={evidenceTone(module.state)} />
      </article>)}</div>
      <MethodNote><p data-entity-freshness>Freshness and provenance are shown per module; unsupported capabilities remain unavailable.</p></MethodNote>
    </section>

    <section className="page-section" data-section="entity-self-audit">
      <SectionHeading index="06" title="Qualification self-audit" />
      <dl className="audit-grid">
        <div><dt>Status</dt><dd>{qualificationLabel}</dd></div>
        <div><dt>Usable items</dt><dd>{page.qualification.usable_items}</dd></div>
        <div><dt>Independent creators</dt><dd>{page.qualification.independent_creators}</dd></div>
        <div><dt>Sibling overlap</dt><dd>{page.qualification.sibling_overlap_ratio}</dd></div>
        <div className="audit-grid__wide"><dt>Reason ledger</dt><dd data-qualification-reasons>{page.qualification.reason_codes.join(', ')}</dd></div>
      </dl>
    </section>

    <section className="page-section" data-section="entity-related">
      <RelatedLinkBand links={relatedLinks(page)} />
    </section>

    <section className="page-section" data-section="entity-cta">
      <FinalCta title="Use a qualified prompt" description="Execution remains disabled until the action has approved evidence and a product URL." action={<PageAction enabled={false} label="Run prompt" unavailableReason="No approved product action is available in the internal preview." />} />
    </section>
  </article>
}
