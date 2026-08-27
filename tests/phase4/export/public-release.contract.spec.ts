import { describe, expect, it } from 'vitest'

import {
  PUBLIC_RELEASE_ALLOW_LIST,
  buildPublicReleaseManifest,
  buildPublicReleasePoisonFixtures,
  scanPublicReleasePoisonFixtures,
  type PublicReleaseRecord,
} from '@/exporter/public-release'

const hash = `sha256:v1:${'a'.repeat(64)}` as `sha256:v1:${string}`
const full: PublicReleaseRecord = {
  id: 'record-full-001', status: 'approved', rights: 'first_party', slug: 'record-full', locale: 'en', page_type: 'detail',
  title: 'A safe title', description: 'A safe description', canonical: 'https://preview.example.test/en/prompts/record-full',
  source_hash: hash, source_url: 'https://source.example.test/item/1', prompt: 'A safe prompt', body: 'A safe body',
  media_refs: ['media-001'], media: [{ ref: 'media-001', kind: 'image', sha256: hash }],
}

describe('P4 public release allow-list exporter', () => {
  it('is deterministic and emits only explicitly allowed fields', () => {
    const first = buildPublicReleaseManifest({ releaseVersion: 1, records: [full, { ...full, id: 'record-metadata-001', rights: 'metadata_only', prompt: undefined, body: undefined, media_refs: undefined, media: undefined }] })
    const second = buildPublicReleaseManifest({ releaseVersion: 1, records: [{ ...full, extra_field: 'ignored by the allow-list' }, { ...full, id: 'record-metadata-001', rights: 'metadata_only', prompt: undefined, body: undefined, media_refs: undefined, media: undefined }] })
    expect(first.tree_hash).toBe(second.tree_hash)
    expect(first.included_ids).toEqual(['record-full-001', 'record-metadata-001'])
    expect(first.excluded).toEqual([])
    expect(JSON.parse(String(first.files[0]!.bytes))).toEqual(expect.objectContaining({ id: 'record-full-001', prompt: 'A safe prompt', media_refs: ['media-001'] }))
    expect(Object.keys(JSON.parse(String(first.files[0]!.bytes))).every((field) => (PUBLIC_RELEASE_ALLOW_LIST as readonly string[]).includes(field))).toBe(true)
  })

  it('removes text and media from metadata-only rows while keeping metadata', () => {
    const result = buildPublicReleaseManifest({ releaseVersion: 2, records: [{ id: 'metadata-only-001', status: 'approved', rights: 'metadata_only', title: 'Metadata title', description: 'Metadata description' }] })
    expect(result.included_ids).toEqual(['metadata-only-001'])
    expect(JSON.parse(String(result.files[0]!.bytes))).toEqual({ description: 'Metadata description', id: 'metadata-only-001', rights: 'metadata_only', title: 'Metadata title' })
  })

  it('blocks the complete deterministic poison corpus', () => {
    const scan = scanPublicReleasePoisonFixtures()
    expect(buildPublicReleasePoisonFixtures()).toHaveLength(20)
    expect(scan).toMatchObject({ total: 20, blocked: 20, passed: 0, status: 'PASS' })
    expect(() => buildPublicReleaseManifest({ releaseVersion: 3, records: [], poisonFixtures: [{ id: 'poison-override', status: 'approved', rights: 'first_party', title: 'safe' }] })).toThrow(/poison/i)
  })

  it('blocks PII in an allow-listed slug and credentials in canonical URLs', () => {
    const result = buildPublicReleaseManifest({ releaseVersion: 4, records: [
      { ...full, id: 'poison-slug-001', slug: 'person@real.example.net' },
      { ...full, id: 'poison-url-001', canonical: 'https://public.example/item?token=secret' },
    ] })
    expect(result.included_ids).toEqual([])
    expect(result.excluded.map((finding) => finding.id)).toEqual(['poison-slug-001', 'poison-url-001'])
  })
})
