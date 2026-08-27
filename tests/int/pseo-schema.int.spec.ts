import config from '@/payload.config'
import { migrations } from '@/migrations'

import { describe, expect, it } from 'vitest'

const requiredCollections = [
  'sources',
  'prompt-artifacts',
  'taxonomy-nodes',
  'page-records',
  'locale-variants',
  'edges',
  'audit-events',
] as const

const fieldNames = (fields: unknown): string[] => {
  if (!Array.isArray(fields)) return []

  return fields.flatMap((field) => {
    if (typeof field !== 'object' || field === null) return []

    const candidate = field as { fields?: unknown; name?: unknown }
    return [
      ...(typeof candidate.name === 'string' ? [candidate.name] : []),
      ...fieldNames(candidate.fields),
    ]
  })
}

describe('pSEO Payload schema', () => {
  it('registers every Phase 0 production-shaped collection', async () => {
    const payloadConfig = await config
    const slugs = payloadConfig.collections.map((collection) => collection.slug)

    expect(slugs).toEqual(expect.arrayContaining([...requiredCollections]))
  })

  it('gives every pSEO collection immutable identity, provenance, state, and audit fields', async () => {
    const payloadConfig = await config

    for (const slug of requiredCollections) {
      const collection = payloadConfig.collections.find((candidate) => candidate.slug === slug)
      expect(collection).toBeDefined()

      const names = fieldNames(collection?.fields ?? [])
      expect(names).toEqual(
        expect.arrayContaining(['stable_id', 'schema_version', 'source_version', 'status', 'audit']),
      )
    }
  })

  it('models rights, locale, relationship, and page-publication state as first-class fields', async () => {
    const payloadConfig = await config
    const fieldsFor = (slug: (typeof requiredCollections)[number]) => {
      const collection = payloadConfig.collections.find((candidate) => candidate.slug === slug)
      return fieldNames(collection?.fields ?? [])
    }

    expect(fieldsFor('sources')).toEqual(
      expect.arrayContaining(['provider', 'provider_record_id', 'content_hash', 'rights_state']),
    )
    expect(fieldsFor('prompt-artifacts')).toEqual(
      expect.arrayContaining(['original_text', 'source', 'rights_state', 'safety_state', 'evidence_state']),
    )
    expect(fieldsFor('taxonomy-nodes')).toEqual(
      expect.arrayContaining(['stable_key', 'node_type', 'promotion_state']),
    )
    expect(fieldsFor('page-records')).toEqual(
      expect.arrayContaining(['page_type', 'root_object', 'index_state', 'qualification_score']),
    )
    expect(fieldsFor('locale-variants')).toEqual(
      expect.arrayContaining(['entity', 'locale', 'workflow_state', 'localized_fields']),
    )
    expect(fieldsFor('edges')).toEqual(
      expect.arrayContaining(['from', 'to', 'relation', 'review_state', 'evidence']),
    )
    expect(fieldsFor('audit-events')).toEqual(
      expect.arrayContaining(['actor_user', 'actor_stable_id', 'correlation_id', 'prior_state', 'new_state', 'occurred_at']),
    )
  })

  it('registers the generated Phase 0 schema migration for production runtime use', () => {
    expect(migrations.some((migration) => migration.name.endsWith('_pseo_phase0_schema'))).toBe(true)
  })
})
