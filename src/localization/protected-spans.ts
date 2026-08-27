/**
 * Strict, dependency-free codec for content that must survive localization.
 *
 * Offsets are JavaScript UTF-16 code-unit offsets. The codec deliberately
 * rejects malformed boundaries and every overlap: accepting an ambiguous
 * span graph would make restoration dependent on traversal order.
 */

export const MAX_PROTECTED_SPANS = 4_096
export const MAX_SOURCE_CODE_UNITS = 1_000_000
export const MAX_SPAN_CODE_UNITS = 250_000
export const MAX_SERIALIZED_CODE_UNITS = 2_000_000
export const MAX_KIND_CODE_UNITS = 128

const PLACEHOLDER_PREFIX = '__BO_PROTECTED_'
const PLACEHOLDER_PATTERN = /__BO_PROTECTED_[0-9]+__/
const PLACEHOLDER_TOKEN_PATTERN = /^__BO_PROTECTED_([0-9]+)__/
const PLACEHOLDER_LIKE_PATTERN = /^__BO_PROTECTED_[A-Za-z0-9_-]{0,128}/

export type ProtectedSpanKind = string

export interface ProtectedSpan {
  readonly start: number
  readonly end: number
  readonly kind: ProtectedSpanKind
  readonly exact_text: string
}

export interface ProtectedPlaceholder {
  readonly index: number
  readonly token: string
  readonly kind: ProtectedSpanKind
  readonly exact_text: string
}

export interface SerializedProtectedSpans {
  readonly schema_version: 1
  readonly serialized: string
  readonly placeholders: readonly ProtectedPlaceholder[]
  readonly source_code_units: number
}

export type SerializedProtectedInput = string | Pick<SerializedProtectedSpans, 'serialized'>

export type ProtectedSpanErrorCode =
  | 'invalid_source'
  | 'resource_limit'
  | 'invalid_collection'
  | 'invalid_span'
  | 'span_mismatch'
  | 'surrogate_boundary'
  | 'overlap'
  | 'invalid_serialized_input'
  | 'invalid_escape'
  | 'placeholder_missing'
  | 'placeholder_duplicate'
  | 'placeholder_order'
  | 'placeholder_unknown'
  | 'restore_mismatch'

export class ProtectedSpanError extends Error {
  readonly code: ProtectedSpanErrorCode

  constructor(code: ProtectedSpanErrorCode, message: string) {
    super(message)
    this.name = 'ProtectedSpanError'
    this.code = code
  }
}

function fail(code: ProtectedSpanErrorCode, message: string): never {
  throw new ProtectedSpanError(code, message)
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff
}

function assertCodeUnitBoundary(source: string, offset: number, label: 'start' | 'end'): void {
  const previous = offset > 0 ? source.charCodeAt(offset - 1) : -1
  const next = offset < source.length ? source.charCodeAt(offset) : -1
  if ((label === 'start' && isLowSurrogate(next) && isHighSurrogate(previous)) ||
      (label === 'end' && isHighSurrogate(previous) && isLowSurrogate(next))) {
    fail('surrogate_boundary', `${label} splits a UTF-16 surrogate pair`)
  }
}

function assertSource(source: unknown): asserts source is string {
  if (typeof source !== 'string') {
    fail('invalid_source', 'source must be a string')
  }
  if (source.length > MAX_SOURCE_CODE_UNITS) {
    fail('resource_limit', `source exceeds ${MAX_SOURCE_CODE_UNITS} UTF-16 code units`)
  }
}

function copyAndValidateSpan(source: string, candidate: unknown, index: number): ProtectedSpan {
  if (candidate === null || typeof candidate !== 'object') {
    fail('invalid_span', `span ${index} must be an object`)
  }

  // Read every untrusted property once. The returned plain object is then
  // safe to sort and inspect without invoking user-controlled getters again.
  const record = candidate as Record<string, unknown>
  const start = record.start
  const end = record.end
  const kind = record.kind
  const exactText = record.exact_text

  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    fail('invalid_span', `span ${index} must have integer 0 <= start < end`)
  }
  if (end > source.length) {
    fail('invalid_span', `span ${index} is outside source bounds`)
  }
  if (end - start > MAX_SPAN_CODE_UNITS) {
    fail('resource_limit', `span ${index} exceeds ${MAX_SPAN_CODE_UNITS} code units`)
  }
  if (typeof kind !== 'string' || kind.length === 0 || kind.length > MAX_KIND_CODE_UNITS || /[\u0000-\u001f\u007f]/u.test(kind)) {
    fail('invalid_span', `span ${index} has an invalid kind`)
  }
  if (typeof exactText !== 'string') {
    fail('invalid_span', `span ${index} exact_text must be a string`)
  }

  assertCodeUnitBoundary(source, start, 'start')
  assertCodeUnitBoundary(source, end, 'end')
  const expectedText = source.slice(start, end)
  if (exactText !== expectedText) {
    fail('span_mismatch', `span ${index} exact_text does not match source`)
  }

  return { start, end, kind, exact_text: exactText }
}

/** Validate, clone, and sort spans by UTF-16 start offset. */
export function normalizeProtectedSpans(source: string, spans: readonly ProtectedSpan[]): ProtectedSpan[] {
  assertSource(source)
  if (!Array.isArray(spans)) {
    fail('invalid_collection', 'spans must be an array')
  }
  // Read length once so a hostile array-like proxy cannot change the budget
  // during validation. Array elements are copied before sorting.
  const spanCount = spans.length
  if (!Number.isSafeInteger(spanCount) || spanCount > MAX_PROTECTED_SPANS) {
    fail('resource_limit', `at most ${MAX_PROTECTED_SPANS} protected spans are allowed`)
  }

  const normalized: ProtectedSpan[] = []
  for (let index = 0; index < spanCount; index += 1) {
    normalized.push(copyAndValidateSpan(source, spans[index], index))
  }
  normalized.sort((left, right) => left.start - right.start || left.end - right.end)

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]
    const current = normalized[index]
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      fail('overlap', `protected spans ${index - 1} and ${index} overlap or nest`)
    }
  }

  return normalized.map((span) => Object.freeze({ ...span }))
}

function escapeLiteral(text: string): string {
  // Escape the escape character first. This makes decoding unambiguous even
  // when an ordinary source segment already contains a placeholder-looking
  // string or a backslash immediately before one.
  return text.replaceAll('\\', '\\\\').replace(new RegExp(PLACEHOLDER_PATTERN.source, 'g'), '\\$&')
}

function assertSerializedSize(serialized: string): void {
  if (serialized.length > MAX_SERIALIZED_CODE_UNITS) {
    fail('resource_limit', `serialized prompt exceeds ${MAX_SERIALIZED_CODE_UNITS} code units`)
  }
}

/** Replace protected ranges with stable placeholders and escape literals. */
export function serializeProtectedSpans(source: string, spans: readonly ProtectedSpan[]): SerializedProtectedSpans {
  const normalized = normalizeProtectedSpans(source, spans)
  const placeholders: ProtectedPlaceholder[] = normalized.map((span, index) => Object.freeze({
    index,
    token: `${PLACEHOLDER_PREFIX}${index}__`,
    kind: span.kind,
    exact_text: span.exact_text,
  }))

  let serialized = ''
  let cursor = 0
  for (let index = 0; index < normalized.length; index += 1) {
    const span = normalized[index]
    const placeholder = placeholders[index]
    if (span === undefined || placeholder === undefined) {
      fail('restore_mismatch', 'internal placeholder construction mismatch')
    }
    serialized += escapeLiteral(source.slice(cursor, span.start))
    serialized += placeholder.token
    cursor = span.end
  }
  serialized += escapeLiteral(source.slice(cursor))
  assertSerializedSize(serialized)

  return Object.freeze({
    schema_version: 1 as const,
    serialized,
    placeholders: Object.freeze(placeholders),
    source_code_units: source.length,
  })
}

function readSerializedOnce(input: SerializedProtectedInput): string {
  if (typeof input === 'string') {
    return input
  }
  if (input === null || typeof input !== 'object') {
    fail('invalid_serialized_input', 'serialized input must be a string or carrier object')
  }
  // Deliberately read this getter exactly once. The value is bounded and then
  // treated as immutable local data for the rest of restoration.
  const serialized = (input as { serialized?: unknown }).serialized
  if (typeof serialized !== 'string') {
    fail('invalid_serialized_input', 'serialized carrier must expose a string')
  }
  return serialized
}

function decodeSerialized(serialized: string, placeholders: readonly ProtectedPlaceholder[]): string {
  assertSerializedSize(serialized)
  const byIndex = new Map<number, ProtectedPlaceholder>()
  for (let index = 0; index < placeholders.length; index += 1) {
    const placeholder = placeholders[index]
    if (placeholder === undefined || placeholder.index !== index || placeholder.token !== `${PLACEHOLDER_PREFIX}${index}__`) {
      fail('invalid_serialized_input', 'placeholder table is not canonical')
    }
    if (byIndex.has(index)) {
      fail('placeholder_duplicate', `placeholder ${index} is duplicated`)
    }
    byIndex.set(index, placeholder)
  }

  let output = ''
  let cursor = 0
  let expectedIndex = 0
  while (cursor < serialized.length) {
    const character = serialized[cursor]
    if (character === '\\') {
      const next = serialized[cursor + 1]
      if (next === '\\') {
        output += '\\'
        cursor += 2
        continue
      }
      if (next === undefined) {
        fail('invalid_escape', 'serialized prompt ends with an escape character')
      }
      const escaped = serialized.slice(cursor + 1)
      const escapedMatch = PLACEHOLDER_TOKEN_PATTERN.exec(escaped)
      if (escapedMatch !== null) {
        output += escapedMatch[0]
        cursor += escapedMatch[0].length + 1
        continue
      }
      fail('invalid_escape', 'serialized prompt contains an unknown escape')
    }

    const remaining = serialized.slice(cursor)
    const match = PLACEHOLDER_TOKEN_PATTERN.exec(remaining)
    if (match !== null) {
      const index = Number(match[1])
      if (!Number.isSafeInteger(index) || index < 0 || index >= placeholders.length || !byIndex.has(index)) {
        fail('placeholder_unknown', `unknown protected placeholder ${match[0]}`)
      }
      if (index !== expectedIndex) {
        if (index < expectedIndex) {
          fail('placeholder_duplicate', `placeholder ${index} appears more than once`)
        }
        fail('placeholder_order', `placeholder ${index} appears before ${expectedIndex}`)
      }
      const placeholder = byIndex.get(index)
      if (placeholder === undefined) {
        fail('placeholder_unknown', `unknown protected placeholder ${match[0]}`)
      }
      output += placeholder.exact_text
      expectedIndex += 1
      cursor += match[0].length
      continue
    }

    if (remaining.startsWith(PLACEHOLDER_PREFIX) || PLACEHOLDER_LIKE_PATTERN.test(remaining)) {
      fail('placeholder_unknown', 'serialized prompt contains a malformed protected placeholder')
    }
    output += character
    cursor += 1
  }

  if (expectedIndex !== placeholders.length) {
    fail('placeholder_missing', `expected ${placeholders.length} placeholders but restored ${expectedIndex}`)
  }
  return output
}

/** Restore each placeholder exactly once, in canonical order, with exact text. */
export function restoreProtectedSpans(
  input: SerializedProtectedInput,
  source: string,
  spans: readonly ProtectedSpan[],
): string {
  const serialized = readSerializedOnce(input)
  const normalized = normalizeProtectedSpans(source, spans)
  const placeholders: ProtectedPlaceholder[] = normalized.map((span, index) => ({
    index,
    token: `${PLACEHOLDER_PREFIX}${index}__`,
    kind: span.kind,
    exact_text: span.exact_text,
  }))
  return decodeSerialized(serialized, placeholders)
}

/** Return the wire string when a caller does not need the placeholder table. */
export function serializeProtectedPrompt(source: string, spans: readonly ProtectedSpan[]): string {
  return serializeProtectedSpans(source, spans).serialized
}

export const extractProtectedSpans = normalizeProtectedSpans
export const restoreSerializedProtectedSpans = restoreProtectedSpans
