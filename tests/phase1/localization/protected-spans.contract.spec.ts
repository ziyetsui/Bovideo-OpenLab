import {
  MAX_PROTECTED_SPANS,
  normalizeProtectedSpans,
  restoreProtectedSpans,
  serializeProtectedSpans,
  type ProtectedSpan,
} from '@/localization/protected-spans'
import { describe, expect, it } from 'vitest'

const source = 'Run model gpt-4.1 with emoji 😀 and {{prompt}} at https://bo.example.test.'

function span(start: number, end: number, kind: string, exactText = source.slice(start, end)): ProtectedSpan {
  return { start, end, kind, exact_text: exactText }
}

describe('protected span codec', () => {
  it('normalizes to UTF-16 offsets and preserves an emoji surrogate pair', () => {
    const emojiStart = source.indexOf('😀')
    const result = normalizeProtectedSpans(source, [
      span(source.indexOf('https://'), source.length, 'url'),
      span(emojiStart, emojiStart + 2, 'brand'),
    ])

    expect(result).toEqual([
      span(emojiStart, emojiStart + 2, 'brand'),
      span(source.indexOf('https://'), source.length, 'url'),
    ])
    expect(result[0]?.exact_text).toBe('😀')
  })

  it.each([
    ['nested spans', [span(0, 10, 'outer'), span(2, 4, 'inner')]],
    ['overlapping spans', [span(0, 5, 'a'), span(4, 8, 'b')]],
    ['out-of-range end', [span(0, source.length + 1, 'bad')]],
    ['negative start', [span(-1, 2, 'bad')]],
    ['mismatched exact text', [span(0, 3, 'bad', 'nope')]],
  ])('rejects %s', (_label, spans) => {
    expect(() => normalizeProtectedSpans(source, spans)).toThrow()
  })

  it('rejects a span boundary that splits a surrogate pair', () => {
    const emojiStart = source.indexOf('😀')
    expect(() => normalizeProtectedSpans(source, [span(emojiStart + 1, emojiStart + 2, 'bad')])).toThrow()
  })

  it('serializes and restores protected text byte-identically with stable placeholders', () => {
    const spans = [span(source.indexOf('gpt-4.1'), source.indexOf('gpt-4.1') + 'gpt-4.1'.length, 'model')]
    const encoded = serializeProtectedSpans(source, spans)

    expect(encoded.serialized).toContain('__BO_PROTECTED_0__')
    expect(encoded.serialized).not.toContain('gpt-4.1')
    expect(restoreProtectedSpans(encoded, source, spans)).toBe(source)
  })

  it('escapes a literal placeholder and restores it without collision', () => {
    const input = 'literal __BO_PROTECTED_0__ and token'
    const tokenStart = input.lastIndexOf('token')
    const spans = [
      { start: tokenStart, end: input.length, kind: 'variable', exact_text: 'token' },
    ] satisfies ProtectedSpan[]
    const encoded = serializeProtectedSpans(input, spans)

    expect(encoded.serialized).toContain('\\__BO_PROTECTED_0__')
    expect(restoreProtectedSpans(encoded, input, spans)).toBe(input)
  })

  it('rejects missing, duplicate, reordered, and unknown placeholders', () => {
    const spans = [span(0, 3, 'a'), span(4, 7, 'b')]
    const encoded = serializeProtectedSpans(source.slice(0, 7), spans)

    expect(() => restoreProtectedSpans(encoded.serialized.replace('__BO_PROTECTED_1__', ''), source.slice(0, 7), spans)).toThrow()
    expect(() => restoreProtectedSpans(encoded.serialized.replace('__BO_PROTECTED_1__', '__BO_PROTECTED_0__'), source.slice(0, 7), spans)).toThrow()
    expect(() => restoreProtectedSpans(encoded.serialized.replace('__BO_PROTECTED_0__', '__BO_PROTECTED_1__'), source.slice(0, 7), spans)).toThrow()
    expect(() => restoreProtectedSpans(`${encoded.serialized} __BO_PROTECTED_99__`, source.slice(0, 7), spans)).toThrow()
  })

  it('reads an untrusted serialized getter exactly once', () => {
    const spans = [span(0, 3, 'a')]
    const encoded = serializeProtectedSpans(source.slice(0, 7), spans)
    let reads = 0
    const untrusted = {
      get serialized() {
        reads += 1
        return encoded.serialized
      },
    }

    expect(restoreProtectedSpans(untrusted, source.slice(0, 7), spans)).toBe(source.slice(0, 7))
    expect(reads).toBe(1)
  })

  it('reads each untrusted span field exactly once before copying it', () => {
    const reads = { start: 0, end: 0, kind: 0, exact_text: 0 }
    const untrusted = {
      get start() {
        reads.start += 1
        return 0
      },
      get end() {
        reads.end += 1
        return 3
      },
      get kind() {
        reads.kind += 1
        return 'prefix'
      },
      get exact_text() {
        reads.exact_text += 1
        return 'Run'
      },
    }

    expect(normalizeProtectedSpans(source, [untrusted])).toEqual([span(0, 3, 'prefix')])
    expect(reads).toEqual({ start: 1, end: 1, kind: 1, exact_text: 1 })
  })

  it('rejects resource exhaustion and malformed span collections', () => {
    expect(() => normalizeProtectedSpans(source, Array.from({ length: MAX_PROTECTED_SPANS + 1 }, (_, index) => span(index * 2, index * 2 + 1, 'x')))).toThrow()
    expect(() => normalizeProtectedSpans(source, null as unknown as ProtectedSpan[])).toThrow()
    expect(() => serializeProtectedSpans(source, [{ start: 0, end: 1, kind: 'x', exact_text: 'X' }])).toThrow()
  })

  it('round-trips generated non-overlapping UTF-16 spans', () => {
    for (let iteration = 0; iteration < 128; iteration += 1) {
      const input = `prefix-${iteration}-😀-middle-${'x'.repeat(iteration % 17)}-suffix`
      const emojiStart = input.indexOf('😀')
      const suffixStart = input.indexOf('-suffix')
      const spans = [
        { start: 0, end: `prefix-${iteration}`.length, kind: 'prefix', exact_text: `prefix-${iteration}` },
        { start: emojiStart, end: emojiStart + 2, kind: 'emoji', exact_text: '😀' },
        { start: suffixStart + 1, end: input.length, kind: 'suffix', exact_text: 'suffix' },
      ] satisfies ProtectedSpan[]

      const encoded = serializeProtectedSpans(input, spans)
      expect(restoreProtectedSpans(encoded.serialized, input, spans)).toBe(input)
    }
  })
})
