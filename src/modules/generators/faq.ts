import { z } from 'zod'

import { relationRefSchema } from '@/contracts/common'
import { pageModuleSchema, type PageModule } from '@/page/modules'

import { GenerationBlockedError } from '../errors'
import type { ModuleGenerator } from '../registry'
import { generationEnvelopeSchema, isDeclaredSource } from './shared'

const faqInputSchema = z.object({
  envelope: generationEnvelopeSchema,
  question: z.string().min(1),
  answerRefs: z.array(relationRefSchema),
  demandSourceRef: relationRefSchema,
  sampleCount: z.number().int().positive(),
}).strict()

/** Retains answer and demand provenance instead of inventing FAQ prose. */
export class FaqModuleGenerator implements ModuleGenerator {
  async generate(input: unknown): Promise<PageModule> {
    const parsed = faqInputSchema.safeParse(input)
    if (!parsed.success) throw new GenerationBlockedError('faq_input_unavailable')
    if (parsed.data.answerRefs.length === 0) throw new GenerationBlockedError('faq_answer_sources_required')
    if (!isDeclaredSource(parsed.data.envelope.source_refs, parsed.data.demandSourceRef))
      throw new GenerationBlockedError('faq_demand_evidence_required')
    if (parsed.data.answerRefs.some((reference) => !isDeclaredSource(parsed.data.envelope.source_refs, reference)))
      throw new GenerationBlockedError('faq_answer_sources_required')

    return pageModuleSchema.parse({
      ...parsed.data.envelope,
      module_type: 'faq',
      review_state: 'candidate',
      payload: {
        question: parsed.data.question,
        answer_refs: parsed.data.answerRefs,
        demand_source_ref: parsed.data.demandSourceRef,
        sample_count: parsed.data.sampleCount,
      },
    })
  }
}
