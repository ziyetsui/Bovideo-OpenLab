'use client'

import type { ApplicationLocale } from '@/contracts/locale'

export type LocaleReviewPanelRow = Readonly<{
  locale: ApplicationLocale
  workflowState: 'review' | 'approved' | 'blocked' | 'stale' | 'withdrawn'
  sourceHash: string
  qa: 'pass' | 'fail'
  protectedSpans: 'pass' | 'fail'
  reviewer: string | null
  revision: number
  reviewedAt: string | null
  decision: 'approved' | 'rejected' | null
  reason: string | null
}>

export type LocaleReviewPanelProps = Readonly<{
  rows: readonly LocaleReviewPanelRow[]
  artifactId: string
  sourceHash: string
}>

/**
 * Read-only local evidence panel. Mutation remains behind the injected review
 * command service; this component intentionally never renders source text,
 * translations, raw evidence, headers, secrets or filesystem paths.
 */
export const LocaleReviewPanel = ({ rows, artifactId, sourceHash }: LocaleReviewPanelProps) => {
  const reviewed = rows.filter((row) => row.decision !== null && row.reviewer !== null).length
  return (
    <section data-testid="locale-review-panel" aria-labelledby="locale-review-heading">
      <h2 id="locale-review-heading">Locale review evidence</h2>
      <p data-testid="locale-review-artifact">Artifact: {artifactId}</p>
      <p data-testid="locale-review-source-hash">Source hash: {sourceHash}</p>
      <p data-testid="locale-review-coverage">Explicit review coverage: {reviewed}/{rows.length}</p>
      <table>
        <caption>Exact locale QA and human review status</caption>
        <thead><tr><th>Locale</th><th>State</th><th>QA</th><th>Protected spans</th><th>Reviewer</th><th>Revision</th><th>UTC</th><th>Decision</th><th>Reason</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.locale} data-testid={`locale-review-row-${row.locale}`}>
              <td>{row.locale}</td>
              <td>{row.workflowState}</td>
              <td>{row.qa}</td>
              <td>{row.protectedSpans}</td>
              <td>{row.reviewer ?? '—'}</td>
              <td>{row.revision}</td>
              <td>{row.reviewedAt ?? '—'}</td>
              <td>{row.decision ?? 'pending'}</td>
              <td>{row.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export default LocaleReviewPanel

