import { createHash } from 'node:crypto'

import { Media } from '@/collections/Media'
import { Sources } from '@/collections/Sources'
import { buildContentAddressedKey, type ObjectRef } from '@/storage/object-ref'
import { describe, expect, it } from 'vitest'

const contentHash = `sha256:v1:${createHash('sha256').update('synthetic object body').digest('hex')}`
const rawRef: ObjectRef = {
  namespace: 'raw-evidence',
  bucket_class: 'private_raw',
  key: buildContentAddressedKey('raw-evidence', contentHash),
  content_hash: contentHash,
  version: 'v1',
  size_bytes: 21,
  mime_type: 'application/json',
  rights_state: 'unknown',
  deletion_state: 'active',
}
const publicMediaRef: ObjectRef = {
  ...rawRef,
  namespace: 'public-media',
  bucket_class: 'worker_public',
  key: 'media/aa/synthetic.png',
  mime_type: 'image/png',
  rights_state: 'first_party',
}

const field = (collection: { fields: unknown[] }, name: string) =>
  (collection.fields as Array<{ name?: string; type?: string; required?: boolean; validate?: (value: unknown, options: unknown) => true | string; access?: unknown }>)
    .find((candidate) => candidate.name === name)

describe('P1-T04 Payload ObjectRef persistence fields', () => {
  it('persists source raw evidence only as a canonical private ObjectRef', () => {
    const raw = field(Sources, 'raw_ref')
    expect(raw).toMatchObject({ type: 'json', required: true })
    expect(raw?.validate?.(rawRef, { siblingData: { content_hash: rawRef.content_hash } })).toBe(true)
    expect(raw?.validate?.(rawRef, { siblingData: { content_hash: `sha256:v1:${'b'.repeat(64)}` } })).toMatch(/content hash/)
    expect(raw?.validate?.({ ...rawRef, key: '../raw' }, { siblingData: { content_hash: rawRef.content_hash } })).toMatch(/canonical ObjectRef/)
    expect(raw?.access).toBeDefined()
  })

  it('persists media only as a canonical ObjectRef and disables local URL storage', () => {
    const objectRef = field(Media, 'object_ref')
    expect(objectRef).toMatchObject({ type: 'json', required: true })
    expect(objectRef?.validate?.(publicMediaRef, {})).toBe(true)
    expect(objectRef?.validate?.({ ...publicMediaRef, rights_state: 'display_licensed' }, {})).toMatch(/canonical ObjectRef/)
    expect(objectRef?.access).toBeDefined()
    expect(Media.upload).toMatchObject({ disableLocalStorage: true })
  })
})
