import { describe, expect, it } from 'vitest'

import { renderDetailDocument, renderDetailHtml } from '@/detail/render'
import { completeDetailFixture } from '../fixtures/detail/complete'
import { partialDetailFixture } from '../fixtures/detail/partial'

describe('P2-L T04 honest detail renderer', () => {
  it('renders one H1, accessible provenance, and all four equivalent noindex directives', () => {
    const page = completeDetailFixture.pages[0]!
    const response = renderDetailDocument(page)
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet')
    expect(response.html.match(/<h1\b/gi)).toHaveLength(1)
    expect(response.html).toContain('data-provenance="explicit"')
    expect(response.html).toContain('data-provenance="inferred"')
    expect(response.html).toContain('data-provenance="candidate"')
    expect(response.html).toContain('noindex,nofollow,noarchive,nosnippet')
    expect(response.html).not.toMatch(/<link[^>]+rel=["']canonical/i)
    expect(response.html).not.toMatch(/hreflang|application\/ld\+json|<script/i)
    expect(response.html).not.toMatch(/<h[3-6][^>]*>.*<h[1-2]/i)
  })

  it('renders missing modules honestly without invented filler', () => {
    const response = renderDetailDocument(partialDetailFixture.pages[0]!)
    expect(response.html).toContain('data-module-state="unavailable"')
    expect(response.html).toContain('Not available from approved evidence')
    expect(response.html).not.toContain('Example output generated for this page')
    expect(response.html).toContain('data-generated-filler-count="0"')
  })

  it('escapes unsafe text in attributes and text nodes', () => {
    const page = completeDetailFixture.pages[0]!
    const hostile = { ...page, title: '" ><img src=x onerror=alert(1)>' }
    const html = renderDetailHtml(hostile)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })
})
