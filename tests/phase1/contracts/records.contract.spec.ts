import {
  activePublicationPointerSchema,
  assertSourceMutationAllowed,
  deletionRequestSchema,
  edgeSchema,
  moduleEnvelopeSchema,
  pageCandidateSchema,
  publicationStateRecordSchema,
  taxonomyNodeSchema,
  workflowRunSchema,
} from '@/contracts/index'
import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_A, UTC_NOW, UUID_A, UUID_B, UUID_C, sourceInput } from '../fixtures/contracts'

describe('remaining canonical record schemas', () => {
  it('rejects evidence mutation while allowing source revisions to append', () => {
    expect(() =>
      assertSourceMutationAllowed(sourceInput, {
        ...sourceInput,
        raw_ref: { ...sourceInput.raw_ref, version: 'v2' },
      }),
    ).toThrow('raw_ref is immutable')
    expect(() =>
      assertSourceMutationAllowed(sourceInput, {
        ...sourceInput,
        captured_at: '2026-08-24T00:00:00.000Z',
      }),
    ).toThrow('captured_at is immutable')
  })

  it('accepts strict graph, page, module, publication-state, pointer, and deletion records', () => {
    expect(
      taxonomyNodeSchema.parse({
        id: UUID_A,
        schema_version: 1,
        node_type: 'model',
        stable_key: 'model-synthetic',
        label: 'Synthetic model',
        description: 'Synthetic description',
        promotion_state: 'qualified',
        evidence_refs: [{ type: 'source', id: UUID_B }],
      }),
    ).toMatchObject({ node_type: 'model' })
    expect(
      edgeSchema.parse({
        id: UUID_A,
        schema_version: 1,
        from: { type: 'artifact', id: UUID_B },
        relation: 'generated_with',
        to: { type: 'taxonomy_node', id: UUID_C },
        evidence_refs: [{ type: 'source', id: UUID_B }],
        evidence_revision: CONTENT_HASH_A,
        confidence: 0.8,
        review_state: 'approved',
        valid_from: UTC_NOW,
        valid_to: null,
      }),
    ).toMatchObject({ review_state: 'approved' })
    expect(
      pageCandidateSchema.parse({
        id: UUID_A,
        schema_version: 1,
        revision: 1,
        page_type: 'detail',
        root_object_ref: { type: 'artifact', id: UUID_B },
        locale: 'en',
        intent: 'Use synthetic prompt',
        index_state: 'index_candidate',
        qualification_input_hash: CONTENT_HASH_A,
        qualification_rule_version: 'v1',
        reason_codes: ['qualified'],
      }),
    ).toMatchObject({ page_type: 'detail' })
    expect(
      moduleEnvelopeSchema.parse({
        module_id: UUID_A,
        page_id: UUID_B,
        locale: 'en',
        module_type: 'provenance',
        module_version: 1,
        source_refs: [{ type: 'source', id: UUID_C }],
        rights_state: 'first_party',
        generated_by: 'human',
        generator_version: null,
        content_hash: CONTENT_HASH_A,
        observed_at: UTC_NOW,
        expires_at: null,
        review_state: 'approved',
        schema_version: 1,
      }),
    ).toMatchObject({ module_type: 'provenance' })
    expect(
      publicationStateRecordSchema.parse({
        publish_version: 3,
        revision: 1,
        status: 'validated',
        reason_code: 'validation_complete',
        activated_at: null,
        updated_at: UTC_NOW,
        correlation_id: UUID_A,
      }),
    ).toMatchObject({ status: 'validated' })
    expect(
      activePublicationPointerSchema.parse({
        publish_version: 3,
        previous_verified_version: 2,
        revision: 4,
      }),
    ).toMatchObject({ revision: 4 })
    expect(
      deletionRequestSchema.parse({
        id: UUID_A,
        external_request_key: 'external-001',
        scope: 'artifact',
        requested_by: { type: 'user', id: UUID_B },
        legal_basis: 'Synthetic request',
        object_refs: [{ type: 'artifact', id: UUID_C }],
        deadline: null,
        state: 'received',
        reason_code: 'request_received',
        revision: 1,
      }),
    ).toMatchObject({ state: 'received' })
  })

  it('rejects nested unknown keys in canonical records', () => {
    expect(() =>
      activePublicationPointerSchema.parse({
        publish_version: 3,
        previous_verified_version: null,
        revision: 1,
        active: true,
      }),
    ).toThrow()
    expect(() =>
      deletionRequestSchema.parse({
        id: UUID_A,
        object_refs: [{ type: 'source', id: UUID_B, secret: 'nope' }],
      }),
    ).toThrow()
  })

  it('rejects workflow terminal-state output and error mismatches', () => {
    const base = {
      id: UUID_A,
      schema_version: 1,
      revision: 1,
      source_version: CONTENT_HASH_A,
      job_type: 'ingest',
      idempotency_key: 'synthetic-ingest-001',
      attempt: 1,
      input_ref: 'private/input/001',
      output_ref: null,
      error_class: null,
      created_at: UTC_NOW,
      updated_at: UTC_NOW,
      audit: {
        created_by: { type: 'service', id: UUID_B },
        updated_by: { type: 'service', id: UUID_B },
        correlation_id: UUID_C,
      },
    }

    expect(() => workflowRunSchema.parse({ ...base, status: 'succeeded' })).toThrow(/output_ref/)
    expect(() => workflowRunSchema.parse({ ...base, status: 'failed' })).toThrow(/error_class/)
    expect(() => workflowRunSchema.parse({ ...base, status: 'running', output_ref: 'private/output/001' })).toThrow(/output_ref/)
  })
})
