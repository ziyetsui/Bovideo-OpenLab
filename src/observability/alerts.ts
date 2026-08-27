import { z } from 'zod'

import { observationContextSchema, type ObservationContext } from './context'
import { redactStructuredValue } from './redaction'

const thresholds = {
  'queue.oldest_age': 300,
  'queue.dlq': 0,
  'withdraw.trigger': 60,
  'redaction.failure': 0,
  'publish.validation_failure': 0,
} as const
type AlertKind = keyof typeof thresholds
export type LocalAlertEvent = Readonly<{ kind: AlertKind; value: number; threshold: number; owner: string; context: ObservationContext }>

const alertKindSchema = z.enum(Object.keys(thresholds) as [AlertKind, ...AlertKind[]])
const alertContextSchema = observationContextSchema.extend({ traceparent: z.string().optional() }).strict()
const alertInputSchema = z.object({
  kind: alertKindSchema,
  value: z.number().finite().nonnegative(),
  context: alertContextSchema,
}).strict()
const ownerSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/)

/** Local owner-routing test double. It neither calls a webhook nor models production paging. */
export class LocalAlertRouter {
  readonly #owners: Readonly<Record<AlertKind, string>>
  readonly #events: LocalAlertEvent[] = []
  constructor(input: Readonly<{ owner_by_route: Record<AlertKind, string> }>) {
    if (typeof input !== 'object' || input === null || Object.keys(input).length !== 1 || !('owner_by_route' in input)) throw new Error('invalid local alert router configuration')
    for (const kind of Object.keys(thresholds) as AlertKind[]) {
      ownerSchema.parse(input.owner_by_route[kind])
    }
    if (Object.keys(input.owner_by_route).some((key) => !(key in thresholds))) throw new Error('unknown local alert route')
    this.#owners = Object.freeze({ ...input.owner_by_route })
  }
  observe(input: unknown): Readonly<{ fired: false }> | Readonly<{ fired: true; owner: string }> {
    const parsed = alertInputSchema.parse(input)
    const threshold = thresholds[parsed.kind]
    if (parsed.value <= threshold) return { fired: false }
    const sanitizedContext = redactStructuredValue(parsed.context) as Record<string, unknown>
    const event = Object.freeze({
      kind: parsed.kind,
      value: parsed.value,
      threshold,
      owner: this.#owners[parsed.kind],
      context: Object.freeze(observationContextSchema.parse({ correlation_id: sanitizedContext.correlation_id, causation_id: sanitizedContext.causation_id })),
    })
    this.#events.push(event)
    return { fired: true, owner: event.owner }
  }
  events(): readonly LocalAlertEvent[] { return this.#events.slice() }
}
