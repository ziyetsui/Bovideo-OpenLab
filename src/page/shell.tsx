import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import type { PageEnvelope } from './schema'
import { buildStructuredData } from './structured-data'
import { LocaleControl, SiteHeader } from './presentation/shared-shell'

export const buildPageMetadata = (page: Pick<PageEnvelope, 'title' | 'description' | 'canonical' | 'locale' | 'index_state'>): Metadata => ({
  title: page.title,
  description: page.description,
  alternates: { canonical: page.canonical },
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    googleBot: { index: false, follow: false, noimageindex: true, noarchive: true, nosnippet: true },
  },
  other: { 'x-page-index-state': page.index_state, 'x-page-locale': page.locale },
})

export const provenanceText = (state: PageEnvelope['provenance']['state']): string => {
  switch (state) {
    case 'explicit': return 'Source-backed and explicitly reviewed'
    case 'inferred': return 'Inferred from approved evidence'
    case 'candidate': return 'Candidate evidence; not indexable'
    case 'unavailable': return 'Not available from approved evidence'
  }
}

export const LocaleSwitch = LocaleControl

export const PageAction = ({ enabled, label, unavailableReason = 'Action unavailable from approved evidence', onAction }: Readonly<{ enabled: boolean; label: string; unavailableReason?: string; onAction?: string }>) => enabled && onAction
  ? <a href={onAction} data-page-action>{label}</a>
  : <button type="button" disabled aria-disabled="true" title={enabled ? 'Action URL is unavailable from approved evidence' : unavailableReason} data-page-action>{label} — unavailable</button>

export const PageShell = ({ page, children }: Readonly<{ page: PageEnvelope; children: ReactNode }>) => <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildStructuredData(page)).replace(/</g, '\\u003c') }} />
  <a className="skip-link" href="#page-content">Skip to content</a>
  <SiteHeader page={page} provenanceLabel={provenanceText(page.provenance.state)} />
  <main id="page-content">{children}</main>
</>
