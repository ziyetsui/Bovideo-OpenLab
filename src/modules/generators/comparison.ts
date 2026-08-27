import { z } from 'zod'

import { pageModuleSchema, type PageModule } from '@/page/modules'

import { GenerationBlockedError } from '../errors'
import type { ModuleGenerator } from '../registry'
import { generationEnvelopeSchema, isDeclaredSource, sourceFactInputSchema } from './shared'

const comparisonInputSchema = z.object({
  envelope: generationEnvelopeSchema,
  dimensions: z.array(z.object({
    dimension: z.string().min(1),
    left: sourceFactInputSchema,
    right: sourceFactInputSchema,
    value: z.string().min(1),
  }).strict()),
}).strict()

/** Creates cited comparison candidates; a human must separately factual-review them. */
export class ComparisonModuleGenerator implements ModuleGenerator {
  async generate(input: unknown): Promise<PageModule> {
    const parsed = comparisonInputSchema.safeParse(input)
    if (!parsed.success) throw new GenerationBlockedError('comparison_input_unavailable')
    if (parsed.data.dimensions.length === 0) throw new GenerationBlockedError('comparison_facts_required')
    if (parsed.data.dimensions.some((dimension) => !isDeclaredSource(parsed.data.envelope.source_refs, dimension.left.sourceRef) || !isDeclaredSource(parsed.data.envelope.source_refs, dimension.right.sourceRef)))
      throw new GenerationBlockedError('comparison_citation_required')

    return pageModuleSchema.parse({
      ...parsed.data.envelope,
      module_type: 'comparison',
      review_state: 'candidate',
      payload: {
        factual_reviewed: false,
        dimensions: parsed.data.dimensions.map((dimension) => ({
          dimension: dimension.dimension,
          left: {
            source_ref: dimension.left.sourceRef,
            observed_at: dimension.left.observedAt,
            expires_at: dimension.left.expiresAt,
            fact_type: dimension.left.factType,
            value: dimension.left.value,
          },
          right: {
            source_ref: dimension.right.sourceRef,
            observed_at: dimension.right.observedAt,
            expires_at: dimension.right.expiresAt,
            fact_type: dimension.right.factType,
            value: dimension.right.value,
          },
          value: dimension.value,
        })),
      },
    })
  }
}
