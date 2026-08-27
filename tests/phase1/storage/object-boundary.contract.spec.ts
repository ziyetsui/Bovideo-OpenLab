import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildContentAddressedKey,
  objectRefSchema,
  toPublicObjectReference,
  assertNoRestrictedObjectRefs,
  type ObjectRef,
} from '@/storage/object-ref'
import { decideObjectAccess } from '@/storage/policy'
import { LocalObjectStore } from '@/storage/local-object-store'
import { validateObjectUpload } from '@/storage/upload-validation'
import { principals } from '@/access/principals'
import { describe, expect, it } from 'vitest'

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)
const contentHash = (value: Uint8Array): string =>
  `sha256:v1:${createHash('sha256').update(value).digest('hex')}`
const png = (): Uint8Array => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'))
const pngSentinel = (): Uint8Array => new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
])
const jpeg = (): Uint8Array => new Uint8Array([
  0xff, 0xd8,
  0xff, 0xdb, 0, 67, 0, ...Array(64).fill(1),
  0xff, 0xc4, 0, 20, 0, 1, ...Array(15).fill(0), 0,
  0xff, 0xc4, 0, 20, 0x10, 1, ...Array(15).fill(0), 0,
  0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0,
  0x2a, 0xff, 0xd9,
])
const jpegSentinel = (): Uint8Array => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9])
const gif = (): Uint8Array => new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'))
const gifSentinel = (): Uint8Array => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0, 0x3b])
const webp = (): Uint8Array => new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 12, 0, 0, 0, 0x80, 1, 0, 0x9d, 1, 0x2a, 1, 0, 1, 0, 0x55, 0xaa,
])
const be32 = (value: number): number[] => [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const mp4Box = (type: string, payload: readonly number[]): number[] => [...be32(payload.length + 8), ...bytes(type), ...payload]
type Mp4FixtureOptions = Readonly<{ stsd_entries?: number; stts_entries?: number; stsc_entries?: number; stsz_entries?: number; stco_entries?: number; sample_size?: number; dangling_offset?: boolean; sample_entry_type?: 'avc1' | 'hvc1'; avcc?: readonly number[] }>
const mp4 = (options: Mp4FixtureOptions = {}): Uint8Array => {
  const entryCount = options.stsd_entries ?? 1
  const sttsEntries = options.stts_entries ?? 1
  const stscEntries = options.stsc_entries ?? 1
  const stszEntries = options.stsz_entries ?? 1
  const stcoEntries = options.stco_entries ?? 1
  const sampleSize = options.sample_size ?? 4
  const mvhd = Array(100).fill(0); mvhd[12] = 0; mvhd[13] = 0; mvhd[14] = 3; mvhd[15] = 0xe8; mvhd[19] = 1; mvhd[20] = 0; mvhd[21] = 1; mvhd[24] = 1; mvhd[28] = 1; mvhd[36] = 1; mvhd[52] = 1; mvhd[68] = 1; mvhd[99] = 2
  const mdhd = Array(24).fill(0); mdhd[12] = 0; mdhd[13] = 0; mdhd[14] = 3; mdhd[15] = 0xe8; mdhd[19] = 1
  const tkhd = Array(84).fill(0); tkhd[15] = 1; tkhd[23] = 1; tkhd[39] = 1; tkhd[79] = 1; tkhd[83] = 1
  const visual = Array(78).fill(0); visual[7] = 1; visual[25] = 1; visual[27] = 1; visual[75] = 24
  // AVCDecoderConfigurationRecord with one SPS (type 7) and one PPS (type 8).
  const avcC = options.avcc ?? [1, 66, 0, 30, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0, 0x1e, 1, 0, 4, 0x68, 0xce, 6, 0xe2]
  const avc1 = mp4Box(options.sample_entry_type ?? 'avc1', [...visual, ...mp4Box('avcC', avcC)])
  const stsd = mp4Box('stsd', [0, 0, 0, 0, ...be32(entryCount), ...(entryCount === 0 ? [] : avc1)])
  const stts = mp4Box('stts', [0, 0, 0, 0, ...be32(sttsEntries), ...(sttsEntries === 0 ? [] : [...be32(1), ...be32(1000)])])
  const stsc = mp4Box('stsc', [0, 0, 0, 0, ...be32(stscEntries), ...(stscEntries === 0 ? [] : [...be32(1), ...be32(1), ...be32(1)])])
  const stsz = mp4Box('stsz', [0, 0, 0, 0, ...be32(0), ...be32(stszEntries), ...(stszEntries === 0 ? [] : be32(sampleSize))])
  const buildMoov = (chunkOffset: number): number[] => {
    const stco = mp4Box('stco', [0, 0, 0, 0, ...be32(stcoEntries), ...(stcoEntries === 0 ? [] : be32(chunkOffset))])
    const stbl = mp4Box('stbl', [...stsd, ...stts, ...stsc, ...stsz, ...stco])
    const mdia = mp4Box('mdia', [...mp4Box('mdhd', mdhd), ...mp4Box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...bytes('vide')]), ...mp4Box('minf', stbl)])
    return mp4Box('moov', [...mp4Box('mvhd', mvhd), ...mp4Box('trak', [...mp4Box('tkhd', tkhd), ...mdia])])
  }
  const ftyp = mp4Box('ftyp', [...bytes('isom'), 0, 0, 0, 0, ...bytes('isom')])
  const provisional = buildMoov(0)
  const chunkOffset = ftyp.length + provisional.length + 8 + (options.dangling_offset ? 1 : 0)
  return new Uint8Array([...ftyp, ...buildMoov(chunkOffset), ...mp4Box('mdat', [1, 2, 3, 4])])
}
const mp4Sentinel = (): Uint8Array => new Uint8Array([0, 0, 0, 20, ...bytes('ftyp'), ...bytes('isom'), 0, 0, 0, 0, ...bytes('isom'), 0, 0, 0, 20, ...bytes('moov'), 0, 0, 0, 12, ...bytes('mvhd'), 0, 0, 0, 0, 0, 0, 0, 8, ...bytes('mdat')])
type FixtureBox = Readonly<{ type: string; payload: number; end: number }>
const fixtureBoxes = (body: Uint8Array, start: number, end: number): readonly FixtureBox[] => {
  const boxes: FixtureBox[] = []
  for (let offset = start; offset < end;) {
    const size = (body[offset]! * 0x1000000) + (body[offset + 1]! * 0x10000) + (body[offset + 2]! * 0x100) + body[offset + 3]!
    if (size < 8 || offset + size > end) throw new Error('fixture box is malformed')
    boxes.push({ type: String.fromCharCode(...body.slice(offset + 4, offset + 8)), payload: offset + 8, end: offset + size })
    offset += size
  }
  return boxes
}
const fixtureBox = (body: Uint8Array, parent: FixtureBox | undefined, type: string): FixtureBox => {
  const found = fixtureBoxes(body, parent?.payload ?? 0, parent?.end ?? body.byteLength).filter((box) => box.type === type)
  if (found.length !== 1) throw new Error(`fixture has no unique ${type}`)
  return found[0]!
}

const ref = (overrides: Partial<ObjectRef> = {}): ObjectRef => {
  const body = bytes('synthetic object body')
  const hash = contentHash(body)
  return {
    namespace: 'raw-evidence',
    bucket_class: 'private_raw',
    key: buildContentAddressedKey('raw-evidence', hash),
    content_hash: hash,
    version: 'v1',
    size_bytes: body.byteLength,
    mime_type: 'application/json',
    rights_state: 'unknown',
    deletion_state: 'active',
    ...overrides,
  }
}

describe('P1-T04 object reference boundary', () => {
  it('accepts only canonical normalized object refs and content-addressed raw keys', () => {
    const raw = ref()
    expect(objectRefSchema.parse(raw)).toEqual(raw)
    expect(raw.key).toBe(`sha256/${raw.content_hash.slice('sha256:v1:'.length, 'sha256:v1:'.length + 2)}/${raw.content_hash.slice('sha256:v1:'.length)}`)

    for (const key of [
      '../private',
      'a/../../private',
      'a\\private',
      'a/%2e%2e/private',
      'a/%252e%252e/private',
      'https://bucket.example/private',
      '/absolute/private',
      'a//private',
      'a/\u0000private',
      'raw/not-content-addressed',
    ]) {
      expect(() => objectRefSchema.parse({ ...raw, key })).toThrow()
    }
    expect(() => objectRefSchema.parse({ ...raw, content_hash: 'sha256:v1:ABC' })).toThrow()
    expect(() => objectRefSchema.parse({ ...raw, unexpected: true })).toThrow()
  })

  it('decides principal × namespace × action fail-closed and freezes its decision', () => {
    const raw = ref()
    const review = ref({
      namespace: 'review-media', bucket_class: 'private_review', key: 'review/aa/synthetic.png',
      mime_type: 'image/png', rights_state: 'display_licensed',
    })
    const snapshot = ref({
      namespace: 'published-snapshots', bucket_class: 'worker_snapshot', key: 'publish/v7/pages.json',
      version: 'v7', mime_type: 'application/json', rights_state: 'first_party',
    })
    const publicMedia = ref({
      namespace: 'public-media', bucket_class: 'worker_public', key: 'media/aa/synthetic.png',
      mime_type: 'image/png', rights_state: 'first_party',
    })

    expect(decideObjectAccess({ principal: principals.ingestService, ref: raw, action: 'write', channel: 'internal' })).toMatchObject({ allowed: true, reason: 'allowed' })
    expect(decideObjectAccess({ principal: principals.ingestService, ref: review, action: 'read', channel: 'internal' })).toMatchObject({ allowed: false })
    expect(decideObjectAccess({ principal: principals.reviewer, ref: review, action: 'write', channel: 'internal' })).toMatchObject({ allowed: true })
    expect(decideObjectAccess({ principal: principals.publishService, ref: snapshot, action: 'write', channel: 'internal' })).toMatchObject({ allowed: true })
    expect(decideObjectAccess({ principal: principals.publishService, ref: snapshot, action: 'delete', channel: 'internal' })).toMatchObject({ allowed: false, reason: 'default_deny' })
    expect(decideObjectAccess({ principal: principals.publishService, ref: publicMedia, action: 'write', channel: 'internal' })).toMatchObject({ allowed: true })
    expect(decideObjectAccess({ principal: principals.anonymous, ref: raw, action: 'read', channel: 'direct' })).toEqual({ allowed: false, reason: 'direct_access_denied' })
    expect(decideObjectAccess({ principal: principals.publisher, ref: raw, action: 'read', channel: 'direct' })).toEqual({ allowed: false, reason: 'direct_access_denied' })
    expect(decideObjectAccess({ principal: { id: 'public-worker', kind: 'public_worker' }, ref: snapshot, action: 'read', channel: 'internal', active_snapshot_version: 'v6' })).toMatchObject({ allowed: false, reason: 'snapshot_not_active' })

    const decision = decideObjectAccess({ principal: principals.ingestService, ref: raw, action: 'read', channel: 'internal' })
    expect(Object.isFrozen(decision)).toBe(true)
  })

  it('allows public media only with exact eligible rights and active deletion state', () => {
    const publicMedia = ref({
      namespace: 'public-media', bucket_class: 'worker_public', key: 'media/aa/synthetic.png', mime_type: 'image/png',
      rights_state: 'first_party',
    })
    const publicWorker = { id: 'public-worker', kind: 'public_worker' as const }
    expect(decideObjectAccess({ principal: publicWorker, ref: publicMedia, action: 'read', channel: 'internal' })).toMatchObject({ allowed: true })
    for (const rights_state of ['display_licensed', 'unknown'] as const) {
      expect(decideObjectAccess({ principal: publicWorker, ref: { ...publicMedia, rights_state }, action: 'read', channel: 'internal' })).toMatchObject({ allowed: false, reason: 'public_rights_denied' })
    }
    expect(decideObjectAccess({ principal: publicWorker, ref: { ...publicMedia, rights_state: 'revoked' }, action: 'read', channel: 'internal' })).toMatchObject({ allowed: false, reason: 'deleted_or_revoked' })
    expect(decideObjectAccess({ principal: publicWorker, ref: { ...publicMedia, deletion_state: 'removed' }, action: 'read', channel: 'internal' })).toMatchObject({ allowed: false, reason: 'deleted_or_revoked' })
  })

  it('denies anonymous direct reads across 100 synthetic restricted keys locally', () => {
    for (let index = 0; index < 100; index += 1) {
      const hash = `sha256:v1:${index.toString(16).padStart(64, 'a')}`
      const synthetic = ref({ content_hash: hash, key: buildContentAddressedKey('raw-evidence', hash) })
      expect(decideObjectAccess({ principal: principals.anonymous, ref: synthetic, action: 'read', channel: 'direct' }))
        .toEqual({ allowed: false, reason: 'direct_access_denied' })
    }
  })

  it('validates size, SHA-256, MIME magic bytes, and rejects polyglot uploads', () => {
    const validPng = png()
    const hash = contentHash(validPng)
    expect(validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.png', bytes: validPng, declared_size: validPng.byteLength, declared_hash: hash, declared_mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' })).toMatchObject({ computed_hash: hash, mime_type: 'image/png' })
    expect(() => validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.png', bytes: validPng, declared_size: validPng.byteLength + 1, declared_hash: hash, declared_mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' })).toThrow(/size/)
    expect(() => validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.png', bytes: validPng, declared_size: validPng.byteLength, declared_hash: `sha256:v1:${'0'.repeat(64)}`, declared_mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' })).toThrow(/hash/)
    expect(() => validateObjectUpload({ namespace: 'review-media', key: 'review/aa/synthetic.jpg', bytes: validPng, declared_size: validPng.byteLength, declared_hash: hash, declared_mime_type: 'image/jpeg', rights_state: 'display_licensed', deletion_state: 'active' })).toThrow(/MIME/)
    const polyglot = new Uint8Array([...validPng, ...bytes('<script>evil()</script>')])
    expect(() => validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.png', bytes: polyglot, declared_size: polyglot.byteLength, declared_hash: contentHash(polyglot), declared_mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' })).toThrow(/polyglot|format/)
    expect(() => validateObjectUpload({ namespace: 'public-media', key: 'media/aa/synthetic.png', bytes: validPng, declared_size: validPng.byteLength, declared_hash: hash, declared_mime_type: 'image/png', rights_state: 'display_licensed', deletion_state: 'active' })).toThrow(/rights/)
  })

  it('accepts only bounded complete public-media containers and rejects malformed lookalikes', () => {
    const media = [
      ['image/png', 'media/aa/valid.png', png()],
      ['image/jpeg', 'media/aa/valid.jpg', jpeg()],
      ['image/gif', 'media/aa/valid.gif', gif()],
      ['image/webp', 'media/aa/valid.webp', webp()],
      ['video/mp4', 'media/aa/valid.mp4', mp4()],
    ] as const
    for (const [mime, key, body] of media) {
      expect(validateObjectUpload({ namespace: 'public-media', key, bytes: body, declared_size: body.byteLength, declared_hash: contentHash(body), declared_mime_type: mime, rights_state: 'first_party', deletion_state: 'active' })).toMatchObject({ mime_type: mime })
    }

    const malformed = [
      ['image/png', 'media/aa/no-idat.png', pngSentinel()],
      ['image/png', 'media/aa/truncated.png', png().slice(0, -1)],
      ['image/png', 'media/aa/oversized.png', new Uint8Array([...png().slice(0, 8), 0x7f, 0xff, 0xff, 0xff, ...png().slice(12)])],
      ['image/png', 'media/aa/trailing.png', new Uint8Array([...png(), 0x50, 0x4b, 3, 4])],
      ['image/jpeg', 'media/aa/no-sos.jpg', new Uint8Array([...jpeg().slice(0, -5), 0xff, 0xd9])],
      ['image/jpeg', 'media/aa/sentinel.jpg', jpegSentinel()],
      ['image/jpeg', 'media/aa/oversized.jpg', new Uint8Array([...jpeg().slice(0, 4), 0xff, 0xff, ...jpeg().slice(6)])],
      ['image/jpeg', 'media/aa/trailing.jpg', new Uint8Array([...jpeg(), 0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74])],
      ['image/gif', 'media/aa/no-trailer.gif', gif().slice(0, -1)],
      ['image/gif', 'media/aa/sentinel.gif', gifSentinel()],
      ['image/gif', 'media/aa/oversized.gif', new Uint8Array([...gif().slice(0, 30), 0xff, ...gif().slice(31)])],
      ['image/gif', 'media/aa/trailing.gif', new Uint8Array([...gif(), 0x4d, 0x5a])],
      ['image/webp', 'media/aa/bad-length.webp', new Uint8Array([...webp().slice(0, 4), 0xff, 0xff, 0xff, 0x7f, ...webp().slice(8)])],
      ['image/webp', 'media/aa/oversized.webp', new Uint8Array([...webp().slice(0, 16), 0xff, 0xff, 0xff, 0x7f, ...webp().slice(20)])],
      ['image/webp', 'media/aa/sentinel-frame.webp', new Uint8Array([...webp().slice(0, 20), 0, 0, 0, ...webp().slice(23)])],
      ['image/webp', 'media/aa/sentinel.webp', new Uint8Array([...webp().slice(0, 20), 1, 2, 3, 4, 5, 6])],
      ['video/mp4', 'media/aa/no-media.mp4', mp4().slice(0, 20)],
      ['video/mp4', 'media/aa/sentinel.mp4', mp4Sentinel()],
      ['video/mp4', 'media/aa/no-stsd-entry.mp4', mp4({ stsd_entries: 0 })],
      ['video/mp4', 'media/aa/no-stts-entry.mp4', mp4({ stts_entries: 0 })],
      ['video/mp4', 'media/aa/no-stsc-entry.mp4', mp4({ stsc_entries: 0 })],
      ['video/mp4', 'media/aa/no-stsz-entry.mp4', mp4({ stsz_entries: 0 })],
      ['video/mp4', 'media/aa/no-stco-entry.mp4', mp4({ stco_entries: 0 })],
      ['video/mp4', 'media/aa/dangling-offset.mp4', mp4({ dangling_offset: true })],
      ['video/mp4', 'media/aa/sample-overruns-mdat.mp4', mp4({ sample_size: 5 })],
      ['video/mp4', 'media/aa/overflowing-sample-size.mp4', mp4({ sample_size: 0xffff_ffff })],
      ['video/mp4', 'media/aa/unsupported-sample-entry.mp4', mp4({ sample_entry_type: 'hvc1' })],
      ['video/mp4', 'media/aa/avcc-truncated.mp4', mp4({ avcc: [1, 66, 0, 30, 0xff, 0xe1, 0, 4, 0x67] })],
      ['video/mp4', 'media/aa/avcc-no-sps.mp4', mp4({ avcc: [1, 66, 0, 30, 0xff, 0xe0] })],
      ['video/mp4', 'media/aa/avcc-zero-sps-length.mp4', mp4({ avcc: [1, 66, 0, 30, 0xff, 0xe1, 0, 0, 1, 0, 1, 0x68] })],
      ['video/mp4', 'media/aa/avcc-wrong-sps-type.mp4', mp4({ avcc: [1, 66, 0, 30, 0xff, 0xe1, 0, 1, 0x68, 1, 0, 1, 0x68] })],
      ['video/mp4', 'media/aa/avcc-no-pps.mp4', mp4({ avcc: [1, 66, 0, 30, 0xff, 0xe1, 0, 1, 0x67, 0] })],
      ['video/mp4', 'media/aa/avcc-wrong-pps-type.mp4', mp4({ avcc: [1, 66, 0, 30, 0xff, 0xe1, 0, 1, 0x67, 1, 0, 1, 0x67] })],
      ['video/mp4', 'media/aa/avcc-trailing.mp4', mp4({ avcc: [1, 66, 0, 30, 0xff, 0xe1, 0, 1, 0x67, 1, 0, 1, 0x68, 0] })],
      ['video/mp4', 'media/aa/oversized.mp4', new Uint8Array([...mp4().slice(0, 20), 0x7f, 0xff, 0xff, 0xff, ...mp4().slice(24)])],
      ['video/mp4', 'media/aa/trailing.mp4', new Uint8Array([...mp4(), 0x50, 0x4b, 3, 4])],
    ] as const
    for (const [mime, key, body] of malformed) {
      expect(() => validateObjectUpload({ namespace: 'public-media', key, bytes: body, declared_size: body.byteLength, declared_hash: contentHash(body), declared_mime_type: mime, rights_state: 'first_party', deletion_state: 'active' }), key).toThrow(/format|magic|polyglot/)
    }
  })

  it('maps the known MP4 fixture sample independently into its mdat payload', () => {
    const body = mp4()
    const moov = fixtureBox(body, undefined, 'moov')
    const mdat = fixtureBox(body, undefined, 'mdat')
    const stbl = fixtureBox(body, fixtureBox(body, fixtureBox(body, fixtureBox(body, moov, 'trak'), 'mdia'), 'minf'), 'stbl')
    const stsd = fixtureBox(body, stbl, 'stsd')
    const stsz = fixtureBox(body, stbl, 'stsz')
    const stco = fixtureBox(body, stbl, 'stco')
    expect((body[stsd.payload + 4]! * 0x1000000) + body[stsd.payload + 7]!).toBe(1)
    expect((body[stsz.payload + 8]! * 0x1000000) + body[stsz.payload + 11]!).toBe(1)
    const sampleSize = (body[stsz.payload + 12]! * 0x1000000) + body[stsz.payload + 15]!
    const chunkOffset = (body[stco.payload + 8]! * 0x1000000) + (body[stco.payload + 9]! * 0x10000) + (body[stco.payload + 10]! * 0x100) + body[stco.payload + 11]!
    expect(chunkOffset).toBe(mdat.payload)
    expect(chunkOffset + sampleSize).toBe(mdat.end)
  })

  it('stores only within its private root, verifies content, is idempotent, and records deletion ledger entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-t04-'))
    const body = bytes('synthetic object body')
    const raw = ref()
    const ledger: unknown[] = []
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'object-boundary-signer', on_delete: (entry) => { ledger.push(entry) } })
    try {
      await expect(store.write({ principal: principals.ingestService, ref: raw, bytes: body })).resolves.toMatchObject({ content_hash: raw.content_hash })
      await expect(store.write({ principal: principals.ingestService, ref: raw, bytes: body })).resolves.toMatchObject({ content_hash: raw.content_hash })
      await expect(store.write({ principal: principals.ingestService, ref: raw, bytes: bytes('other synthetic thing') })).rejects.toThrow(/hash|collision/i)
      await expect(store.get({ principal: principals.anonymous, ref: raw })).rejects.toThrow(/denied/)
      await expect(store.get({ principal: principals.ingestService, ref: raw })).resolves.toMatchObject({ bytes: body })
      await expect(store.delete({ principal: principals.ingestService, ref: raw, reason: 'synthetic_withdrawal' })).resolves.toBeUndefined()
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ namespace: 'raw-evidence', content_hash: raw.content_hash, reason: 'synthetic_withdrawal' })
      await expect(store.head({ principal: principals.ingestService, ref: raw })).rejects.toThrow(/deleted|revoked/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('issues short-lived signed read capability objects, never URLs, and rejects replay/scope mistakes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-t04-capability-'))
    const body = bytes('synthetic object body')
    const raw = ref()
    let now = Date.parse('2026-08-23T00:00:00.000Z')
    const store = new LocalObjectStore({ root_dir: root, now: () => now, signer_secret: 'synthetic-signing-secret' })
    try {
      await store.write({ principal: principals.ingestService, ref: raw, bytes: body })
      const capability = await store.issueReadCapability({ issuer: principals.ingestService, ref: raw, principal_id: 'reviewer-1', correlation_id: 'corr-1', ttl_ms: 60_000 })
      expect(capability).toMatchObject({ namespace: raw.namespace, key: raw.key, content_hash: raw.content_hash, action: 'read', principal_id: 'reviewer-1', correlation_id: 'corr-1' })
      expect(JSON.stringify(capability)).not.toContain('http')
      await expect(store.get({ principal: principals.reviewer, ref: raw, capability, correlation_id: 'corr-1' })).resolves.toMatchObject({ bytes: body })
      await expect(store.get({ principal: principals.reviewer, ref: raw, capability, correlation_id: 'corr-1' })).rejects.toThrow(/replay/)
      const second = await store.issueReadCapability({ issuer: principals.ingestService, ref: raw, principal_id: 'reviewer-1', correlation_id: 'corr-2', ttl_ms: 60_000 })
      await expect(store.get({ principal: principals.editor, ref: raw, capability: second, correlation_id: 'corr-2' })).rejects.toThrow(/principal/)
      await expect(store.get({ principal: principals.reviewer, ref: raw, capability: { ...second, action: 'write' } as never, correlation_id: 'corr-2' })).rejects.toThrow(/scope/)
      now += 60_001
      await expect(store.get({ principal: principals.reviewer, ref: raw, capability: second, correlation_id: 'corr-2' })).rejects.toThrow(/expired/)
      await expect(store.issueReadCapability({ issuer: principals.ingestService, ref: raw, principal_id: 'reviewer-1', correlation_id: 'corr-3', ttl_ms: 300_001 })).rejects.toThrow(/TTL/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never serializes restricted refs into public-like response, artifact, or queue shapes', () => {
    const raw = ref()
    const publicMedia = ref({
      namespace: 'public-media', bucket_class: 'worker_public', key: 'media/aa/synthetic.png', mime_type: 'image/png', rights_state: 'first_party',
    })
    expect(() => assertNoRestrictedObjectRefs({ response: { evidence: raw } })).toThrow(/restricted/i)
    expect(() => assertNoRestrictedObjectRefs({ artifact: { media: raw } })).toThrow(/restricted/i)
    expect(() => assertNoRestrictedObjectRefs({ queue: { ref: raw } })).toThrow(/restricted/i)
    expect(toPublicObjectReference(publicMedia)).toEqual({ namespace: 'public-media', content_hash: publicMedia.content_hash, version: 'v1', mime_type: 'image/png', size_bytes: publicMedia.size_bytes })
    expect(() => toPublicObjectReference(raw)).toThrow(/restricted/i)
  })
})
