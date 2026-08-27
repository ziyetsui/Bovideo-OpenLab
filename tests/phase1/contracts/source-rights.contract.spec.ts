import {
  decideRights,
  decideSourceRevision,
  sourceRevisionKey,
  sourceSchema,
  sourceUniqueKey,
} from '@/contracts/index'
import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_B, UUID_A, UUID_B, UUID_D, sourceInput } from '../fixtures/contracts'

describe('source evidence and rights contracts', () => {
  it('uses exactly provider, provider record, and content hash for source uniqueness', () => {
    const first = sourceUniqueKey(sourceInput)
    expect(first).toBe(
      sourceUniqueKey({ ...sourceInput, canonical_url: 'https://other.example/ignored' }),
    )
    expect(first).not.toBe(sourceUniqueKey({ ...sourceInput, content_hash: CONTENT_HASH_B }))
    const successor = {
      ...sourceInput,
      id: UUID_D,
      content_hash: CONTENT_HASH_B,
      supersedes_source_ref: { type: 'source' as const, id: UUID_A },
    }
    expect(sourceRevisionKey(sourceInput, successor)).toEqual({
      supersedes_source_ref: { type: 'source', id: UUID_A },
      content_hash: CONTENT_HASH_B,
    })
    expect(decideSourceRevision(sourceInput, { ...successor, id: UUID_A })).toMatchObject({
      allowed: false,
      code: 'same_source_id',
    })
    expect(
      decideSourceRevision(sourceInput, { ...successor, content_hash: sourceInput.content_hash }),
    ).toMatchObject({
      allowed: false,
      code: 'unchanged_content_hash',
    })
    expect(
      decideSourceRevision(sourceInput, {
        ...successor,
        supersedes_source_ref: { type: 'source' as const, id: UUID_B },
      }),
    ).toMatchObject({ allowed: false, code: 'supersession_mismatch' })
    expect(() => sourceRevisionKey(sourceInput, { ...successor, id: UUID_A })).toThrow(
      'source revision rejected: same_source_id',
    )
  })

  it('parses strict source evidence with append-only revision links', () => {
    expect(sourceSchema.parse(sourceInput)).toMatchObject(sourceInput)
    expect(() => sourceSchema.parse({ ...sourceInput, injected: true })).toThrow()
    expect(() =>
      sourceSchema.parse({ ...sourceInput, content_hash: 'not-a-versioned-hash' }),
    ).toThrow()
    expect(() =>
      sourceSchema.parse({
        ...sourceInput,
        supersedes_source_ref: { type: 'artifact', id: UUID_A },
      }),
    ).toThrow()
    expect(() =>
      sourceSchema.parse({ ...sourceInput, author_ref: { type: 'source', id: UUID_A } }),
    ).toThrow()
  })

  it.each([
    ['unknown', false, false, 'none', null],
    ['metadata_only', true, false, 'metadata_only', null],
    ['display_licensed', true, false, 'full_display', null],
    ['redistribution_licensed', true, true, 'full_display', null],
    ['first_party', true, true, 'full_display', null],
    ['blocked', false, false, 'none', null],
    ['revoked', false, false, 'none', 'emergency'],
  ] as const)(
    'decides the complete %s rights matrix',
    (rightsState, mayDisplay, mayExport, fields, withdrawalPriority) => {
      expect(decideRights(rightsState)).toEqual({
        may_display: mayDisplay,
        may_export: mayExport,
        fields,
        withdrawal_intent: withdrawalPriority === null ? null : { priority: withdrawalPriority },
      })
    },
  )

  it('limits metadata-only, keeps display licenses out of redistribution, and permits lawful export', () => {
    expect(decideRights('metadata_only')).toEqual({
      may_display: true,
      may_export: false,
      fields: 'metadata_only',
      withdrawal_intent: null,
    })
    expect(decideRights('display_licensed')).toMatchObject({ may_display: true, may_export: false })
    expect(decideRights('redistribution_licensed')).toMatchObject({
      may_display: true,
      may_export: true,
    })
    expect(decideRights('first_party')).toMatchObject({ may_display: true, may_export: true })
  })

  it('rejects retired ambiguous licensed values', () => {
    expect(() => sourceSchema.parse({ ...sourceInput, rights_state: 'licensed' })).toThrow()
  })

  it.each([undefined, null, 'licensed', 'unrecognized', { state: 'first_party' }])(
    'fails closed for malformed runtime rights input %#',
    (rightsState) => {
      expect(decideRights(rightsState)).toEqual({
        may_display: false,
        may_export: false,
        fields: 'none',
        withdrawal_intent: null,
      })
    },
  )
})
