import { afterEach, describe, expect, it } from 'vitest'

import { buildInternalNoindexProjections } from '@/page/local-internal-projector'
import { localizeBoundProjection } from '../../../frontend/localization/localize-bound-projection'
import { injectFrontendPreviewProjectionReader } from '../../../frontend/routes/preview-projection-reader'
import { resolveFrontendRoute } from '../../../frontend/routes/resolve-active-projection'
import { APPLICATION_LOCALES } from '@/contracts/locale'
import { FRONTEND_CHROME_KEYS } from '../../../frontend/localization/chrome'
import { messagesFor } from '../../../frontend/localization/messages'

const HASH = `sha256:v1:${'b'.repeat(64)}`

describe('bound projection locale overlay', () => {
  const source = buildInternalNoindexProjections({
    locale: 'en', publishVersion: 1, artifacts: [{
      id: '00000000-0000-4000-8000-000000000101',
      sourceID: '00000000-0000-4000-8000-000000000201',
      sourceVersion: HASH,
      title: 'Original prompt title', text: 'Keep these original English prompt bytes.',
      originalLanguage: 'en', mediaType: 'image', media: [],
      observedAt: '2026-08-26T00:00:00.000Z',
    }],
  }).find((projection) => projection.family === 'hub')!

  afterEach(() => {
    process.env.PSEO_FRONTEND_PREVIEW = '1'
    injectFrontendPreviewProjectionReader(undefined)
    delete process.env.PSEO_FRONTEND_PREVIEW
  })

  it('supplies a complete localized chrome dictionary for all 16 locales', () => {
    const english = messagesFor('en')
    for (const locale of APPLICATION_LOCALES) {
      const messages = messagesFor(locale)
      expect(Object.keys(messages.chrome)).toEqual([...FRONTEND_CHROME_KEYS])
      expect(Object.values(messages.chrome).every((value) => value.trim().length > 0)).toBe(true)
      if (locale !== 'en') expect(messages.chrome.searchPrompts).not.toBe(english.chrome.searchPrompts)
    }
  })

  it('rewrites bound internal routes and localizes chrome without changing prompt bytes', () => {
    const localized = localizeBoundProjection(source, 'zh-CN')
    const firstCard = localized.slots.find((slot) => slot.slot_key === 'featured')?.items[0]

    expect(localized.locale).toBe('zh-CN')
    expect(localized.page.route).toBe('/zh-CN/prompts')
    expect(localized.page.h1).toContain('提示词')
    expect(localized.page.translation_state).toBe('source_fallback')
    expect(firstCard).toMatchObject({ prompt_text: 'Keep these original English prompt bytes.' })
    expect(firstCard && 'href' in firstCard ? firstCard.href : null).toMatch(/^\/zh-CN\/prompts\//)
  })

  it.each(['en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN'] as const)(
    'produces a valid %s route overlay', (locale) => {
      const localized = localizeBoundProjection(source, locale)
      expect(localized.page.route).toBe(`/${locale}/prompts`)
      expect(localized.page.locale).toBe(locale)
    },
  )

  it('resolves a requested locale from the exact active English binding when no localized binding exists', async () => {
    process.env.PSEO_FRONTEND_PREVIEW = '1'
    injectFrontendPreviewProjectionReader({
      readBoundProjection: async (request) => request.locale === 'en' && request.route === '/en/prompts'
        ? { publishVersion: 1, projectionId: source.projection_id, projection: source }
        : undefined,
    })

    await expect(resolveFrontendRoute({ family: 'hub', locale: 'zh-CN', route: '/zh-CN/prompts' })).resolves.toMatchObject({
      locale: 'zh-CN', page: { locale: 'zh-CN', route: '/zh-CN/prompts', translation_state: 'source_fallback' },
    })
  })

  it('does not let an unreviewed exact-locale source projection override the English release overlay', async () => {
    const unreviewedExact = buildInternalNoindexProjections({
      locale: 'zh-CN', publishVersion: 2, artifacts: [{
        id: '00000000-0000-4000-8000-000000000102',
        sourceID: '00000000-0000-4000-8000-000000000202',
        sourceVersion: HASH,
        title: 'Unreviewed exact source', text: 'Unreviewed bytes.', originalLanguage: 'en', mediaType: 'image', media: [],
        observedAt: '2026-08-26T00:00:00.000Z',
      }],
    }).find((projection) => projection.family === 'hub')!
    process.env.PSEO_FRONTEND_PREVIEW = '1'
    injectFrontendPreviewProjectionReader({
      readBoundProjection: async (request) => request.locale === 'zh-CN'
        ? { publishVersion: 2, projectionId: unreviewedExact.projection_id, projection: unreviewedExact }
        : { publishVersion: 1, projectionId: source.projection_id, projection: source },
    })

    await expect(resolveFrontendRoute({ family: 'hub', locale: 'zh-CN', route: '/zh-CN/prompts' })).resolves.toMatchObject({
      projection_id: expect.not.stringMatching(unreviewedExact.projection_id),
      page: { translation_state: 'source_fallback' },
    })
  })
})
