import { createServer } from 'node:http'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleReviewPanel, type LocaleReviewPanelRow } from '../../src/components/LocaleReviewPanel'
import { LOCAL_DETAIL_PAGES } from '../../src/detail/local-fixture'

const rows: readonly LocaleReviewPanelRow[] = LOCAL_DETAIL_PAGES.map((page) => ({
  locale: page.locale, workflowState: 'approved' as const, sourceHash: page.sourceHash, qa: 'pass' as const,
  protectedSpans: 'pass' as const, reviewer: 'reviewer-p2l-001', revision: 2,
  reviewedAt: '2026-08-24T12:00:00.000Z', decision: 'approved' as const, reason: 'local fixture review',
}))
const body = `<!doctype html><html><head><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>Local Admin Locale Review</title></head><body>${renderToStaticMarkup(<LocaleReviewPanel rows={rows} artifactId="artifact-p2l-reviewed-001" sourceHash={rows[0]?.sourceHash ?? ''} />)}</body></html>`
const server = createServer((request, response) => {
  if (request.url !== '/admin/locale-review') { response.writeHead(404); response.end('not found'); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet' }); response.end(body)
})
server.listen(3000, '127.0.0.1')
