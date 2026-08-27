import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { APPLICATION_LOCALES } from '@/contracts/locale'
import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { buildPageMetadata, PageAction, PageShell, provenanceText } from '@/page/shell'

describe('P3-T02 shared SSR shell and metadata', () => {
  it('renders one H1, breadcrumbs, provenance and all locale links in server HTML', () => {
    const page = P3_GOLDEN_FIXTURES.hub.complete
    const html = renderToStaticMarkup(<PageShell page={page}><p>server content</p></PageShell>)
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1)
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('data-provenance')
    expect((html.match(/data-locale-switch/g) ?? []).length).toBe(1)
    expect(APPLICATION_LOCALES.every((locale) => html.includes(`lang="${locale}"`))).toBe(true)
    expect(html).toContain('type="application/ld+json"')
    expect(html).toContain('server content')
    expect(html).toContain('data-ui="site-header"')
    expect(html).toContain('data-ui="brand-mark"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('data-ui="preview-strip"')
    expect(html).toContain('data-ui="locale-control"')
  })

  it('keeps Phase 3 metadata noindex and carries page identity without fallback', () => {
    const metadata = buildPageMetadata(P3_GOLDEN_FIXTURES.entity.complete)
    expect(metadata.title).toBe('Preview entity — complete')
    expect(metadata.alternates?.canonical).toContain('https://preview.local/')
    expect(metadata.robots).toMatchObject({ index: false, follow: false, noarchive: true, nosnippet: true })
    expect(metadata.other).toEqual({ 'x-page-index-state': 'discoverable_noindex', 'x-page-locale': 'en' })
  })

  it('disables unavailable actions with an explicit reason and renders enabled actions as links', () => {
    expect(renderToStaticMarkup(<PageAction enabled={false} label="Run prompt" />)).toContain('disabled')
    expect(renderToStaticMarkup(<PageAction enabled={false} label="Run prompt" />)).toContain('Action unavailable from approved evidence')
    expect(renderToStaticMarkup(<PageAction enabled label="Copy prompt" onAction="/copy" />)).toContain('href="/copy"')
    expect(renderToStaticMarkup(<PageAction enabled label="Missing URL" />)).toContain('disabled')
    expect(provenanceText('candidate')).toContain('not indexable')
  })
})
