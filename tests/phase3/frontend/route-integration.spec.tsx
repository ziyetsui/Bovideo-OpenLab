import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { resolveFrontendRoute } from '../../../frontend/routes/resolve-active-projection'

const ROUTES = [
  'src/app/(frontend)/[locale]/prompts/page.tsx',
  'src/app/(frontend)/[locale]/prompts/image/page.tsx',
  'src/app/(frontend)/[locale]/prompts/video/page.tsx',
  'src/app/(frontend)/[locale]/prompts/models/[entitySlug]/page.tsx',
  'src/app/(frontend)/[locale]/prompts/use-cases/[entitySlug]/page.tsx',
  'src/app/(frontend)/[locale]/prompts/styles/[entitySlug]/page.tsx',
  'src/app/(frontend)/[locale]/prompts/[slugAndId]/page.tsx',
] as const

describe('pSEO frontend production route integration', () => {
  it.each(ROUTES)('does not leave fixture imports in %s', async (route) => {
    const source = await readFile(route, 'utf8')

    expect(source).not.toContain('P3_GOLDEN_LOCALE_FIXTURES')
    expect(source).not.toContain('LOCAL_DETAIL_PAGES')
  })

  it.each(ROUTES)('marks %s as request-time rendered because it reads a live Payload publication', async (route) => {
    const source = await readFile(route, 'utf8')

    expect(source).toContain("export const dynamic = 'force-dynamic'")
  })

  it('refuses to select an arbitrary released projection without a bound active-publication reader', async () => {
    await expect(resolveFrontendRoute({
      locale: 'en',
      route: '/en/prompts',
      family: 'hub',
    })).resolves.toBeUndefined()
  })
})
