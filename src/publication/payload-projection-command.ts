const capabilityKey = '__boInternalProjectionPublication'
const capabilities = new WeakSet<object>()

/** Opaque command issued only by the local publication worker. */
export const createInternalProjectionPublicationRequest = (input: Readonly<{ correlationId: string; user?: unknown }>): Readonly<{ context: Record<string, unknown>; user?: unknown }> => {
  if (!/^[0-9a-f-]{36}$/i.test(input.correlationId)) throw new Error('projection publication requires a UUID correlation id')
  const capability = Object.freeze({})
  capabilities.add(capability)
  const context: Record<string, unknown> = {}
  Object.defineProperty(context, capabilityKey, { value: capability, enumerable: true })
  // Payload's createLocalReq appends request-scoped locale/transaction fields.
  // The opaque capability itself remains frozen and WeakSet-backed; only the
  // outer carrier must stay extensible for the framework.
  return input.user === undefined ? { context } : { context, user: input.user }
}

/** JSON/REST bodies cannot recreate the WeakSet-backed publication capability. */
export const hasInternalProjectionPublicationCapability = (context: unknown): boolean => {
  if (typeof context !== 'object' || context === null) return false
  const capability = (context as Record<string, unknown>)[capabilityKey]
  return typeof capability === 'object' && capability !== null && capabilities.has(capability)
}
