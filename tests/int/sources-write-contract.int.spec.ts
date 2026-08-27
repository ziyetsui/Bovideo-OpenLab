import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import config from '@/payload.config'
import { principals } from '@/access/principals'
import { LocalObjectStore } from '@/storage/local-object-store'
import { createObjectAuthority, createObjectIngressCommand, withObjectAuthority } from '@/storage/payload-object-authority'
import type { ObjectRef } from '@/storage/object-ref'

import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
let sourceID: number | undefined
let storeRoot: string
let store: LocalObjectStore

const rawBytes = new Uint8Array()
const contentHash = (): string => `sha256:v1:${createHash('sha256').update(rawBytes).digest('hex')}`
const rawRef = (hash: string): ObjectRef => ({
  namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/${hash.slice(10, 12)}/${hash.slice(10)}`,
  content_hash: hash, version: 'v1', size_bytes: 0, mime_type: 'application/json', rights_state: 'first_party', deletion_state: 'active',
})
const trustedContext = async (ref: ReturnType<typeof rawRef>) => {
  const receipt = await store.putForIngress({ principal: principals.ingestService, ref, bytes: rawBytes, field: 'raw_ref', actor_id: 'sources-write-test', correlation_id: 'sources-write-correlation' })
  return withObjectAuthority({}, createObjectIngressCommand({ authority: createObjectAuthority(store), receipt, field: 'raw_ref', actor_id: 'sources-write-test', correlation_id: 'sources-write-correlation' }))
}

const createSource = async (overrides: Record<string, unknown> = {}) => {
  const hash = contentHash()
  const ref = rawRef(hash)
  return payload.create({
    collection: 'sources',
    draft: false,
    data: {
      stable_id: globalThis.crypto.randomUUID(),
      schema_version: 1,
      revision: 1,
      source_version: globalThis.crypto.randomUUID(),
      status: 'active',
      provider: 'first_party',
      provider_record_id: globalThis.crypto.randomUUID(),
      canonical_url: 'https://example.com/source',
      raw_ref: ref,
      captured_at: '2026-08-22T00:00:00.000Z',
      content_hash: hash,
      rights_state: 'first_party',
      rights_basis: 'test fixture',
      deletion_state: 'active',
      ...overrides,
    },
    req: { context: await trustedContext(ref) } as never,
  })
}

describe('sources write contract', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    storeRoot = await mkdtemp(join(tmpdir(), 'bo-p1-sources-write-'))
    store = new LocalObjectStore({ root_dir: storeRoot, signer_secret: 'sources-write-signer' })
  })

  afterAll(async () => {
    if (sourceID) await payload.delete({ collection: 'sources', id: sourceID })
    await rm(storeRoot, { recursive: true, force: true })
  })

  it('persists an immutable UUID business identity separate from provider identity', async () => {
    const source = await createSource()
    sourceID = source.id

    expect(source.id).toEqual(expect.any(Number))
    expect(source.stable_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(source.stable_id).not.toBe(source.provider_record_id)

    await expect(
      payload.update({
        collection: 'sources',
        id: source.id,
        data: { stable_id: globalThis.crypto.randomUUID() },
      }),
    ).rejects.toThrow('stable_id is immutable')
  })

  it('enforces source-provider version uniqueness in the D1 database', async () => {
    const providerRecordID = globalThis.crypto.randomUUID()
    const sourceHash = contentHash()
    const source = await createSource({ content_hash: sourceHash, provider_record_id: providerRecordID })

    await expect(
      createSource({ content_hash: sourceHash, provider_record_id: providerRecordID }),
    ).rejects.toThrow()

    await payload.delete({ collection: 'sources', id: source.id })
  })

  it('requires a rights basis for first-party or licensed source content', async () => {
    await expect(createSource({ rights_basis: undefined })).rejects.toThrow(/rights_basis/i)

    const metadataOnly = await createSource({ rights_basis: undefined, rights_state: 'metadata_only' })
    await payload.delete({ collection: 'sources', id: metadataOnly.id })
  })
})
