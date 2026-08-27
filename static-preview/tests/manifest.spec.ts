import { describe, expect, it } from 'vitest'

import { APPLICATION_LOCALES, type PreviewRoute } from '../src/contracts'
import { outputPath, routePath } from '../src/paths'
import * as validation from '../src/validate'
import { PREVIEW_COPY } from '../fixtures/copy'
import { PREVIEW_ROUTES } from '../fixtures/routes'

const expectedLocales = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'de-DE',
  'fr-FR',
  'it-IT',
  'es-ES',
  'es-419',
  'pt-BR',
  'pt-PT',
  'hi-IN',
  'th-TH',
  'tr-TR',
  'vi-VN',
]

const replacement = (route: PreviewRoute, values: Partial<PreviewRoute>): PreviewRoute => ({
  ...route,
  ...values,
})

describe('Preview Beta route manifest', () => {
  it('defines the hand-counted cohort and normative locales', () => {
    validation.validateCohort(PREVIEW_ROUTES)

    expect(new Set(PREVIEW_ROUTES.map(({ routeId }) => routeId)).size).toBe(30)
    expect(
      PREVIEW_ROUTES.reduce<Record<string, number>>((counts, { family }) => {
        counts[family] = (counts[family] ?? 0) + 1
        return counts
      }, {}),
    ).toEqual({ hub: 1, gallery: 2, entity: 7, detail: 20 })
    expect(APPLICATION_LOCALES).toEqual(expectedLocales)
    expect(PREVIEW_ROUTES.find(({ routeId }) => routeId === 'detail-020')?.publicationState).toBe('approved')
  })

  it('maps every cohort route to one localized index.html output', () => {
    const outputs = new Set(
      APPLICATION_LOCALES.flatMap((locale) => PREVIEW_ROUTES.map((route) => outputPath(locale, route))),
    )

    expect(outputs.size).toBe(480)
    expect([...outputs].every((path) => path.endsWith('/index.html'))).toBe(true)
    expect(routePath('en', PREVIEW_ROUTES[0]!)).toBe('/en/prompts')
    expect(outputPath('zh-CN', PREVIEW_ROUTES[1]!)).toBe('/zh-CN/prompts/image/index.html')
    expect(outputPath('ja-JP', PREVIEW_ROUTES[3]!)).toBe('/ja-JP/prompts/models/model-01/index.html')
    expect(outputPath('vi-VN', PREVIEW_ROUTES[29]!)).toBe('/vi-VN/prompts/synthetic-prompt-020/index.html')
  })

  it('rejects a duplicate route ID', () => {
    const routes = [...PREVIEW_ROUTES]
    routes[1] = replacement(routes[1]!, { routeId: 'hub-prompts' })

    expect(() => validation.validateCohort(routes)).toThrow(/duplicate route ID/i)
  })

  it('rejects a duplicate route path', () => {
    const routes = [...PREVIEW_ROUTES]
    routes[2] = replacement(routes[2]!, { segments: routes[1]!.segments })

    expect(() => validation.validateCohort(routes)).toThrow(/duplicate route path/i)
  })

  it.each([29, 31])('rejects a cohort containing %i routes', (count) => {
    const routes =
      count === 29
        ? PREVIEW_ROUTES.slice(0, 29)
        : [...PREVIEW_ROUTES, replacement(PREVIEW_ROUTES[29]!, { routeId: 'detail-021' as unknown as PreviewRoute['routeId'] })]

    expect(() => validation.validateCohort(routes)).toThrow(/exactly 30 routes/i)
  })

  it('rejects provenance that does not prove the route is rights-safe', () => {
    const routes = [...PREVIEW_ROUTES]
    routes[3] = replacement(routes[3]!, {
      provenance: { kind: 'synthetic', rightsCode: 'first_party' },
    })

    expect(() => validation.validateCohort(routes)).toThrow(/unsafe provenance/i)
  })

  it('rejects a locale outside the normative application locale set', () => {
    expect(() => routePath('ru-RU', PREVIEW_ROUTES[0]!)).toThrow(/unknown locale/i)
  })

  it('rejects a route with a missing parent', () => {
    const routes = [...PREVIEW_ROUTES]
    routes[1] = replacement(routes[1]!, { parentRouteIds: ['missing-parent'] })

    expect(() => validation.validateCohort(routes)).toThrow(/missing parent/i)
  })

  it('exposes a fail-closed validator for the complete 16-locale copy matrix', () => {
    expect(validation).toHaveProperty('validatePreviewCopy')
    validation.validatePreviewCopy(PREVIEW_COPY)
    const invalid = {
      ...PREVIEW_COPY,
      'zh-CN': {
        ...PREVIEW_COPY['zh-CN'],
        routes: {
          ...PREVIEW_COPY['zh-CN'].routes,
          'detail-020': PREVIEW_COPY.en.routes['detail-020'],
        },
      },
    }
    expect(() => validation.validatePreviewCopy(invalid)).toThrow(/English title/i)
  })

  it('serializes localized count templates into the deterministic copy input', () => {
    expect(JSON.stringify(PREVIEW_COPY)).toContain('countTemplate')
  })
})
