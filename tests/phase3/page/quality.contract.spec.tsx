import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LOCAL_DETAIL_PAGES } from '@/detail/local-fixture'
import { toDetailPageEnvelope } from '@/detail/page-envelope'
import { DetailPageView } from '@/detail/render'
import { PageShell } from '@/page/shell'
import { PageRouteView } from '@/page/route-view'
import { auditKeyboardJourney, auditPageHtml, auditPagePerformance } from '@/page/quality'
import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'

describe('P3-T09 accessibility and performance quality harness', () => {
  it('passes the shared shell and detail server HTML checks', () => {
    const shellHtml = `<html lang="en"><head><meta name="robots" content="noindex,nofollow"></head><body>${renderToStaticMarkup(<PageShell page={P3_GOLDEN_FIXTURES.hub.complete}><p>content</p></PageShell>)}</body></html>`
    expect(auditPageHtml(shellHtml).errors).toEqual([])
    const detail = LOCAL_DETAIL_PAGES[0]!
    const detailHtml = `<html lang="en"><head><meta name="robots" content="noindex,nofollow"></head><body>${renderToStaticMarkup(<DetailPageView page={detail} shellPage={toDetailPageEnvelope(detail)} />)}</body></html>`
    expect(auditPageHtml(detailHtml).errors).toEqual([])
    expect(auditPageHtml(detailHtml).htmlBytes).toBeLessThan(250_000)
  })

  it('fails on multiple H1, missing alt/dimensions and oversized HTML', () => {
    const bad = '<html lang="en"><body><main><h1>A</h1><h1>B</h1><img src="x"><p>content</p></main></body></html>'
    const report = auditPageHtml(bad, 20)
    expect(report.errors).toEqual(expect.arrayContaining(['H1_COUNT_INVALID', 'IMAGE_ALT_MISSING', 'IMAGE_DIMENSIONS_MISSING', 'NOINDEX_MISSING', 'HTML_BUDGET_EXCEEDED']))
  })

  it('audits the required keyboard journey and performance metrics', () => {
    const html = `<html lang="en"><body>${renderToStaticMarkup(<PageRouteView page={P3_GOLDEN_FIXTURES.hub.complete} />)}</body></html>`
    expect(auditKeyboardJourney(html)).toEqual(expect.objectContaining({ errors: [], deadLinkCount: 0 }))
    expect(auditPagePerformance({ ttfbMs: 100, lcpMs: 900, inpMs: 80, cls: 0.02 }).errors).toEqual([])
    expect(auditPagePerformance({ ttfbMs: 801, lcpMs: 2_501, inpMs: 201, cls: 0.11 }).errors).toEqual(expect.arrayContaining([
      'PERF_TTFB_BUDGET_EXCEEDED',
      'PERF_LCP_BUDGET_EXCEEDED',
      'PERF_INP_BUDGET_EXCEEDED',
      'PERF_CLS_BUDGET_EXCEEDED',
    ]))
  })

  it('fails closed for a dead CTA link and missing keyboard landmarks', () => {
    const report = auditKeyboardJourney('<html><body><a href="#" data-page-action>Run</a></body></html>')
    expect(report.errors).toEqual(expect.arrayContaining(['KEYBOARD_MAIN_TARGET_MISSING', 'KEYBOARD_SKIP_LINK_MISSING', 'KEYBOARD_LOCALE_SWITCH_MISSING', 'KEYBOARD_DEAD_LINK']))
  })
})
