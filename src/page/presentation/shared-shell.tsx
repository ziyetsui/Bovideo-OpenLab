import { APPLICATION_LOCALES } from '@/contracts/locale'
import type { PageEnvelope } from '@/page/schema'

import { BrandMark, EvidenceBadge } from './primitives'

export const LocaleControl = ({ page }: Readonly<{ page: Pick<PageEnvelope, 'locale' | 'route'> }>) => <details className="locale-control" data-ui="locale-control">
  <summary aria-label={`Current language: ${page.locale}`}>{page.locale}</summary>
  <nav aria-label="Language" data-locale-switch>
    <ul>
      {APPLICATION_LOCALES.map((locale) => <li key={locale}>
        <a href={page.route.replace(`/${page.locale}/`, `/${locale}/`)} aria-current={locale === page.locale ? 'page' : undefined} lang={locale}>{locale}</a>
      </li>)}
    </ul>
  </nav>
</details>

export const PreviewStatusStrip = ({ family }: Readonly<{ family: PageEnvelope['page_type'] }>) => <div className="preview-strip" data-ui="preview-strip">
  <span>Internal preview</span>
  <span>Noindex / evidence only</span>
  <span>{family}</span>
</div>

export const SiteHeader = ({ page, provenanceLabel }: Readonly<{
  page: PageEnvelope
  provenanceLabel: string
}>) => <header className="site-header" data-page-shell data-ui="site-header">
  <PreviewStatusStrip family={page.page_type} />
  <div className="site-header__topbar">
    <a className="wordmark" href={`/${page.locale}/prompts`} aria-label="Bovideo OpenLab prompts home">
      <BrandMark />
      <span>Bovideo / OpenLab</span>
    </a>
    <LocaleControl page={page} />
  </div>
  <div className="site-header__hero">
    <div>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <ol>{page.breadcrumbs.map((crumb) => <li key={crumb.href}><a href={crumb.href}>{crumb.label}</a></li>)}</ol>
      </nav>
      <p className="poster-eyebrow">Prompt research / {page.page_type}</p>
      <h1>{page.h1}</h1>
      <p className="site-header__description" data-page-description>{page.description}</p>
      <p data-provenance aria-label={`Provenance: ${provenanceLabel}`}><EvidenceBadge label={provenanceLabel} tone={page.provenance.state} /></p>
    </div>
    <div className="hero-geometry" aria-hidden="true">
      <span className="hero-geometry__circle" />
      <span className="hero-geometry__square" />
      <span className="hero-geometry__bar" />
    </div>
  </div>
</header>
