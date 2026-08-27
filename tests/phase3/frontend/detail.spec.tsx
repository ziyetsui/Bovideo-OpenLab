import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DetailPage } from '../../../frontend/pages/detail-page'
import { adaptDetailPage } from '../../../frontend/projection/adapt'
import { FrontendSiteShell } from '../../../frontend/components/site-shell'
import FrontendLayout from '../../../src/app/(frontend)/layout'
import { P3_GOLDEN_FIXTURES } from '@/page/fixtures'
import type { DetailPage as DetailEnvelope } from '@/page/schema'
import { DETAIL_QUESTION_ORDER } from '@/detail/schema'

const source = P3_GOLDEN_FIXTURES.detail.complete
if (source.page_type !== 'detail') throw new Error('detail fixture expected')

const detailWithCountryVariable = adaptDetailPage({
  ...source,
  detail: {
    ...source.detail,
    questions: source.detail.questions.map((question) => question.id === 'prompt'
      ? { ...question, content: { ...question.content, originalText: 'Use [COUNTRY] at dusk.' } }
      : question),
  },
} as DetailEnvelope)

const expectInOrder = (html: string, values: readonly string[]) => {
  const positions = values.map((value) => html.indexOf(value))
  expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]!))).toBe(true)
}

describe('pSEO frontend Detail page', () => {
  it('preserves original prompt bytes as the default copy target', () => {
    const html = renderToStaticMarkup(<DetailPage model={detailWithCountryVariable} />)

    expect(html).toContain('data-original-prompt="Use [COUNTRY] at dusk."')
    expect(html).toContain('data-copy-template="Use [COUNTRY] at dusk."')
    expect(html).toContain('<pre class="prompt-copy"')
    expect(html).toContain('Use [COUNTRY] at dusk.</pre>')
  })

  it('keeps the ten evidence modules ordered, textual, and non-navigable for candidate variations', () => {
    const html = renderToStaticMarkup(<DetailPage model={detailWithCountryVariable} />)

    expectInOrder(html, DETAIL_QUESTION_ORDER.map((id) => `id="question-${id}"`))
    expect((html.match(/data-ui="detail-module"/g) ?? []).length).toBe(10)
    expect(html).toContain('data-module-state="present"')
    expect(html).toContain('data-provenance="explicit"')
    expect(html).toContain('data-candidate="true"')
    expect(html).not.toMatch(/<a[^>]+data-candidate/)
  })

  it('localizes input requirement labels on non-English detail routes', () => {
    const html = renderToStaticMarkup(<DetailPage model={{ ...detailWithCountryVariable, locale: 'zh-CN' }} />)

    expect(html).toContain('<h3>必填</h3>')
    expect(html).toContain('<h3>可选</h3>')
    expect(html).not.toContain('<h3>Required</h3>')
    expect(html).not.toContain('<h3>Optional</h3>')
  })

  it('leaves one H1 and one main when composed inside the frontend shell', async () => {
    const content = <FrontendSiteShell
      page={source}
      navigation={{ version: 'v1', items: [] }}
    ><h1>{detailWithCountryVariable.h1 ?? detailWithCountryVariable.title}</h1><DetailPage model={detailWithCountryVariable} /></FrontendSiteShell>
    const html = renderToStaticMarkup(await FrontendLayout({ children: content }))

    expect((html.match(/<main\b/g) ?? []).length).toBe(1)
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1)
  })
})
