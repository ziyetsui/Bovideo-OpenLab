export const UUID_A = '018f8f41-6dc0-7b5e-8d93-22d8f7a64b6c'
export const UUID_B = '018f8f41-6dc0-7b5e-8d93-22d8f7a64b6d'
export const UUID_C = '018f8f41-6dc0-7b5e-8d93-22d8f7a64b6e'
export const UUID_D = '018f8f41-6dc0-7b5e-8d93-22d8f7a64b6f'

export const CONTENT_HASH_A = `sha256:v1:${'a'.repeat(64)}`
export const CONTENT_HASH_B = `sha256:v1:${'b'.repeat(64)}`
export const UTC_NOW = '2026-08-23T12:34:56.000Z'
const NULL: null = null

export const sourceInput = {
  id: UUID_A,
  schema_version: 1,
  created_at: UTC_NOW,
  updated_at: UTC_NOW,
  provider: 'first_party',
  provider_record_id: 'record-001',
  canonical_url: 'https://example.test/source/record-001',
  raw_ref: {
    namespace: 'raw-evidence',
    bucket_class: 'private_raw',
    key: `sha256/aa/${'a'.repeat(64)}`,
    content_hash: CONTENT_HASH_A,
    version: 'v1',
    size_bytes: 21,
    mime_type: 'application/json',
    rights_state: 'first_party',
    deletion_state: 'active',
  },
  captured_at: UTC_NOW,
  content_hash: CONTENT_HASH_A,
  supersedes_source_ref: NULL,
  author_ref: NULL,
  rights_state: 'first_party',
  rights_basis: 'Synthetic first-party fixture',
  deletion_state: 'active',
  audit: {
    created_by: { type: 'service', id: UUID_B },
    updated_by: { type: 'service', id: UUID_B },
    correlation_id: UUID_C,
  },
} as const

export const localeVariantInput = {
  id: UUID_A,
  schema_version: 1,
  created_at: UTC_NOW,
  updated_at: UTC_NOW,
  entity_ref: { type: 'artifact', id: UUID_B },
  locale: 'zh-CN',
  source_locale: 'en',
  source_version: CONTENT_HASH_A,
  translation_model: 'gpt-4.1-2025-04-14',
  translation_prompt_version: 'v1',
  localized_fields: { title: 'Synthetic title' },
  risk_classes: [],
  workflow_state: 'machine_draft',
  content_revision: 1,
  last_content_editor: { type: 'user', id: UUID_C },
  reviewed_by: NULL,
  reviewed_at: NULL,
  published_version: NULL,
} as const
