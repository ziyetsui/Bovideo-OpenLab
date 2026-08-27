import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LOCAL_DETAIL_PAGES } from '@/detail/local-fixture'
import { toDetailPageEnvelope } from '@/detail/page-envelope'
import { DetailPageView } from '@/detail/render'
import { DETAIL_QUESTION_ORDER, type DetailPageData } from '@/detail/schema'
import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import { pageEnvelopeSchema } from '@/page/schema'

describe('P3-T06 production detail contract', () => {
  it('renders the ten-question detail inside the shared shell with visible provenance', () => {
    const page = LOCAL_DETAIL_PAGES[0]!
    const envelope = toDetailPageEnvelope(page)
    const html = renderToStaticMarkup(<DetailPageView page={page} shellPage={envelope} />)
    expect(pageEnvelopeSchema.safeParse(envelope).success).toBe(true)
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1)
    expect((html.match(/<h2\b/g) ?? []).length).toBe(10)
    expect(html).toContain('data-action="copy-prompt"')
    expect(html).toContain('data-provenance')
    expect(html).toContain('data-generated-filler-count="0"')
    const positions = DETAIL_QUESTION_ORDER.map((id) => html.indexOf(`id="question-${id}"`))
    expect(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]!))).toBe(true)
    const prompt = page.questions.find((question) => question.id === 'prompt')!
    expect(html).toContain(prompt.content.originalText)
    expect((html.match(/data-ui="detail-module"/g) ?? []).length).toBe(10)
    expect(html).not.toContain('data-action="run-prompt"')
  })

  it('keeps candidate and unavailable provenance visible and never enables a missing action', () => {
    const page = LOCAL_DETAIL_PAGES[0]!
    const candidate = { ...page, questions: page.questions.map((question) => question.id === 'variations' ? { ...question, state: 'stale' as const, provenance: 'candidate' as const } : question) } as DetailPageData
    const envelope = toDetailPageEnvelope(candidate)
    const html = renderToStaticMarkup(<DetailPageView page={candidate} shellPage={envelope} />)
    expect(html).toContain('Candidate evidence; not indexable')
    expect(html).toContain('data-module-state="stale"')
  })

  it.each(['partial', 'stale'] as const)('keeps %s fixture states visible without filler', (state) => {
    const envelope = P3_GOLDEN_FIXTURES.detail[state]
    if (envelope.page_type !== 'detail') throw new Error('detail fixture expected')
    const html = renderToStaticMarkup(<DetailPageView page={envelope.detail} shellPage={envelope} />)

    expect(html).toContain('data-generated-filler-count="0"')
    expect(html).toContain(`data-module-state="${state === 'partial' ? 'unavailable' : 'stale'}"`)
    expect(html).not.toContain('data-action="run-prompt"')
  })
})
