import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { PREVIEW_COPY } from '../fixtures/copy'
import { PREVIEW_ROUTES } from '../fixtures/routes'
import {
  APPLICATION_LOCALES,
  type ApplicationLocale,
  type PageFamily,
  type PreviewRoute,
} from '../src/contracts'
import { renderRoute } from '../src/render'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string) => { window: { document: Document } }
}

const firstRoute = (family: PageFamily): PreviewRoute =>
  PREVIEW_ROUTES.find((route) => route.family === family)!

const documentFor = (route: PreviewRoute, locale: ApplicationLocale = APPLICATION_LOCALES[0]!): Document =>
  new JSDOM(renderRoute({ route, locale, cohort: PREVIEW_ROUTES, copy: PREVIEW_COPY })).window.document

describe('Preview Beta route renderer', () => {
  it('renders a unique localized H1 for every route in the normative matrix', () => {
    const headings = APPLICATION_LOCALES.flatMap((locale) =>
      PREVIEW_ROUTES.map((route) => {
        const document = documentFor(route, locale)
        expect(document.documentElement.lang).toBe(locale)
        expect(document.querySelectorAll('main h1')).toHaveLength(1)
        return document.querySelector('main h1')!.textContent
      }),
    )

    expect(headings).toHaveLength(480)
    expect(new Set(headings).size).toBe(480)
    expect(headings[0]).toContain('Preview')
    expect(headings[479]).toContain('Bản xem trước')
  })

  it('uses closed human-language copy instead of English text plus a locale suffix', () => {
    for (const locale of APPLICATION_LOCALES.filter((candidate) => candidate !== 'en')) {
      expect(PREVIEW_COPY[locale]).toBeDefined()
      for (const route of PREVIEW_ROUTES) {
        expect(PREVIEW_COPY[locale].routes[route.routeId].title).not.toBe(PREVIEW_COPY.en.routes[route.routeId].title)
        expect(PREVIEW_COPY[locale].routes[route.routeId].title).not.toBe(
          `${PREVIEW_COPY.en.routes[route.routeId].title} — ${locale}`,
        )
        expect(PREVIEW_COPY[locale].routes[route.routeId].summary).not.toBe(PREVIEW_COPY.en.routes[route.routeId].summary)
      }
      const localized = documentFor(firstRoute('gallery'), locale)
      expect(localized.querySelector('main h1')?.textContent).toBe(PREVIEW_COPY[locale].routes['gallery-image'].title)
      expect(localized.querySelector('.hero > p:last-child')?.textContent).toBe(PREVIEW_COPY[locale].routes['gallery-image'].summary)
      expect(localized.querySelector('.site-header')?.textContent).not.toBe(
        documentFor(firstRoute('gallery'), 'en').querySelector('.site-header')?.textContent,
      )
    }
  })

  it('renders localized noindex disclosure and 16 internal locale links', () => {
    const document = documentFor(firstRoute('gallery'), 'zh-CN')

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,nofollow,noarchive,nosnippet',
    )
    expect(document.body.textContent).toContain('预览版')
    expect(document.body.textContent).toContain('合成内容')
    expect(document.body.textContent).toContain('来源：合成')

    const localeLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[data-locale-link]')]
    expect(localeLinks).toHaveLength(16)
    expect(localeLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/en/prompts/image',
      '/zh-CN/prompts/image',
      '/zh-TW/prompts/image',
      '/ja-JP/prompts/image',
      '/ko-KR/prompts/image',
      '/de-DE/prompts/image',
      '/fr-FR/prompts/image',
      '/it-IT/prompts/image',
      '/es-ES/prompts/image',
      '/es-419/prompts/image',
      '/pt-BR/prompts/image',
      '/pt-PT/prompts/image',
      '/hi-IN/prompts/image',
      '/th-TH/prompts/image',
      '/tr-TR/prompts/image',
      '/vi-VN/prompts/image',
    ])
    expect(localeLinks.every((link) => link.getAttribute('href')!.startsWith('/'))).toBe(true)
    expect(localeLinks.map((link) => link.textContent)).toContain('简体中文')
  })

  it('renders an accessible local mobile language-menu control and the exact public repository URL', () => {
    const document = documentFor(firstRoute('detail'), 'ja-JP')
    const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]')
    const navigation = document.querySelector<HTMLElement>('[data-site-navigation]')

    expect(toggle?.getAttribute('aria-controls')).toBe('preview-navigation')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.textContent).toContain('言語')
    expect(navigation?.id).toBe('preview-navigation')
    expect(document.querySelector('script[src="/assets/menu.js"]')).not.toBeNull()
    expect(document.querySelector<HTMLAnchorElement>('footer a')?.href).toBe(
      'https://github.com/ziyetsui/Bovideo-OpenLab',
    )
  })

  it('omits production SEO and external font markup from the real HTML shell', () => {
    const html = renderRoute({
      route: firstRoute('hub'),
      locale: 'en',
      cohort: PREVIEW_ROUTES,
      copy: PREVIEW_COPY,
    })
    const document = new JSDOM(html).window.document

    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.querySelector('link[hreflang]')).toBeNull()
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull()
    expect(document.querySelectorAll('link[href*="fonts"]')).toHaveLength(0)
    expect(document.querySelectorAll('script[src^="http"]')).toHaveLength(0)
    expect(html.toLowerCase()).not.toContain('sitemap')
  })

  it.each([
    ['hub', ['[data-section="directory"]', '[data-section="featured-collections"]']],
    ['gallery', ['[data-section="filter-disclosure"]', '[data-section="gallery-cards"]', '[data-section="guide"]']],
    ['entity', ['[data-section="entity-overview"]', '[data-section="prompt-list"]', '[data-section="comparison"]']],
    [
      'detail',
      [
        '[data-section="prompt"]',
        '[data-section="variables"]',
        '[data-section="workflow"]',
        '[data-section="use-cases"]',
        '[data-section="faq"]',
        '[data-section="provenance"]',
      ],
    ],
  ] as const)('renders required %s sections and an honest unavailable module', (family, selectors) => {
    const document = documentFor(firstRoute(family))

    for (const selector of selectors) {
      expect(document.querySelector(selector)).not.toBeNull()
    }
    expect(document.querySelector('[data-module-state="unavailable"]')?.textContent).toMatch(/unavailable/i)
  })
})
