import { Fragment, type ReactNode } from 'react'

import { EvidenceBadge, MethodNote, SectionHeading, UnavailablePanel } from '@/page/presentation/primitives'
import { PageAction } from '@/page/shell'

import { CopyPromptButton } from './copy-prompt-button'
import { provenanceLabel } from './provenance'
import type { DetailPageData, DetailQuestion } from './schema'

const moduleTitle: Readonly<Record<DetailQuestion['id'], string>> = {
  identity: 'Identity',
  outcome: 'Outcome',
  prompt: 'Prompt',
  inputs: 'Inputs',
  parameters: 'Parameters',
  examples: 'Examples',
  workflow: 'Workflow',
  variations: 'Variations',
  source_signals: 'Source + Signals',
  actions: 'Actions',
}

const stateLabel = (question: DetailQuestion): string => question.state === 'unavailable'
  ? 'Not available from approved evidence'
  : question.state === 'stale'
    ? 'Stale candidate; requires current review'
    : provenanceLabel(question.provenance)

const badgeTone = (question: DetailQuestion): 'candidate' | 'explicit' | 'inferred' | 'stale' | 'unavailable' => (
  question.state === 'stale' ? 'stale' : question.provenance
)

const QuestionContent = ({ question }: Readonly<{ question: DetailQuestion }>): ReactNode => {
  if (question.state === 'unavailable') return <UnavailablePanel title={moduleTitle[question.id]} reason={stateLabel(question)} />
  if (question.state === 'stale') return <UnavailablePanel title={moduleTitle[question.id]} reason={stateLabel(question)} state="stale" />

  switch (question.id) {
    case 'identity':
      return <div className="detail-identity"><strong>{question.content.label}</strong><span>{question.content.artifactKind}</span></div>
    case 'outcome':
      return <div className="detail-outcome"><p>{question.content.summary}</p><strong>{question.content.medium}</strong></div>
    case 'prompt': {
      const originalText = question.content.originalText
      return <div className="prompt-panel"><p className="poster-eyebrow">Original / {question.content.originalLanguage}</p><pre className="prompt-copy" data-copy-default="original" data-original-prompt={originalText} data-copy-template={originalText}>{originalText}</pre><CopyPromptButton text={originalText} /></div>
    }
    case 'inputs':
      return <div className="detail-columns"><section><h3>Required</h3><ul>{question.content.required.map((item) => <li key={item}>{item}</li>)}</ul></section><section><h3>Optional</h3><ul>{question.content.optional.map((item) => <li key={item}>{item}</li>)}</ul></section></div>
    case 'parameters':
      return <dl className="parameter-grid">{question.content.items.map((item) => <div key={item.name}><dt>{item.name}</dt><dd>{item.value}</dd></div>)}</dl>
    case 'examples':
      return question.content.mediaRefs.length === 0
        ? <UnavailablePanel title="Examples" reason="No approved examples are available." />
        : <ul className="reference-list">{question.content.mediaRefs.map((ref) => <li key={ref}><span aria-hidden="true">■</span>{ref}</li>)}</ul>
    case 'workflow':
      return <ol className="workflow-list">{question.content.steps.map((step, index) => <li key={`${step.action}-${step.text}`}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.action}</strong><p>{step.text}</p><small>{step.assertion}</small></div></li>)}</ol>
    case 'variations':
      return <ul className="reference-list">{question.content.artifactRefs.map((ref) => <li key={ref}><span aria-hidden="true">◆</span><span data-candidate="true">{ref} ({provenanceLabel(question.provenance)})</span></li>)}</ul>
    case 'source_signals':
      return <div className="source-signals"><p>Source evidence</p><a href={question.content.sourceUrl} data-source-url={question.content.sourceUrl}>{question.content.sourceUrl}</a><dl>{[
        ['Observed', question.content.observedAt],
        ['Likes', question.content.likes ?? 'unavailable'],
        ['Bookmarks', question.content.bookmarks ?? 'unavailable'],
        ['Views', question.content.views ?? 'unavailable'],
      ].map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl></div>
    case 'actions':
      return <div className="detail-actions"><p>{question.content.copyPrompt ? 'The original-prompt copy control is available above.' : 'Copy is unavailable.'}</p><PageAction enabled={false} label="Run prompt" unavailableReason="No approved product action URL is available in this preview." /></div>
  }
}

export const DetailComposer = ({ page, includeHeading = true }: Readonly<{ page: DetailPageData; includeHeading?: boolean }>) => <article className="page-frame detail-page" data-generated-filler-count={page.generatedFillerCount}>
  {includeHeading ? <h1>{page.title}</h1> : null}
  <MethodNote><p>The ten modules follow the evidence-question contract in a fixed order. The original prompt is never rewritten.</p></MethodNote>
  {page.questions.map((question, index) => <section className="page-section detail-module" key={question.id} id={`question-${question.id}`} data-ui="detail-module" data-module-state={question.state} data-provenance={question.provenance} aria-labelledby={`heading-${question.id}`}>
    <SectionHeading index={String(index + 1).padStart(2, '0')} title={moduleTitle[question.id]} id={`heading-${question.id}`} />
    <p className="detail-module__provenance" aria-label={`Provenance: ${provenanceLabel(question.provenance)}`}><EvidenceBadge label={stateLabel(question)} tone={badgeTone(question)} /></p>
    <QuestionContent question={question} />
  </section>)}
</article>
