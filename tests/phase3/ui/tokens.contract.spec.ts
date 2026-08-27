import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('Bauhaus presentation tokens', () => {
  it('pins the approved colors, geometry and local Outfit font', async () => {
    const [css, layout] = await Promise.all([
      readFile('src/app/(frontend)/styles.css', 'utf8'),
      readFile('src/app/(frontend)/layout.tsx', 'utf8'),
    ])

    for (const value of ['#F0F0F0', '#121212', '#D02020', '#1040C0', '#F0C020']) {
      expect(css).toContain(value)
    }
    for (const token of [
      '--border-thin: 2px',
      '--border-heavy: 4px',
      '--shadow-4: 4px 4px 0',
      '--shadow-6: 6px 6px 0',
      '--shadow-8: 8px 8px 0',
      '--radius-square: 0',
      '--radius-round: 9999px',
    ]) {
      expect(css).toContain(token)
    }
    expect(layout).toContain("@fontsource-variable/outfit/wght.css")
    expect(css).toContain('prefers-reduced-motion: reduce')

    const radii = [...css.matchAll(/border-radius:\s*([^;]+)/g)].map((match) => match[1]!.trim())
    expect(radii.every((value) => [
      '0',
      '9999px',
      'var(--radius-square)',
      'var(--radius-round)',
    ].includes(value))).toBe(true)
    expect(css).not.toContain('linear-gradient')
  })
})
