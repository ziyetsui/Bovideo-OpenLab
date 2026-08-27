import { z } from 'zod'

import { immutableIdSchema } from '@/contracts/common'

/** Immutable local trace lineage shared by P1 boundaries. */
export const observationContextSchema = z.object({
  correlation_id: immutableIdSchema,
  causation_id: immutableIdSchema.nullable(),
}).strict()

export type ObservationContext = z.infer<typeof observationContextSchema>

export const observationContext = (input: ObservationContext): ObservationContext =>
  Object.freeze(observationContextSchema.parse(input))

/** Compatibility context for the local T08 test-double trace boundary. */
export type ObservabilityContext = Readonly<ObservationContext & { traceparent: string }>

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([01]{2})$/

export const validateTraceparent = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('traceparent is required')
  const match = traceparentPattern.exec(value)
  if (match === null || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!)) throw new Error('invalid traceparent')
  return value
}

export const createRootObservabilityContext = (input: Readonly<{
  correlation_id: string
  traceparent: string
}>): ObservabilityContext => {
  const context = observationContext({ correlation_id: input.correlation_id, causation_id: null })
  return Object.freeze({ ...context, traceparent: validateTraceparent(input.traceparent) })
}

/** A local child retains its trusted trace; callers cannot replace it at a boundary. */
export const resumeObservabilityContext = (input: Readonly<{
  context: ObservabilityContext
  causation_id: string
  external_traceparent?: string
}>): ObservabilityContext => {
  const parent = observationContext({ correlation_id: input.context.correlation_id, causation_id: input.context.causation_id })
  const traceparent = validateTraceparent(input.context.traceparent)
  if (input.external_traceparent !== undefined && validateTraceparent(input.external_traceparent) !== traceparent)
    throw new Error('external traceparent replacement is forbidden')
  return Object.freeze({ ...parent, causation_id: immutableIdSchema.parse(input.causation_id), traceparent })
}
