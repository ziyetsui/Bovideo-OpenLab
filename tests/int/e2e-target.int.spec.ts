import { describe, expect, it } from 'vitest'

import { resolveE2ETarget } from '../helpers/e2eTarget'

describe('resolveE2ETarget', () => {
  it('uses the local server by default', () => {
    expect(resolveE2ETarget({})).toEqual({
      baseURL: 'http://localhost:3000',
      startLocalServer: true,
    })
  })

  it('uses an HTTPS Preview without starting a local server', () => {
    expect(resolveE2ETarget({ PREVIEW_BASE_URL: 'https://bovideo-openlab-preview.example.workers.dev/' })).toEqual({
      baseURL: 'https://bovideo-openlab-preview.example.workers.dev',
      startLocalServer: false,
    })
  })

  it.each([
    'http://bovideo-openlab-preview.example.workers.dev',
    'https://user:password@example.com',
    'https://example.com/path',
    'not-a-url',
  ])('rejects an unsafe Preview target: %s', (value) => {
    expect(() => resolveE2ETarget({ PREVIEW_BASE_URL: value })).toThrow(/Preview/i)
  })
})
