import { queueEnvelopeSchema, type QueueEnvelope } from '@/contracts/queue'

export type TranslationKeyRegistry = Readonly<{ promptVersions: ReadonlySet<string>; modelSnapshots: ReadonlySet<string> }>

/** The only queue boundary: strict canonical schema parsing before a message enters local storage. */
export const parseQueueEnvelope = (value: unknown, registry?: TranslationKeyRegistry): QueueEnvelope => {
  const envelope = queueEnvelopeSchema.parse(value)
  if (envelope.kind === 'translate') {
    if (!registry) throw new Error('translation idempotency key registry is required')
    const [, , , , , , promptVersion, model] = envelope.idempotency_key.split(':')
    if (!registry.promptVersions.has(promptVersion) || !registry.modelSnapshots.has(model))
      throw new Error('translation idempotency key is not in the configured snapshot registry')
  }
  return envelope
}

/** Defends local in-memory boundaries from callers mutating nested refs after submission. */
export const immutableClone = <T>(value: T): T => {
  const clone = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze)
      Object.freeze(item)
    }
  }
  freeze(clone)
  return clone
}

export type QueueMessageOutcome =
  | Readonly<{ status: 'processed' | 'duplicate' | 'stale_ignored'; reason?: 'source_version' | 'withdrawn' }>
  | Readonly<{ status: 'retry_scheduled'; delayMilliseconds: number }>
  | Readonly<{ status: 'dlq'; dlqId: string }>
