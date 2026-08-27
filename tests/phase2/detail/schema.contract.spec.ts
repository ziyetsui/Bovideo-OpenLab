import { describe, expect, it } from 'vitest'

import { APPLICATION_LOCALES } from '@/contracts/locale'
import {
  DETAIL_QUESTION_ORDER,
  detailPageDataSchema,
  detailRouteSchema,
  type DetailPageData,
} from '@/detail/schema'
import { completeDetailFixture } from '../fixtures/detail/complete'
import { partialDetailFixture } from '../fixtures/detail/partial'
import { staleDetailFixture } from '../fixtures/detail/stale'
import { buildDetailPage, projectDetailRoute } from '@/detail/projector'

describe('P2-L T04 strict detail schema', () => {
  it('keeps the fixed ten-question tuple and the exact 16-locale route matrix', () => {
    expect(DETAIL_QUESTION_ORDER).toEqual([
      'identity', 'outcome', 'prompt', 'inputs', 'parameters',
      'examples', 'workflow', 'variations', 'source_signals', 'actions',
    ])
    expect(completeDetailFixture.pages).toHaveLength(APPLICATION_LOCALES.length)
    expect(completeDetailFixture.pages.map((page) => page.locale)).toEqual([...APPLICATION_LOCALES])
    expect(completeDetailFixture.pages.every((page) => detailPageDataSchema.safeParse(page).success)).toBe(true)
    expect(completeDetailFixture.pages.every((page) => page.questions.map((question) => question.id).join(',') === DETAIL_QUESTION_ORDER.join(','))).toBe(true)
  })

  it('requires honest present/unavailable/stale states and distinguishes provenance', () => {
    const partial = partialDetailFixture.pages[0]!
    const stale = staleDetailFixture.pages[0]!
    expect(partial.questions.some((question) => question.state === 'unavailable' && question.provenance === 'unavailable')).toBe(true)
    expect(stale.questions.some((question) => question.state === 'stale' && question.provenance === 'candidate')).toBe(true)
    expect(() => detailPageDataSchema.parse({ ...partial, questions: partial.questions.slice(0, 9) })).toThrow()
    expect(() => detailPageDataSchema.parse({ ...partial, questions: partial.questions.map((question) => ({ ...question, content: '<script>alert(1)</script>' })) })).toThrow()
  })

  it('rejects reordered questions, duplicate ids, filler content and fallback locales', () => {
    const page = completeDetailFixture.pages[0]!
    const reordered = [...page.questions].reverse()
    expect(() => detailPageDataSchema.parse({ ...page, questions: reordered })).toThrow(/question|order/i)
    expect(() => detailPageDataSchema.parse({ ...page, questions: [page.questions[0], ...page.questions] })).toThrow()
    expect(() => buildDetailPage(completeDetailFixture.input, completeDetailFixture.approvedLocaleBatch, { locale: 'zh' as never })).toThrow(/locale|Invalid option/i)
    expect(() => detailRouteSchema.parse({ ...completeDetailFixture.route, path: '/en/prompts/not-the-route' })).toThrow()
  })

  it('preserves immutable original prompt bytes and rejects copied prompt drift', () => {
    const page = completeDetailFixture.pages[0]!
    expect(page.questions[2]?.id).toBe('prompt')
    expect(page.questions[2]?.content.originalText).toBe(completeDetailFixture.input.originalText)
    expect(() => projectDetailRoute(completeDetailFixture.input, completeDetailFixture.approvedLocaleBatch, { locale: page.locale, originalTextOverride: `${completeDetailFixture.input.originalText} ` })).toThrow(/byte|original|immutable/i)
  })

  it('does not count generated filler and keeps pages read-only', () => {
    const page = completeDetailFixture.pages[0] as DetailPageData
    expect(page.generatedFillerCount).toBe(0)
    expect(Object.isFrozen(page)).toBe(true)
    expect(Object.isFrozen(page.questions)).toBe(true)
  })

  it('rejects non-web source URL schemes before rendering links', () => {
    const page = completeDetailFixture.pages[0]!
    const questions = page.questions.map((question) => question.id === 'source_signals'
      ? { ...question, content: { ...question.content, sourceUrl: 'javascript:alert(1)' } }
      : question)

    expect(() => detailPageDataSchema.parse({ ...page, questions })).toThrow(/url|http/i)
  })
})
