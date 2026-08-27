import type { DetailPageData, DetailQuestion } from './schema'
import { DETAIL_ROBOTS } from './schema'
import { provenanceLabel } from './provenance'
import { DetailComposer } from './detail-composer'
import { PageShell } from '@/page/shell'
import type { DetailPage } from '@/page/schema'

export type DetailDocument = Readonly<{
  html: string
  headers: Readonly<Record<string, string>>
}>

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const stateLabel = (question: DetailQuestion): string => question.state === 'unavailable'
  ? 'Not available from approved evidence'
  : question.state === 'stale'
    ? 'Stale candidate; requires current review'
    : provenanceLabel(question.provenance)

const renderContent = (question: DetailQuestion): string => {
  if (question.state === 'unavailable') return '<p role="status">Not available from approved evidence</p>'
  if (question.state === 'stale') return `<p role="status">${escapeHtml(stateLabel(question))}</p>`
  switch (question.id) {
    case 'identity': return `<p>${escapeHtml(question.content.label)} · ${escapeHtml(question.content.artifactKind)}</p>`
    case 'outcome': return `<p>${escapeHtml(question.content.summary)} (${escapeHtml(question.content.medium)})</p>`
    case 'prompt': return `<pre class="prompt-copy" data-copy-default="original">${escapeHtml(question.content.originalText)}</pre><button type="button" data-action="copy-prompt">Copy prompt</button>`
    case 'inputs': return `<dl>${question.content.required.map((item) => `<dt>Required</dt><dd>${escapeHtml(item)}</dd>`).join('')}${question.content.optional.map((item) => `<dt>Optional</dt><dd>${escapeHtml(item)}</dd>`).join('')}</dl>`
    case 'parameters': return `<ul>${question.content.items.map((item) => `<li><strong>${escapeHtml(item.name)}</strong>: ${escapeHtml(item.value)}</li>`).join('')}</ul>`
    case 'examples': return question.content.mediaRefs.length === 0 ? '<p>No approved examples.</p>' : `<ul>${question.content.mediaRefs.map((ref) => `<li>${escapeHtml(ref)}</li>`).join('')}</ul>`
    case 'workflow': return `<ol>${question.content.steps.map((step) => `<li><strong>${escapeHtml(step.action)}</strong>: ${escapeHtml(step.text)} — ${escapeHtml(step.assertion)}</li>`).join('')}</ol>`
    case 'variations': return `<ul>${question.content.artifactRefs.map((ref) => `<li><span data-candidate="true">${escapeHtml(ref)} (${escapeHtml(provenanceLabel(question.provenance))})</span></li>`).join('')}</ul>`
    case 'source_signals': return `<p>Source evidence: <span data-source-url="${escapeHtml(question.content.sourceUrl)}">${escapeHtml(question.content.sourceUrl)}</span>; observed ${escapeHtml(question.content.observedAt)}; likes ${question.content.likes ?? 'unavailable'}, bookmarks ${question.content.bookmarks ?? 'unavailable'}, views ${question.content.views ?? 'unavailable'}.</p>`
    case 'actions': return `<p>${question.content.copyPrompt ? 'Copy the original prompt' : 'Copy unavailable'}${question.content.productActionId === null ? '' : ` · ${escapeHtml(question.content.productActionId)}`}</p>`
  }
}

export const renderDetailHtml = (page: Pick<DetailPageData, 'locale' | 'title' | 'description' | 'robots' | 'questions' | 'generatedFillerCount'>): string => {
  const sections = page.questions.map((question) => `<section id="question-${question.id}" data-module-state="${question.state}" data-provenance="${question.provenance}" aria-labelledby="heading-${question.id}"><h2 id="heading-${question.id}">${escapeHtml(question.id.replaceAll('_', ' '))}</h2><p class="provenance" aria-label="Provenance: ${escapeHtml(provenanceLabel(question.provenance))}">${escapeHtml(stateLabel(question))}</p>${renderContent(question)}</section>`).join('')
  return `<!doctype html><html lang="${escapeHtml(page.locale)}"><head><meta charset="utf-8"><meta name="robots" content="${DETAIL_ROBOTS}"><meta name="description" content="${escapeHtml(page.description)}"><title>${escapeHtml(page.title)}</title></head><body><main data-generated-filler-count="${page.generatedFillerCount}"><p class="eyebrow">Local evidence detail · noindex</p><h1>${escapeHtml(page.title)}</h1>${sections}</main></body></html>`
}

export const renderDetailDocument = (page: DetailPageData): DetailDocument => ({
  html: renderDetailHtml(page),
  headers: Object.freeze({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
  }),
})

export const DetailPageView = ({ page, shellPage }: Readonly<{ page: DetailPageData; shellPage?: DetailPage }>) => shellPage
  ? <PageShell page={shellPage}><DetailComposer page={page} includeHeading={false} /></PageShell>
  : <main><DetailComposer page={page} /></main>
