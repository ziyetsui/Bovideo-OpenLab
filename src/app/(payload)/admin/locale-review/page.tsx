import { LocaleReviewPanel, type LocaleReviewPanelRow } from '@/components/LocaleReviewPanel'
import { LOCAL_DETAIL_PAGES } from '@/detail/local-fixture'

const rows: readonly LocaleReviewPanelRow[] = Object.freeze(LOCAL_DETAIL_PAGES.map((page) => ({
  locale: page.locale, workflowState: 'approved' as const, sourceHash: page.sourceHash, qa: 'pass' as const,
  protectedSpans: 'pass' as const, reviewer: 'reviewer-p2l-001', revision: 2,
  reviewedAt: '2026-08-24T12:00:00.000Z', decision: 'approved' as const, reason: 'local fixture review',
})))

export default function LocaleReviewAdminPage() {
  return <LocaleReviewPanel rows={rows} artifactId="artifact-p2l-reviewed-001" sourceHash={rows[0]?.sourceHash ?? ''} />
}
