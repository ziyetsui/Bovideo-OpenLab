import { describe, expect, it } from 'vitest'

import { buildSanitizedExportFixture } from '@/exporter/local-fixture'

describe('P2-L local sanitized export fixture', () => {
  it('exports only an explicit allow-list and is deterministic', () => {
    const input = {
      records: [
        {
          id: 'first-party-001', status: 'approved', rights: 'first_party', source_url: 'https://example.com/source',
          source_hash: `sha256:v1:${'a'.repeat(64)}`, title: 'Synthetic first party', prompt: 'safe prompt',
          media_refs: ['media-1'], private_ref: '/Users/a1/private/raw.json', secret: 'sk-proj-never-export',
        },
        { id: 'candidate-001', status: 'candidate', rights: 'first_party', title: 'must not export', prompt: 'candidate' },
        { id: 'rejected-001', status: 'rejected', rights: 'first_party', title: 'must not export', prompt: 'rejected' },
      ],
    }
    const first = buildSanitizedExportFixture(input)
    const second = buildSanitizedExportFixture({ records: [...input.records].reverse() })
    expect(first.treeHash).toBe(second.treeHash)
    expect(first.files).toHaveLength(1)
    expect(first.files[0]!.bytes).not.toContain('sk-proj')
    expect(first.files[0]!.bytes).not.toContain('/Users')
    expect(first.files[0]!.bytes).not.toContain('private_ref')
    expect(first.files[0]!.bytes).not.toContain('media_refs')
    expect(first.excludedIds).toEqual(['candidate-001', 'rejected-001'])
  })

  it.each(['unknown', 'blocked', 'revoked', 'display_licensed'] as const)('fails closed for rights=%s', (rights) => {
    const result = buildSanitizedExportFixture({ records: [{ id: `record-${rights}`, status: 'approved', rights, prompt: 'restricted' }] })
    expect(result.files).toHaveLength(0)
  })

  it('exports metadata only for metadata_only and excludes unknown fields', () => {
    const result = buildSanitizedExportFixture({ records: [{ id: 'metadata-001', status: 'approved', rights: 'metadata_only', title: 'safe', source_hash: `sha256:v1:${'c'.repeat(64)}`, private_note: 'no', random_new_field: 'no' }] })
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.bytes).toContain('metadata-001')
    expect(result.files[0]!.bytes).toContain('metadata_only')
    expect(result.files[0]!.bytes).not.toContain('private_note')
    expect(result.files[0]!.bytes).not.toContain('random_new_field')
  })

  it('rejects unsafe ids instead of creating traversal paths', () => {
    expect(() => buildSanitizedExportFixture({ records: [{ id: '../escape', status: 'approved', rights: 'first_party' }] })).toThrow(/id|path|unsafe/i)
  })
})
