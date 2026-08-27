import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MediaBlock } from '../../../frontend/components/media-block'
import { phase3PreviewMediaEvidence, phase3PreviewProjectionFor } from '../../../tests/phase3/frontend/preview-adapter'

describe('Phase 3 frontend preview adapter', () => {
  it('keeps remote X evidence out of the Detail projection', () => {
    const projection = phase3PreviewProjectionFor({
      family: 'detail',
      locale: 'en',
      route: '/en/prompts/cinematic-product-shot-00000000-0000-4000-8000-000000000001',
    })

    expect(projection?.page.page_type).toBe('detail')
    expect(JSON.stringify(projection)).not.toContain('pbs.twimg.com')
  })

  it('passes remote X evidence through the public-media policy boundary without leaking its host', () => {
    const remoteEvidence = phase3PreviewMediaEvidence()
    const html = renderToStaticMarkup(createElement(MediaBlock, { mode: 'public', media: remoteEvidence }))

    expect(remoteEvidence.remote_url).toContain('pbs.twimg.com')
    expect(html).toContain('Media unavailable')
    expect(html).not.toContain('pbs.twimg.com')
  })
})
