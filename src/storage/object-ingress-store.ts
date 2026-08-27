import type { ObjectPrincipal } from './policy'
import type { ObjectNamespace, ObjectRef } from './object-ref'

export type StoredObjectHead = Readonly<{
  namespace: ObjectNamespace
  content_hash: string
  version: string
  size_bytes: number
  mime_type: string
}>

/** Opaque receipt only; it intentionally contains no object key or public path. */
export type ObjectIngressReceipt = Readonly<{ receipt_id: string }>
export type ObjectIngressField = 'raw_ref' | 'object_ref'

export type ObjectIngressStore = Readonly<{
  write: (input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; bytes: Uint8Array }>) => Promise<StoredObjectHead>
  putForIngress: (input: Readonly<{ principal: ObjectPrincipal; ref: ObjectRef; bytes: Uint8Array; field: ObjectIngressField; actor_id: string; correlation_id: string }>) => Promise<ObjectIngressReceipt>
  resolveIngressReceipt: (input: Readonly<{ receipt_id: string; field: ObjectIngressField; actor_id: string; correlation_id: string }>) => Promise<ObjectRef | null>
}>
