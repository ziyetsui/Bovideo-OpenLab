import { request as httpRequest } from 'node:http'
import { mkdir } from 'node:fs/promises'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { PREVIEW_ROUTES } from '../../static-preview/fixtures/routes'
import { routePath } from '../../static-preview/src/paths'
import type { ApplicationLocale, PageFamily, PreviewRoute } from '../../static-preview/src/contracts'

const STATIC_BASE_URL = 'http://127.0.0.1:4173'
const EVIDENCE_DIRECTORY = '.superpowers/sdd/0010-bo-pseo-platform-implementation/evidence/static-preview'

const nonLatinLocaleByFamily: Readonly<Record<PageFamily, ApplicationLocale>> = {
  hub: 'zh-CN',
  gallery: 'ja-JP',
  entity: 'ko-KR',
  detail: 'hi-IN',
}

const routeByFamily: Readonly<Record<PageFamily, PreviewRoute>> = {
  hub: PREVIEW_ROUTES.find((route) => route.family === 'hub')!,
  gallery: PREVIEW_ROUTES.find((route) => route.family === 'gallery')!,
  entity: PREVIEW_ROUTES.find((route) => route.family === 'entity')!,
  detail: PREVIEW_ROUTES.find((route) => route.family === 'detail')!,
}

test.use({ baseURL: STATIC_BASE_URL })
test.setTimeout(120_000)

function internalTargets(html: string): readonly string[] {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((value) => value.startsWith('/') && !value.startsWith('//'))
    .map((value) => new URL(value, STATIC_BASE_URL).pathname)
}

async function rawStaticRequest(path: string): Promise<Readonly<{ body: string; status: number }>> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({ host: '127.0.0.1', method: 'GET', path, port: 4173 }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.once('end', () => resolveRequest({ body: Buffer.concat(chunks).toString('utf8'), status: response.statusCode ?? 0 }))
    })
    request.once('error', rejectRequest)
    request.end()
  })
}

test.describe('static Preview Beta local acceptance', () => {
  test('renders every family responsively without serious or critical Axe violations', async ({ page }) => {
    await mkdir(EVIDENCE_DIRECTORY, { recursive: true })

    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ] as const) {
      await page.setViewportSize(viewport)
      for (const family of ['hub', 'gallery', 'entity', 'detail'] as const) {
        for (const locale of ['en', nonLatinLocaleByFamily[family]] as const) {
          const response = await page.goto(routePath(locale, routeByFamily[family]))

          expect(response?.status(), `${family}/${locale} must be served`).toBe(200)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
          await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow,noarchive,nosnippet')
          const results = await new AxeBuilder({ page }).analyze()
          const seriousOrCritical = results.violations.filter(
            (violation) => violation.impact === 'serious' || violation.impact === 'critical',
          )
          expect(seriousOrCritical, `${family}/${locale} ${viewport.name} Axe findings`).toEqual([])
          await page.screenshot({ path: `${EVIDENCE_DIRECTORY}/${family}-${locale}-${viewport.name}.png`, fullPage: true })
        }
      }
    }
  })

  test('serves every manifest page and its internal links and assets with noindex metadata', async ({ page }) => {
    const manifestResponse = await page.request.get('/preview-manifest.json')
    expect(manifestResponse.status()).toBe(200)
    const manifest = (await manifestResponse.json()) as Readonly<{ routeFiles: readonly string[] }>
    expect(manifest.routeFiles).toHaveLength(480)
    expect((await page.request.get('/assets/outfit-latin-wght-normal.woff2')).headers()['content-type']).toBe('font/woff2')

    const targets = new Set<string>([
      '/assets/styles.css',
      '/assets/outfit-latin-wght-normal.woff2',
      '/assets/OUTFIT-OFL-1.1.txt',
    ])
    for (const file of manifest.routeFiles) {
      const route = `/${file.replace(/\/index\.html$/, '')}`
      const response = await page.request.get(route)
      expect(response.status(), `${route} must be served`).toBe(200)
      const html = await response.text()
      expect(html).toMatch(/<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/)
      for (const target of internalTargets(html)) targets.add(target)
    }

    for (const target of targets) {
      expect((await page.request.get(target)).status(), `${target} must not be a dead internal target`).toBe(200)
    }
  })

  test('returns true static 404 responses for non-public endpoints and unknown routes', async ({ page }) => {
    for (const path of ['/admin', '/api/prompt-artifacts', '/graphql', '/not-a-preview-route']) {
      const response = await page.request.get(path)
      expect(response.status(), `${path} must not receive a static fallback`).toBe(404)
      expect(await response.text()).toContain('Preview unavailable')
    }
  })

  test('returns a static 404 for a raw percent-encoded traversal request', async () => {
    const response = await rawStaticRequest('/..%2f..%2fREADME.md')

    expect(response.status).toBe(404)
    expect(response.body).toContain('Preview unavailable')
  })

  test('keeps the mobile header within bounds and exposes the language menu to keyboard users', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(routePath('ja-JP', routeByFamily.detail))

    expect(await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Outfit')
    expect(
      await page.evaluate(async () => {
        await document.fonts.load('400 16px Outfit')
        return [400, 500, 700, 900].every((weight) => document.fonts.check(`${weight} 16px Outfit`))
      }),
    ).toBe(true)

    await expect(page.locator('[data-menu-toggle]')).toBeVisible()
    await expect(page.locator('[data-site-navigation]')).not.toBeVisible()
    expect(await page.locator('.site-header').evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(180)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    const toggle = page.locator('[data-menu-toggle]')
    await toggle.focus()
    expect(await toggle.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('4px')
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-site-navigation] [data-locale-link]')).toHaveCount(16)
    await expect(page.locator('[data-site-navigation]')).toBeVisible()
    expect(await page.locator('.site-header').evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(560)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect(page.locator('[data-site-navigation] [data-locale-link]').first()).toBeFocused()
    expect(
      await page.locator('[data-site-navigation] [data-locale-link]').first().evaluate((element) => getComputedStyle(element).outlineWidth),
    ).toBe('4px')
    await page.screenshot({ path: `${EVIDENCE_DIRECTORY}/detail-ja-JP-mobile-menu-open.png`, fullPage: false })

    await page.keyboard.press('Escape')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()
    await expect(page.locator('[data-site-navigation]')).not.toBeVisible()

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(toggle).not.toBeVisible()
    await expect(page.locator('[data-site-navigation]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test('keeps locale links available without JavaScript and does not expose an inert menu control', async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    })
    const page = await context.newPage()

    try {
      const response = await page.goto(routePath('ja-JP', routeByFamily.detail))
      expect(response?.status()).toBe(200)
      await expect(page.locator('[data-site-navigation]')).toBeVisible()
      await expect(page.locator('[data-site-navigation] [data-locale-link]')).toHaveCount(16)
      await expect(page.locator('[data-menu-toggle]')).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    } finally {
      await context.close()
    }
  })
})
