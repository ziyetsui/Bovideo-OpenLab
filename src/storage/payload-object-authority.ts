import { APIError, type CollectionBeforeChangeHook } from 'payload'

import type { ObjectIngressField, ObjectIngressReceipt, ObjectIngressStore } from './object-ingress-store'
import { objectRefSchema, type ObjectNamespace } from './object-ref'

const authorityContextKey = '__phase1ObjectAuthority'
const authorities = new WeakSet<object>()
const commands = new WeakMap<object, Readonly<{
  authority: ObjectAuthority
  receipt_id: string
  field: ObjectIngressField
  actor_id: string
  correlation_id: string
}>>()

/** Store-backed authority. It deliberately has no callback/returned-ObjectRef escape hatch. */
export type ObjectAuthority = Readonly<{ readonly store: ObjectIngressStore }>
/** Opaque, non-serializable server command. A JSON copy loses its WeakMap membership. */
export type ObjectIngressCommand = object

export const createObjectAuthority = (store: ObjectIngressStore): ObjectAuthority => {
  const authority = Object.freeze({ store })
  authorities.add(authority)
  return authority
}

/** Binds one authoritative receipt to its Payload field, actor, and correlation. */
export const createObjectIngressCommand = (input: Readonly<{
  authority: ObjectAuthority
  receipt: ObjectIngressReceipt
  field: ObjectIngressField
  actor_id: string
  correlation_id: string
}>): ObjectIngressCommand => {
  if (!authorities.has(input.authority) || !/^[0-9a-f-]{36}$/i.test(input.receipt.receipt_id) || input.actor_id.trim().length === 0 || input.correlation_id.trim().length === 0)
    throw new Error('a store-issued ingress receipt and command binding are required')
  const command = Object.freeze({})
  commands.set(command, Object.freeze({ authority: input.authority, receipt_id: input.receipt.receipt_id, field: input.field, actor_id: input.actor_id, correlation_id: input.correlation_id }))
  return command
}

/** The enumerable carrier survives Payload's request-context copy, while the command itself cannot be forged by JSON. */
export const withObjectAuthority = <T extends Record<PropertyKey, unknown>>(context: T, command: ObjectIngressCommand): T => {
  if (!commands.has(command)) throw new Error('only a server-created ingress command can be attached')
  Object.defineProperty(context, authorityContextKey, { value: command, enumerable: true })
  return context
}

const commandFrom = (context: unknown): Readonly<{ authority: ObjectAuthority; receipt_id: string; field: ObjectIngressField; actor_id: string; correlation_id: string }> | undefined => {
  if (typeof context !== 'object' || context === null) return undefined
  const command = (context as Record<PropertyKey, unknown>)[authorityContextKey]
  return typeof command === 'object' && command !== null ? commands.get(command) : undefined
}

/** True only for an in-memory receipt command created by this module. */
export const hasObjectAuthority = (context: unknown): boolean => commandFrom(context) !== undefined

const namespaceForField = (field: ObjectIngressField): ObjectNamespace => field === 'raw_ref' ? 'raw-evidence' : 'public-media'

/** Resolves only a current, receipt-bound LocalObjectStore object and overwrites all client storage facts. */
export const requireTrustedObjectRef = (field: ObjectIngressField): CollectionBeforeChangeHook =>
  async ({ data, operation, originalDoc, req }) => {
    if (operation === 'update' &&
      (data?.[field] === undefined || JSON.stringify(data[field]) === JSON.stringify(originalDoc?.[field]))) return data
    const command = commandFrom(req.context)
    if (command === undefined) throw new APIError(`${field} requires a trusted server object ingress command`, 403, { field })
    if (command.field !== field) throw new APIError(`${field} receipt purpose does not match this field`, 403, { field })
    const resolved = await command.authority.store.resolveIngressReceipt(command)
    const parsed = objectRefSchema.safeParse(resolved)
    if (!parsed.success || parsed.data.namespace !== namespaceForField(field)) throw new APIError(`${field} is not a current authoritative ingress object`, 400, { field })
    data[field] = parsed.data
    if (field === 'raw_ref') data.content_hash = parsed.data.content_hash
    return data
  }
