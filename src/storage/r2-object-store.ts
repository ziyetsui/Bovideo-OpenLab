import { randomUUID } from 'node:crypto'

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import type { ObjectIngressField, ObjectIngressReceipt, ObjectIngressStore, StoredObjectHead } from './object-ingress-store'
import { objectRefSchema, type ObjectRef } from './object-ref'
import type { ObjectPrincipal } from './policy'
import { decideObjectAccess, isObjectLifecycleReadable } from './policy'
import { validateObjectUpload } from './upload-validation'

export type R2PutObjectInput = Readonly<{
  Bucket: string
  Key: string
  Body: Uint8Array
  ContentType: string
  ContentLength: number
  IfNoneMatch: '*'
}>

export type R2PutObject = (input: R2PutObjectInput) => Promise<void>
export type R2GetObject = (input: Readonly<{ Bucket: string; Key: string }>) => Promise<Uint8Array>

type R2Receipt = Readonly<{
  ref: ObjectRef
  field: ObjectIngressField
  actor_id: string
  correlation_id: string
}>

export type R2ObjectStoreOptions = Readonly<{ bucket: string; putObject: R2PutObject; getObject: R2GetObject }>

const headFor = (ref: ObjectRef): StoredObjectHead => Object.freeze({
  namespace: ref.namespace,
  content_hash: ref.content_hash,
  version: ref.version,
  size_bytes: ref.size_bytes,
  mime_type: ref.mime_type,
})

const assertInternalWrite = (principal: ObjectPrincipal, ref: ObjectRef): void => {
  const decision = decideObjectAccess({ principal, ref, action: 'write', channel: 'internal' })
  if (!decision.allowed) throw new Error(`R2 object write denied: ${decision.reason}`)
}

const isPreconditionFailure = (error: unknown): boolean =>
  typeof error === 'object' && error !== null &&
  ((error as { name?: unknown }).name === 'PreconditionFailed' ||
    (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode === 412)

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index])

/**
 * Private S3-compatible R2 ingress adapter. It never constructs public object URLs or ACLs.
 * Receipts are process-local by design: a process crash can leave an unreferenced immutable
 * object, but a retry writes the same content-addressed key before creating a new Payload fact.
 */
export class R2ObjectStore implements ObjectIngressStore {
  readonly #bucket: string
  readonly #putObject: R2PutObject
  readonly #getObject: R2GetObject
  readonly #receipts = new Map<string, R2Receipt>()

  constructor(options: R2ObjectStoreOptions) {
    if (options.bucket.trim().length === 0) throw new Error('R2 bucket is required')
    this.#bucket = options.bucket.trim()
    this.#putObject = options.putObject
    this.#getObject = options.getObject
  }

  async write(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; bytes: Uint8Array }>): Promise<StoredObjectHead> {
    const ref = objectRefSchema.parse(input.ref)
    if (ref.namespace !== 'raw-evidence' || ref.bucket_class !== 'private_raw')
      throw new Error('R2 raw evidence store only accepts raw-evidence objects')
    assertInternalWrite(input.principal, ref)
    validateObjectUpload({
      namespace: ref.namespace,
      key: ref.key,
      bytes: input.bytes,
      declared_size: ref.size_bytes,
      declared_hash: ref.content_hash,
      declared_mime_type: ref.mime_type,
      rights_state: ref.rights_state,
      deletion_state: ref.deletion_state,
    })
    try {
      await this.#putObject({
        Bucket: this.#bucket,
        Key: ref.key,
        Body: input.bytes,
        ContentType: ref.mime_type,
        ContentLength: ref.size_bytes,
        IfNoneMatch: '*',
      })
    } catch (error) {
      if (!isPreconditionFailure(error)) throw error
      const existing = await this.#getObject({ Bucket: this.#bucket, Key: ref.key })
      if (!sameBytes(existing, input.bytes)) throw new Error('content-addressed R2 object collision mismatch')
      validateObjectUpload({
        namespace: ref.namespace,
        key: ref.key,
        bytes: existing,
        declared_size: ref.size_bytes,
        declared_hash: ref.content_hash,
        declared_mime_type: ref.mime_type,
        rights_state: ref.rights_state,
        deletion_state: ref.deletion_state,
      })
    }
    return headFor(ref)
  }

  async putForIngress(input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; bytes: Uint8Array; field: ObjectIngressField; actor_id: string; correlation_id: string }>): Promise<ObjectIngressReceipt> {
    if (input.field !== 'raw_ref') throw new Error('R2 raw evidence store only issues raw_ref ingress receipts')
    if (input.actor_id.trim().length === 0 || input.correlation_id.trim().length === 0)
      throw new Error('ingress receipt actor and correlation are required')
    const ref = objectRefSchema.parse(input.ref)
    await this.write(input)
    if (!isObjectLifecycleReadable(ref)) throw new Error('object cannot issue an ingress receipt')
    const receipt_id = randomUUID()
    this.#receipts.set(receipt_id, Object.freeze({
      ref,
      field: input.field,
      actor_id: input.actor_id,
      correlation_id: input.correlation_id,
    }))
    return Object.freeze({ receipt_id })
  }

  async resolveIngressReceipt(input: Readonly<{ receipt_id: string; field: ObjectIngressField; actor_id: string; correlation_id: string }>): Promise<ObjectRef | null> {
    const receipt = this.#receipts.get(input.receipt_id)
    if (receipt === undefined || receipt.field !== input.field || receipt.actor_id !== input.actor_id || receipt.correlation_id !== input.correlation_id)
      return null
    this.#receipts.delete(input.receipt_id)
    return receipt.ref
  }
}

export type R2Environment = Readonly<Record<
  'RAW_EVIDENCE_R2_ACCESS_KEY_ID' | 'RAW_EVIDENCE_R2_SECRET_ACCESS_KEY' | 'RAW_EVIDENCE_R2_ENDPOINT' | 'RAW_EVIDENCE_R2_BUCKET' | 'RAW_EVIDENCE_R2_REGION',
  string | undefined
>>

const r2Keys = [
  'RAW_EVIDENCE_R2_ACCESS_KEY_ID',
  'RAW_EVIDENCE_R2_SECRET_ACCESS_KEY',
  'RAW_EVIDENCE_R2_ENDPOINT',
  'RAW_EVIDENCE_R2_BUCKET',
  'RAW_EVIDENCE_R2_REGION',
] as const

const parseR2Endpoint = (value: string): string => {
  let endpoint: URL
  try { endpoint = new URL(value) } catch { throw new Error('RAW_EVIDENCE_R2_ENDPOINT must be a valid R2 HTTPS endpoint') }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
    !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(endpoint.hostname))
    throw new Error('RAW_EVIDENCE_R2_ENDPOINT must be a Cloudflare R2 HTTPS account endpoint')
  return endpoint.toString()
}

const readBodyBytes = async (body: unknown): Promise<Uint8Array> => {
  if (body instanceof Uint8Array) return body
  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body && typeof body.transformToByteArray === 'function')
    return await body.transformToByteArray()
  throw new Error('R2 GetObject returned no readable object body')
}

/** Returns null when R2 is not configured, and fails closed for a partial configuration. */
export const resolveR2ObjectStoreFromEnvironment = (environment: R2Environment): R2ObjectStore | null => {
  const configured = r2Keys.filter((key) => environment[key]?.trim().length)
  if (configured.length === 0) return null
  if (configured.length !== r2Keys.length) throw new Error(`R2 raw evidence configuration is incomplete: missing ${r2Keys.filter((key) => !environment[key]?.trim().length).join(', ')}`)
  const endpoint = parseR2Endpoint(environment.RAW_EVIDENCE_R2_ENDPOINT!.trim())
  if (environment.RAW_EVIDENCE_R2_REGION!.trim() !== 'auto') throw new Error('RAW_EVIDENCE_R2_REGION must be auto')
  const client = new S3Client({
    endpoint,
    region: environment.RAW_EVIDENCE_R2_REGION!.trim(),
    credentials: {
      accessKeyId: environment.RAW_EVIDENCE_R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: environment.RAW_EVIDENCE_R2_SECRET_ACCESS_KEY!.trim(),
    },
    forcePathStyle: true,
  })
  return new R2ObjectStore({
    bucket: environment.RAW_EVIDENCE_R2_BUCKET!.trim(),
    putObject: async (input) => { await client.send(new PutObjectCommand(input)) },
    getObject: async (input) => {
      const response = await client.send(new GetObjectCommand(input))
      return await readBodyBytes(response.Body)
    },
  })
}
