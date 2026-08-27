import {
  immutableIdSchema,
  relationRefSchema,
  ulidSchema,
  utcTimestampSchema,
  versionedHashSchema,
} from '@/contracts/common'
import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_A, UTC_NOW, UUID_A } from '../fixtures/contracts'

describe('canonical common contracts', () => {
  it('accept only immutable UUID or ULID identities', () => {
    expect(immutableIdSchema.parse(UUID_A)).toBe(UUID_A)
    expect(immutableIdSchema.parse('01J6R3W2V8W24Q10NRDBVGN3P9')).toBe('01J6R3W2V8W24Q10NRDBVGN3P9')
    expect(() => immutableIdSchema.parse('author-handle')).toThrow()
  })

  it('requires ULIDs specifically for append-only audit event identities', () => {
    expect(ulidSchema.parse('01J6R3W2V8W24Q10NRDBVGN3P9')).toBe('01J6R3W2V8W24Q10NRDBVGN3P9')
    expect(() => ulidSchema.parse(UUID_A)).toThrow()
  })

  it('accept RFC3339 Z timestamps and reject locale-dependent times', () => {
    expect(utcTimestampSchema.parse(UTC_NOW)).toBe(UTC_NOW)
    expect(() => utcTimestampSchema.parse('2026-08-23T12:34:56+08:00')).toThrow()
    expect(() => utcTimestampSchema.parse('2026-08-23 12:34:56Z')).toThrow()
    expect(utcTimestampSchema.parse('2024-02-29T23:59:59Z')).toBe('2024-02-29T23:59:59Z')
    expect(() => utcTimestampSchema.parse('2025-02-29T12:00:00Z')).toThrow()
    expect(() => utcTimestampSchema.parse('2026-19-01T12:00:00Z')).toThrow()
    expect(() => utcTimestampSchema.parse('2026-01-99T12:00:00Z')).toThrow()
    expect(() => utcTimestampSchema.parse('2026-01-01T99:00:00Z')).toThrow()
  })

  it('requires an explicit versioned SHA-256 hash', () => {
    expect(versionedHashSchema.parse(CONTENT_HASH_A)).toBe(CONTENT_HASH_A)
    expect(() => versionedHashSchema.parse('a'.repeat(64))).toThrow()
    expect(() => versionedHashSchema.parse(`sha256:v2:${'a'.repeat(64)}`)).toThrow()
  })

  it('requires typed relation identifiers and rejects unknown keys', () => {
    expect(relationRefSchema.parse({ type: 'source', id: UUID_A })).toEqual({
      type: 'source',
      id: UUID_A,
    })
    expect(() => relationRefSchema.parse({ type: 'source', id: UUID_A, locale: 'en' })).toThrow()
    expect(() => relationRefSchema.parse({ type: 'source', id: '' })).toThrow()
    expect(() => relationRefSchema.parse({ type: 'source', id: undefined })).toThrow()
  })
})
