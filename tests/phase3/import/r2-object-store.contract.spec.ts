import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { principals } from '@/access/principals'
import { buildContentAddressedKey, type ObjectRef } from '@/storage/object-ref'
import { R2ObjectStore, resolveR2ObjectStoreFromEnvironment } from '@/storage/r2-object-store'

const rawRef = (bytes: Uint8Array): ObjectRef => {
  const content_hash = `sha256:v1:${createHash('sha256').update(bytes).digest('hex')}`
  return {
    namespace: 'raw-evidence',
    bucket_class: 'private_raw',
    key: buildContentAddressedKey('raw-evidence', content_hash),
    content_hash,
    version: 'v1',
    size_bytes: bytes.byteLength,
    mime_type: 'application/json',
    rights_state: 'metadata_only',
    deletion_state: 'active',
  }
}

describe('R2ObjectStore', () => {
  it('writes private raw evidence and resolves its receipt only for the bound actor', async () => {
    const putObject = vi.fn(async () => undefined)
    const store = new R2ObjectStore({ bucket: 'bovideo-openlab-raw-evidence', putObject, getObject: async () => { throw new Error('not expected') } })
    const bytes = new TextEncoder().encode('{"tweet_id":"1"}')
    const ref = rawRef(bytes)

    const receipt = await store.putForIngress({
      principal: principals.ingestService,
      ref,
      bytes,
      field: 'raw_ref',
      actor_id: 'twitter241-collector',
      correlation_id: '01J0R2WRITE000000000000000',
    })

    expect(putObject).toHaveBeenCalledWith({
      Bucket: 'bovideo-openlab-raw-evidence',
      Key: ref.key,
      Body: bytes,
      ContentType: 'application/json',
      ContentLength: bytes.byteLength,
      IfNoneMatch: '*',
    })
    await expect(store.resolveIngressReceipt({
      receipt_id: receipt.receipt_id,
      field: 'raw_ref',
      actor_id: 'other-worker',
      correlation_id: '01J0R2WRITE000000000000000',
    })).resolves.toBeNull()
    await expect(store.resolveIngressReceipt({
      receipt_id: receipt.receipt_id,
      field: 'raw_ref',
      actor_id: 'twitter241-collector',
      correlation_id: '01J0R2WRITE000000000000000',
    })).resolves.toEqual(ref)
    await expect(store.resolveIngressReceipt({
      receipt_id: receipt.receipt_id,
      field: 'raw_ref',
      actor_id: 'twitter241-collector',
      correlation_id: '01J0R2WRITE000000000000000',
    })).resolves.toBeNull()
  })

  it('denies a non-ingest principal before it calls the R2 client', async () => {
    const putObject = vi.fn(async () => undefined)
    const bytes = new TextEncoder().encode('{"tweet_id":"1"}')
    const store = new R2ObjectStore({ bucket: 'bovideo-openlab-raw-evidence', putObject, getObject: async () => { throw new Error('not expected') } })

    await expect(store.write({ principal: principals.publishService, ref: rawRef(bytes), bytes }))
      .rejects.toThrow(/write denied/i)
    expect(putObject).not.toHaveBeenCalled()
  })

  it('rejects invalid evidence before it calls the R2 client', async () => {
    const putObject = vi.fn(async () => undefined)
    const bytes = new TextEncoder().encode('{"tweet_id":"1"}')
    const store = new R2ObjectStore({ bucket: 'bovideo-openlab-raw-evidence', putObject, getObject: async () => { throw new Error('not expected') } })
    const ref = rawRef(bytes)

    await expect(store.write({
      principal: principals.ingestService,
      ref: { ...ref, content_hash: `sha256:v1:${'0'.repeat(64)}` },
      bytes,
    })).rejects.toThrow()
    await expect(store.putForIngress({
      principal: principals.ingestService,
      ref,
      bytes,
      field: 'object_ref',
      actor_id: 'twitter241-collector',
      correlation_id: '01J0R2WRITE000000000000000',
    })).rejects.toThrow(/raw_ref/i)
    expect(putObject).not.toHaveBeenCalled()
  })

  it('rejects an incomplete R2 environment before it creates a client', () => {
    expect(() => resolveR2ObjectStoreFromEnvironment({
      RAW_EVIDENCE_R2_ACCESS_KEY_ID: 'access-key',
      RAW_EVIDENCE_R2_SECRET_ACCESS_KEY: 'secret-key',
      RAW_EVIDENCE_R2_ENDPOINT: 'https://example.invalid',
      RAW_EVIDENCE_R2_BUCKET: 'bovideo-openlab-raw-evidence',
      RAW_EVIDENCE_R2_REGION: undefined,
    })).toThrow(/incomplete/i)
  })

  it('rejects a non-R2 endpoint before it can receive S3 credentials', () => {
    expect(() => resolveR2ObjectStoreFromEnvironment({
      RAW_EVIDENCE_R2_ACCESS_KEY_ID: 'access-key',
      RAW_EVIDENCE_R2_SECRET_ACCESS_KEY: 'secret-key',
      RAW_EVIDENCE_R2_ENDPOINT: 'http://example.invalid',
      RAW_EVIDENCE_R2_BUCKET: 'bovideo-openlab-raw-evidence',
      RAW_EVIDENCE_R2_REGION: 'auto',
    })).toThrow(/endpoint/i)
  })

  it('accepts an existing immutable object only after its bytes revalidate', async () => {
    const bytes = new TextEncoder().encode('{"tweet_id":"1"}')
    const putObject = vi.fn(async () => { throw Object.assign(new Error('already exists'), { $metadata: { httpStatusCode: 412 } }) })
    const getObject = vi.fn(async () => bytes)
    const store = new R2ObjectStore({ bucket: 'bovideo-openlab-raw-evidence', putObject, getObject })

    await expect(store.write({ principal: principals.ingestService, ref: rawRef(bytes), bytes })).resolves.toMatchObject({ content_hash: rawRef(bytes).content_hash })
    expect(getObject).toHaveBeenCalledOnce()
  })

  it('rejects a pre-existing key whose bytes do not match the content-addressed retry', async () => {
    const bytes = new TextEncoder().encode('{"tweet_id":"1"}')
    const putObject = vi.fn(async () => { throw Object.assign(new Error('already exists'), { $metadata: { httpStatusCode: 412 } }) })
    const store = new R2ObjectStore({
      bucket: 'bovideo-openlab-raw-evidence',
      putObject,
      getObject: async () => new TextEncoder().encode('{"tweet_id":"different"}'),
    })

    await expect(store.write({ principal: principals.ingestService, ref: rawRef(bytes), bytes }))
      .rejects.toThrow(/collision/i)
  })
})
