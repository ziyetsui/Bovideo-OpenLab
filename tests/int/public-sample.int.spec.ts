import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { APPLICATION_LOCALES } from '../../src/collections/shared'

describe('public multilingual sample', () => {
  it('contains exactly the application locales and stays synthetic/noindex', async () => {
    const sample = JSON.parse(
      await readFile(new URL('../../resources/examples/locale-variants.sample.json', import.meta.url), 'utf8'),
    ) as {
      index_state: string
      rights_basis: string
      variants: Array<{ locale: string; summary: string; title: string }>
    }

    expect(sample.index_state).toBe('discoverable_noindex')
    expect(sample.rights_basis).toMatch(/Synthetic first-party/i)
    expect(sample.variants.map(({ locale }) => locale)).toEqual([...APPLICATION_LOCALES])
    expect(new Set(sample.variants.map(({ locale }) => locale)).size).toBe(16)
    for (const variant of sample.variants) {
      expect(variant.title.trim()).not.toBe('')
      expect(variant.summary.trim()).not.toBe('')
    }
  })
})
