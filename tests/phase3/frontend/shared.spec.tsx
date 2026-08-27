import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CopyPromptButton, FacetControl } from '../../../frontend/components/controls'
import { MediaBlock, type RenderableMedia } from '../../../frontend/components/media-block'
import { NodeEdge } from '../../../frontend/components/node-edge'
import { PromptCard } from '../../../frontend/components/prompt-card'
import { FrontendSiteShell } from '../../../frontend/components/site-shell'
import { StatePanel } from '../../../frontend/components/states'
import type { MediaEvidence, ProjectedPromptCard } from '@/contracts/projection'

const remoteXEvidence = {
  remote_url: 'https://pbs.twimg.com/media/evidence.jpg',
  thumbnail_url: 'https://pbs.twimg.com/media/evidence-thumb.jpg',
  media_type: 'image',
  width: 1200,
  height: 675,
  visibility: 'internal_preview',
  delivery_target: 'x_cdn',
  preview_noindex: true,
  rights_state: 'unknown',
  attribution_url: 'https://x.com/example/status/1',
} as MediaEvidence

describe('pSEO shared frontend components', () => {
  it('renders a candidate node as non-link dead text', () => {
    const html = renderToStaticMarkup(<NodeEdge item={{
      label: 'Candidate',
      node_ref: 'node-candidate',
      edge_ref: null,
      evidence_state: 'candidate',
      link_policy: 'dead_text',
      href: null,
      render_target: 'tag',
      target_indexability: 'none',
    }} />)

    expect(html).toContain('data-link-policy="dead_text"')
    expect(html).not.toContain('href=')
  })

  it('does not emit remote evidence media in public mode', () => {
    const html = renderToStaticMarkup(<MediaBlock mode="public" media={remoteXEvidence} />)

    expect(html).not.toContain('twimg.com')
    expect(html).toContain('Media unavailable')
  })

  it('resolves public media from its approved identity instead of a supplied URL', () => {
    const html = renderToStaticMarkup(<MediaBlock mode="public" media={{
      approved_media_id: 'media-p2l-example-001',
      url: 'https://pbs.twimg.com/media/forged.jpg',
      media_type: 'image',
      rights_state: 'first_party',
      status: 'approved',
    } as unknown as RenderableMedia} />)

    expect(html).toContain('https://preview.local/media/media-p2l-example-001')
    expect(html).not.toContain('twimg.com')
  })

  it('rejects inherited approved-media catalog properties', () => {
    const html = renderToStaticMarkup(<MediaBlock mode="public" media={{
      approved_media_id: 'toString',
    } as unknown as RenderableMedia} />)

    expect(html).toContain('Media unavailable')
    expect(html).not.toContain('<video')
  })

  it('keeps preview evidence lazy, private to the preview, and attributed', () => {
    const html = renderToStaticMarkup(<MediaBlock mode="preview" media={remoteXEvidence} />)

    expect(html).toContain('loading="lazy"')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('data-preview-noindex="true"')
    expect(html).toContain('Source attribution')
  })

  it('defers preview video evidence while preserving its isolation policy', () => {
    const html = renderToStaticMarkup(<MediaBlock mode="preview" media={{ ...remoteXEvidence, media_type: 'video' }} />)

    expect(html).toContain('preload="none"')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('Source attribution')
  })

  it('renders shell landmarks without taking ownership of the H1', () => {
    const html = renderToStaticMarkup(<FrontendSiteShell
      page={{ locale: 'en', route: '/en/prompts', breadcrumbs: [{ label: 'Prompts', href: '/en/prompts' }] }}
      navigation={{ version: 'v1', items: [] }}
    ><h1>Route-owned title</h1></FrontendSiteShell>)

    expect(html).toContain('href="#page-content"')
    expect(html).toContain('<header')
    expect(html).toContain('aria-label="Primary"')
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('<main id="page-content"')
    expect(html).toContain('<footer')
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1)
    expect(html).toContain('Footer navigation unavailable')
    expect(html).not.toContain('href="/data-policy"')
    expect(html).not.toContain('href="/legal"')
  })

  it('uses only qualified projection navigation in the footer', () => {
    const html = renderToStaticMarkup(<FrontendSiteShell
      page={{ locale: 'en', route: '/en/prompts', breadcrumbs: [{ label: 'Prompts', href: '/en/prompts' }] }}
      navigation={{ version: 'v1', items: [{
        label: 'About the data',
        node_ref: 'about-data',
        edge_ref: null,
        evidence_state: 'qualified',
        link_policy: 'link',
        href: '/en/about-data',
        render_target: 'page',
        target_indexability: 'indexable',
        promotion_state: 'qualified',
        target_page_id: '00000000-0000-4000-8000-000000000901',
      }] }}
    >content</FrontendSiteShell>)

    expect(html).toContain('aria-label="Footer"')
    expect(html).toContain('href="/en/about-data"')
    expect(html).not.toContain('Footer navigation unavailable')
  })

  it('switches exact locale-root routes as well as nested routes', () => {
    const html = renderToStaticMarkup(<FrontendSiteShell
      page={{ locale: 'en', route: '/en', breadcrumbs: [{ label: 'Home', href: '/en' }] }}
      navigation={{ version: 'v1', items: [] }}
    >content</FrontendSiteShell>)

    expect(html).toContain('href="/de-DE"')
  })

  it('only makes approved prompt cards navigable', () => {
    const card = {
      prompt_ref: { id: 'prompt-1', type: 'artifact' },
      title: 'Candidate prompt',
      summary: null,
      tags: [],
      evidence_state: 'candidate',
      link_policy: 'dead_text',
      href: null,
      render_target: 'tag',
      target_indexability: 'none',
    } as ProjectedPromptCard
    const html = renderToStaticMarkup(<PromptCard card={card} />)

    expect(html).toContain('Media unavailable')
    expect(html).not.toContain('href=')
  })

  it('does not promote malformed candidate cards and exposes truthful action states', () => {
    const card = {
      prompt_ref: { id: 'prompt-2', type: 'artifact' },
      title: 'Malformed candidate',
      summary: null,
      tags: [],
      evidence_state: 'candidate',
      link_policy: 'link',
      href: '/en/prompts/candidate',
      render_target: 'page',
      target_indexability: 'indexable',
    } as ProjectedPromptCard
    const html = renderToStaticMarkup(<PromptCard card={card} actions={{
      source: { label: 'Source', evidence_state: 'candidate', link_policy: 'link', href: '/source', render_target: 'page', target_indexability: 'indexable' },
      metrics: { label: 'Metrics', evidence_state: 'reviewed', link_policy: 'dead_text', href: null, render_target: 'tag', target_indexability: 'none' },
      detail: { label: 'Detail', evidence_state: 'qualified', link_policy: 'link', href: '/en/prompts/qualified', render_target: 'page', target_indexability: 'indexable' },
    }} />)

    expect(html).not.toContain('href="/en/prompts/candidate"')
    expect(html).toContain('Source unavailable')
    expect(html).toContain('Metrics unavailable')
    expect(html).toContain('href="/en/prompts/qualified"')
  })

  it('renders accessible non-canonical controls and explicit state text', () => {
    const html = renderToStaticMarkup(<><CopyPromptButton text="Prompt text" /><FacetControl label="Video" /><StatePanel state="inferred" message="Inferred from evidence" /></>)

    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('data-link-policy="filter_state"')
    expect(html).toContain('role="status"')
    expect(html).toContain('Inferred from evidence')
  })
})
