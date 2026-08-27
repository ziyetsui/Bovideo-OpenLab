import { describe, expect, it } from 'vitest'

import { validatePublicRoute, validateRouteQuery } from '@/seo/routes'

describe('Phase 4 public route validator', () => {
  it('accepts a clean canonical 200 route', () => {
    const result = validatePublicRoute({ requestedUrl: '/en/prompts', canonicalPath: '/en/prompts', status: 200 })
    expect(result).toMatchObject({ valid: true, status: 200, sitemapEligible: true, queryCanonicalized: false })
  })

  it('requires query/filter URLs to redirect to their clean route', () => {
    const invalid = validatePublicRoute({ requestedUrl: '/en/prompts?page=2&sort=latest', canonicalPath: '/en/prompts', status: 200 })
    expect(invalid.valid).toBe(false)
    expect(invalid.sitemapEligible).toBe(false)
    expect(invalid.errors).toContain('query_url_must_redirect_to_clean_route')

    const redirect = validatePublicRoute({ requestedUrl: '/en/prompts?page=2&sort=latest', canonicalPath: '/en/prompts', targetPath: '/en/prompts', status: 308 })
    expect(redirect).toMatchObject({ valid: true, status: 308, queryParameters: ['page', 'sort'], sitemapEligible: false })
  })

  it.each([301, 308] as const)('accepts a %s redirect only with the canonical target', (status) => {
    expect(validatePublicRoute({ requestedUrl: '/en/old', canonicalPath: '/en/prompts', targetPath: '/en/prompts', status }).valid).toBe(true)
    expect(validatePublicRoute({ requestedUrl: '/en/old', canonicalPath: '/en/prompts', targetPath: null, status }).valid).toBe(false)
  })

  it('accepts terminal 410 without a target and validates query inputs', () => {
    expect(validatePublicRoute({ requestedUrl: '/en/retired', canonicalPath: '/en/retired', status: 410 }).valid).toBe(true)
    expect(validatePublicRoute({ requestedUrl: '/en/retired', canonicalPath: '/en/retired', targetPath: '/en/prompts', status: 410 }).valid).toBe(false)
    expect(validateRouteQuery('/en/prompts?filter=image&page=2')).toMatchObject({ valid: true, path: '/en/prompts', parameters: ['filter', 'page'] })
  })
})

