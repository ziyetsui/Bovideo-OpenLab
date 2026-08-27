import {
  buildExportIdempotencyKey,
  buildPublishIdempotencyKey,
  buildTranslateIdempotencyKey,
  buildWithdrawIdempotencyKey,
  queueEnvelopeSchema,
  VersionConflictError,
} from '@/contracts/index'
import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_A, UTC_NOW, UUID_A, UUID_B } from '../fixtures/contracts'

describe('publication and queue contracts', () => {
  it('constructs stable business idempotency keys', () => {
    expect(
      buildTranslateIdempotencyKey({
        entity_id: UUID_A,
        locale: 'ja-JP',
        source_hash: CONTENT_HASH_A,
        prompt_version: 'v1',
        model: 'gpt-4.1-2025-04-14',
      }),
    ).toBe(`translate:${UUID_A}:ja-JP:${CONTENT_HASH_A}:v1:gpt-4.1-2025-04-14`)
    expect(buildPublishIdempotencyKey(CONTENT_HASH_A)).toBe(`publish:${CONTENT_HASH_A}`)
    expect(buildExportIdempotencyKey(7, CONTENT_HASH_A)).toBe(`github:7:${CONTENT_HASH_A}`)
    expect(buildWithdrawIdempotencyKey(UUID_A, 4)).toBe(`withdraw:${UUID_A}:4`)
  })

  it('accepts ref-only strict queue envelopes', () => {
    expect(
      queueEnvelopeSchema.parse({
        schema_version: 1,
        job_id: '01J123456789ABCDEFGHJKMNPQ',
        kind: 'translate',
        entity_ref: { type: 'artifact', id: UUID_B },
        expected_source_version: CONTENT_HASH_A,
        idempotency_key: buildTranslateIdempotencyKey({
          entity_id: UUID_B,
          locale: 'ja-JP',
          source_hash: CONTENT_HASH_A,
          prompt_version: 'v1',
          model: 'gpt-4.1-2025-04-14',
        }),
        correlation_id: '01J123456789ABCDEFGHJKMNPR',
        causation_id: null,
        attempt: 0,
        enqueued_at: UTC_NOW,
        priority: 'normal',
      }),
    ).toMatchObject({ kind: 'translate' })
    expect(() =>
      queueEnvelopeSchema.parse({ schema_version: 1, raw_content: 'forbidden' }),
    ).toThrow()
  })

  it('requires ULIDs for queue job and causal metadata even when entity refs use UUIDs', () => {
    expect(() =>
      queueEnvelopeSchema.parse({
        schema_version: 1,
        job_id: UUID_A,
        kind: 'publish',
        entity_ref: { type: 'artifact', id: UUID_B },
        expected_source_version: CONTENT_HASH_A,
        idempotency_key: buildPublishIdempotencyKey(CONTENT_HASH_A),
        correlation_id: UUID_A,
        causation_id: UUID_A,
        attempt: 0,
        enqueued_at: UTC_NOW,
        priority: 'normal',
      }),
    ).toThrow()
  })

  it('rejects prose, credential-like keys and nested unknown fields', () => {
    const valid = {
      schema_version: 1,
      job_id: '01J123456789ABCDEFGHJKMNPQ',
      kind: 'publish' as const,
      entity_ref: { type: 'artifact' as const, id: UUID_B },
      expected_source_version: CONTENT_HASH_A,
      idempotency_key: buildPublishIdempotencyKey(CONTENT_HASH_A),
      correlation_id: '01J123456789ABCDEFGHJKMNPR',
      causation_id: null,
      attempt: 0,
      enqueued_at: UTC_NOW,
      priority: 'normal' as const,
    }
    expect(() => queueEnvelopeSchema.parse({ ...valid, idempotency_key: 'publish:the complete translated text goes here' })).toThrow()
    expect(() => queueEnvelopeSchema.parse({ ...valid, idempotency_key: 'publish:api_key=forbidden' })).toThrow()
    expect(() => queueEnvelopeSchema.parse({ ...valid, entity_ref: { ...valid.entity_ref, raw_content: 'forbidden' } })).toThrow()
  })

  it('exposes version conflicts as a typed error', () => {
    const error = new VersionConflictError({
      entity_id: UUID_A,
      expected_revision: 2,
      actual_revision: 3,
    })
    expect(error).toMatchObject({
      code: 'version_conflict',
      expected_revision: 2,
      actual_revision: 3,
    })
    expect(error).not.toHaveProperty('record')
    expect(error).not.toHaveProperty('entity')
  })
})
