import { z } from 'zod'

import { relationRefSchema, utcTimestampSchema } from '@/contracts/common'
import { moduleEnvelopeSchema } from '@/contracts/module'

export const generationEnvelopeSchema = moduleEnvelopeSchema.omit({ module_type: true, review_state: true }).strict()

export const sourceFactInputSchema = z.object({
  sourceRef: relationRefSchema,
  observedAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema.nullable(),
  factType: z.enum(['price', 'feature', 'other']),
  value: z.string().min(1),
}).strict()

export const isDeclaredSource = (
  sources: readonly z.infer<typeof relationRefSchema>[],
  reference: z.infer<typeof relationRefSchema>,
): boolean => sources.some((source) => source.type === reference.type && source.id === reference.id)
