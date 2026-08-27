import { Fragment, type ReactNode } from 'react'

import { CopyPromptButton } from '../components/controls'
import type { FrontendDetailModel } from '../projection/types'
import { provenanceLabel } from '@/detail/provenance'
import type { DetailQuestion } from '@/detail/schema'

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

type DetailQuestionState = Pick<FrontendDetailModel['detail']['questions'][number], 'state' | 'provenance'>

const stateLabel = (question: DetailQuestionState): string => question.state === 'unavailable'
  ? 'Not available from approved evidence'
  : question.state === 'stale'
    ? 'Stale candidate; requires current review'
    : provenanceLabel(question.provenance)

const QuestionContent = ({ question }: Readonly<{ question: FrontendDetailModel['detail']['questions'][number] }>): ReactNode => {
  if (question.state === 'unavailable' || question.state === 'stale')
    return <p role="status">{stateLabel(question)}</p>

  switch (question.id) {
    case 'identity':
      return <div className="detail-identity"><strong>{question.content.label}</strong><span>{question.content.artifactKind}</span></div>
    case 'outcome':
      return <div className="detail-outcome"><p>{question.content.summary}</p><strong>{question.content.medium}</strong></div>
    case 'prompt': {
      // Every prompt representation below deliberately references this unmodified value.
      const originalText = question.content.originalText
      return <div className="prompt-panel">
        <p className="poster-eyebrow">Original / {question.content.originalLanguage}</p>
        <pre className="prompt-copy" data-copy-default="original" data-original-prompt={originalText} data-copy-template={originalText}>{originalText}</pre>
        <CopyPromptButton text={originalText} />
        <p role="status">No approved variable definitions were supplied; copying preserves the original prompt.</p>
      </div>
    }
    case 'inputs':
      return <div className="detail-columns"><section><h3>Required</h3><ul>{question.content.required.map((item) => <li key={item}>{item}</li>)}</ul></section><section><h3>Optional</h3><ul>{question.content.optional.map((item) => <li key={item}>{item}</li>)}</ul></section></div>
    case 'parameters':
      return <dl className="parameter-grid">{question.content.items.map((item) => <div key={item.name}><dt>{item.name}</dt><dd>{item.value}</dd></div>)}</dl>
    case 'examples':
      return question.content.mediaRefs.length === 0
        ? <p role="status">No approved examples are available.</p>
        : <ul className="reference-list">{question.content.mediaRefs.map((ref) => <li key={ref}>{ref}</li>)}</ul>
    case 'workflow':
      return <ol className="workflow-list">{question.content.steps.map((step, index) => <li key={`${step.action}-${step.text}`}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.action}</strong><p>{step.text}</p><small>{step.assertion}</small></div></li>)}</ol>
    case 'variations':
      return <ul className="reference-list">{question.content.artifactRefs.map((ref) => <li key={ref}><span data-candidate="true">{ref} ({provenanceLabel(question.provenance)})</span></li>)}</ul>
    case 'source_signals':
      return <div className="source-signals"><p>Source evidence</p><a href={question.content.sourceUrl} data-source-url={question.content.sourceUrl}>{question.content.sourceUrl}</a><dl>{[
        ['Observed', question.content.observedAt],
        ['Likes', question.content.likes ?? 'unavailable'],
        ['Bookmarks', question.content.bookmarks ?? 'unavailable'],
        ['Views', question.content.views ?? 'unavailable'],
      ].map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl></div>
    case 'actions':
      return <div className="detail-actions"><p>{question.content.copyPrompt ? 'The original-prompt copy control is available above.' : 'Copy is unavailable.'}</p><p role="status">No approved product action URL is available.</p></div>
  }
}

export const DetailPage = ({ model }: Readonly<{ model: FrontendDetailModel }>) => <article className="page-frame detail-page" data-generated-filler-count={model.detail.generatedFillerCount}>
  {model.detail.questions.map((question, index) => <section className="page-section detail-module" key={question.id} id={`question-${question.id}`} data-ui="detail-module" data-module-state={question.state} data-provenance={question.provenance} aria-labelledby={`heading-${question.id}`}>
    <h2 id={`heading-${question.id}`}>{String(index + 1).padStart(2, '0')} / {moduleTitle[question.id]}</h2>
    <p className="detail-module__provenance" aria-label={`Provenance: ${provenanceLabel(question.provenance)}`}>{stateLabel(question)}</p>
    <QuestionContent question={question} />
  </section>)}
</article>
