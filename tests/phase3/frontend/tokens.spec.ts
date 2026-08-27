import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('frontend Bauhaus foundations', () => {
  it('exposes the Bauhaus token contract', async () => {
    const css = await readFile('frontend/styles/tokens.css', 'utf8')

    for (const color of ['#F0F0F0', '#121212', '#D02020', '#1040C0', '#F0C020']) {
      expect(css).toContain(color)
    }
    expect(css).toContain('--border-major: 4px')
  })

  it('defines accessible global motion and responsive display rules', async () => {
    const css = await readFile('frontend/styles/global.css', 'utf8')

    expect(css).toContain(':focus-visible')
    expect(css).toContain('prefers-reduced-motion: reduce')
    for (const size of ['font-size: 36px', 'font-size: 60px', 'font-size: 96px']) expect(css).toContain(size)
  })
})
