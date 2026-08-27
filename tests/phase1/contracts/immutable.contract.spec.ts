import {
  artifactSchema,
  assertArtifactMutationAllowed,
  assertAuditEventMutationAllowed,
  assertSnapshotMutationAllowed,
  auditEventSchema,
  localeVariantSchema,
  publicationSnapshotSchema,
} from '@/contracts/index'
import { describe, expect, it } from 'vitest'

import {
  CONTENT_HASH_A,
  UTC_NOW,
  UUID_A,
  UUID_B,
  UUID_C,
  localeVariantInput,
} from '../fixtures/contracts'

describe('immutable canonical contracts', () => {
  it('preserves prompt original text and its source relation', () => {
    const artifact = artifactSchema.parse({
      id: UUID_A,
      schema_version: 1,
      created_at: UTC_NOW,
      updated_at: UTC_NOW,
      kind: 'prompt',
      canonical_label: 'Synthetic prompt',
      source: { type: 'source', id: UUID_B },
      source_version: CONTENT_HASH_A,
      original_language: 'en',
      original_text: 'Do not translate this exact text.',
      rights_state: 'first_party',
      safety_state: 'approved',
      evidence_state: 'verified',
    })
    expect(() =>
      assertArtifactMutationAllowed(artifact, { ...artifact, original_text: 'Changed' }),
    ).toThrow()
    expect(() =>
      assertArtifactMutationAllowed(artifact, {
        ...artifact,
        source: { type: 'source', id: UUID_C },
      }),
    ).toThrow()
  })

  it('makes source versions and locale content revisions explicit', () => {
    expect(localeVariantSchema.parse(localeVariantInput)).toMatchObject({ content_revision: 1 })
    expect(() => localeVariantSchema.parse({ ...localeVariantInput, locale: 'en-US' })).toThrow()
    expect(() => localeVariantSchema.parse({ ...localeVariantInput, unknown: 'field' })).toThrow()
  })

  it('makes snapshot objects and audit events append-only', () => {
    const snapshot = publicationSnapshotSchema.parse({
      publish_version: 7,
      schema_version: 1,
      created_at: UTC_NOW,
      route_manifest_ref: 'published-snapshots/7/routes.json',
      sitemap_manifest_ref: 'published-snapshots/7/sitemap.json',
      github_manifest_ref: 'published-snapshots/7/github.json',
      content_tree_hash: CONTENT_HASH_A,
      previous_verified_version: 6,
      validation_report_ref: 'published-snapshots/7/validation.json',
    })
    expect(() =>
      assertSnapshotMutationAllowed(snapshot, {
        ...snapshot,
        content_tree_hash: CONTENT_HASH_A.replace('a', 'b'),
      }),
    ).toThrow()

    const audit = auditEventSchema.parse({
      event_id: '01J6R3W2V8W24Q10NRDBVGN3P9',
      occurred_at: UTC_NOW,
      actor: { type: 'user', id: UUID_B },
      correlation_id: UUID_C,
      causation_id: null,
      entity: { type: 'artifact', id: UUID_B },
      action: 'artifact.created',
      outcome: 'allowed',
      before: null,
      after: { status: 'draft' },
      reason_code: null,
    })
    expect(() => assertAuditEventMutationAllowed(audit, audit)).toThrow()
  })
})
