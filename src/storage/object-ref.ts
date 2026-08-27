import { z } from 'zod'

import { versionedHashSchema } from '@/contracts/common'
import { rightsStateSchema } from '@/contracts/rights'

/** R2-equivalent namespaces; the local adapter maps each to a private root. */
export const OBJECT_NAMESPACES = [
  'raw-evidence',
  'review-media',
  'published-snapshots',
  'public-media',
] as const
export const objectNamespaceSchema = z.enum(OBJECT_NAMESPACES)
export type ObjectNamespace = z.infer<typeof objectNamespaceSchema>

export const OBJECT_BUCKET_CLASSES = [
  'private_raw',
  'private_review',
  'worker_snapshot',
  'worker_public',
] as const
export const objectBucketClassSchema = z.enum(OBJECT_BUCKET_CLASSES)
export type ObjectBucketClass = z.infer<typeof objectBucketClassSchema>

export const objectDeletionStateSchema = z.enum(['active', 'requested', 'removed'])
export type ObjectDeletionState = z.infer<typeof objectDeletionStateSchema>

const NAMESPACE_BUCKET_CLASS: Readonly<Record<ObjectNamespace, ObjectBucketClass>> = {
  'raw-evidence': 'private_raw',
  'review-media': 'private_review',
  'published-snapshots': 'worker_snapshot',
  'public-media': 'worker_public',
}

const hashHex = (hash: string): string => hash.slice('sha256:v1:'.length)
const pathIsSafe = (key: string): boolean => {
  if (key.length === 0 || key.length > 1024) return false
  if (key.startsWith('/') || key.includes('\\') || key.includes('//') || key.includes('://')) return false
  if (/[\u0000-\u001f\u007f]/.test(key) || key.includes('%')) return false
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(key)) return false
  return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

const rawKeyMatchesHash = (key: string, contentHash: string): boolean =>
  key === `sha256/${hashHex(contentHash).slice(0, 2)}/${hashHex(contentHash)}`

/** Strict persistence shape. Object keys are private implementation details. */
export const objectRefSchema = z.object({
  namespace: objectNamespaceSchema,
  bucket_class: objectBucketClassSchema,
  key: z.string().refine(pathIsSafe, 'object key must be normalized relative POSIX path'),
  content_hash: versionedHashSchema,
  version: z.string().regex(/^v[a-z0-9][a-z0-9._-]{0,63}$/),
  size_bytes: z.number().int().min(0).max(50 * 1024 * 1024),
  mime_type: z.string().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/),
  rights_state: rightsStateSchema,
  deletion_state: objectDeletionStateSchema,
}).strict().superRefine((value, context) => {
  if (NAMESPACE_BUCKET_CLASS[value.namespace] !== value.bucket_class) {
    context.addIssue({ code: 'custom', message: 'bucket class does not match object namespace', path: ['bucket_class'] })
  }
  if (value.namespace === 'raw-evidence' && !rawKeyMatchesHash(value.key, value.content_hash)) {
    context.addIssue({ code: 'custom', message: 'raw evidence key must be content addressed', path: ['key'] })
  }
})
export type ObjectRef = z.infer<typeof objectRefSchema>

/** Builds the canonical content-addressed key used for immutable raw evidence. */
export const buildContentAddressedKey = (namespace: ObjectNamespace, contentHash: string): string => {
  if (namespace !== 'raw-evidence') throw new Error('content-addressed raw keys are only valid for raw-evidence')
  const parsed = versionedHashSchema.safeParse(contentHash)
  if (!parsed.success) throw new Error('content hash must be sha256:v1:<64 lowercase hex>')
  const hash = hashHex(parsed.data)
  return `sha256/${hash.slice(0, 2)}/${hash}`
}

export type PublicObjectReference = Readonly<{
  namespace: 'public-media'
  content_hash: string
  version: string
  mime_type: string
  size_bytes: number
}>

/** Removes storage keys and all restricted metadata before a public projection. */
export const toPublicObjectReference = (value: ObjectRef): PublicObjectReference => {
  if (value.namespace !== 'public-media' || value.deletion_state !== 'active' ||
    (value.rights_state !== 'first_party' && value.rights_state !== 'redistribution_licensed')) {
    throw new Error('restricted object refs cannot be projected publicly')
  }
  return Object.freeze({
    namespace: 'public-media',
    content_hash: value.content_hash,
    version: value.version,
    mime_type: value.mime_type,
    size_bytes: value.size_bytes,
  })
}

/** Rejects accidental restricted ObjectRef copies in response/artifact/queue-like objects. */
export const assertNoRestrictedObjectRefs = (value: unknown): void => {
  const visited = new Set<unknown>()
  const inspect = (entry: unknown): void => {
    if (typeof entry !== 'object' || entry === null || visited.has(entry)) return
    visited.add(entry)
    const parsed = objectRefSchema.safeParse(entry)
    if (parsed.success && parsed.data.namespace !== 'public-media')
      throw new Error('restricted ObjectRef cannot enter public serialized shape')
    for (const child of Array.isArray(entry) ? entry : Object.values(entry)) inspect(child)
  }
  inspect(value)
}
