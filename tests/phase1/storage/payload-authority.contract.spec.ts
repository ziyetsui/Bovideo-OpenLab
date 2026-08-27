import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { principals } from '@/access/principals'
import { LocalObjectStore } from '@/storage/local-object-store'
import { buildContentAddressedKey, type ObjectRef } from '@/storage/object-ref'
import { createObjectAuthority, createObjectIngressCommand, hasObjectAuthority, requireTrustedObjectRef, withObjectAuthority } from '@/storage/payload-object-authority'
import { describe, expect, it } from 'vitest'

const bytes = new TextEncoder().encode('authority fixture')
const contentHash = `sha256:v1:${createHash('sha256').update(bytes).digest('hex')}`
const rawRef: ObjectRef = { namespace: 'raw-evidence', bucket_class: 'private_raw', key: buildContentAddressedKey('raw-evidence', contentHash), content_hash: contentHash, version: 'v1', size_bytes: bytes.byteLength, mime_type: 'application/json', rights_state: 'first_party', deletion_state: 'active' }
const pngBytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'))
const mediaHash = `sha256:v1:${createHash('sha256').update(pngBytes).digest('hex')}`
const mediaRef: ObjectRef = { namespace: 'public-media', bucket_class: 'worker_public', key: 'media/aa/authority.png', content_hash: mediaHash, version: 'v1', size_bytes: pngBytes.byteLength, mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' }

describe('P1-T04 trusted Payload ObjectRef authority', () => {
  it('accepts only a real local-store receipt and persists exact authoritative metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bo-p1-authority-'))
    const store = new LocalObjectStore({ root_dir: root, signer_secret: 'authority-test-signer' })
    const hook = requireTrustedObjectRef('raw_ref')
    try {
      const receipt = await store.putForIngress({ principal: principals.ingestService, ref: rawRef, bytes, field: 'raw_ref', actor_id: 'ingest-1', correlation_id: 'corr-1' })
      expect(receipt).toEqual({ receipt_id: expect.stringMatching(/^[0-9a-f-]{36}$/i) })
      expect(JSON.stringify(receipt)).not.toContain(rawRef.key)
      expect(hasObjectAuthority({ __phase1ObjectAuthority: {} })).toBe(false)
      await expect(hook({ operation: 'create', data: { raw_ref: rawRef, content_hash: rawRef.content_hash }, req: { context: {} } } as never)).rejects.toThrow(/trusted server object ingress command/)

      const authority = createObjectAuthority(store)
      const command = createObjectIngressCommand({ authority, receipt, field: 'raw_ref', actor_id: 'ingest-1', correlation_id: 'corr-1' })
      const context = withObjectAuthority({}, command)
      expect(hasObjectAuthority(context)).toBe(true)
      await expect(hook({ operation: 'create', data: { raw_ref: { ...rawRef, size_bytes: 999 }, content_hash: `sha256:v1:${'b'.repeat(64)}` }, req: { context } } as never)).resolves.toMatchObject({ raw_ref: rawRef, content_hash: contentHash })

      const unknown = createObjectIngressCommand({ authority, receipt: { receipt_id: randomUUID() }, field: 'raw_ref', actor_id: 'ingest-1', correlation_id: 'corr-1' })
      await expect(hook({ operation: 'create', data: {}, req: { context: withObjectAuthority({}, unknown) } } as never)).rejects.toThrow(/current authoritative ingress object/)

      const mismatched = createObjectIngressCommand({ authority, receipt, field: 'object_ref', actor_id: 'ingest-1', correlation_id: 'corr-1' })
      await expect(hook({ operation: 'create', data: {}, req: { context: withObjectAuthority({}, mismatched) } } as never)).rejects.toThrow(/purpose does not match/i)

      const mediaReceipt = await store.putForIngress({ principal: principals.publishService, ref: mediaRef, bytes: pngBytes, field: 'object_ref', actor_id: 'publish-1', correlation_id: 'media-corr' })
      const mediaHook = requireTrustedObjectRef('object_ref')
      const mediaCommand = createObjectIngressCommand({ authority, receipt: mediaReceipt, field: 'object_ref', actor_id: 'publish-1', correlation_id: 'media-corr' })
      await expect(mediaHook({ operation: 'create', data: { object_ref: { ...mediaRef, size_bytes: 1 } }, req: { context: withObjectAuthority({}, mediaCommand) } } as never)).resolves.toMatchObject({ object_ref: mediaRef })

      await store.setLifecycle({ principal: principals.ingestService, ref: rawRef, deletion_state: 'removed' })
      await expect(hook({ operation: 'create', data: {}, req: { context } } as never)).rejects.toThrow(/current authoritative ingress object/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
