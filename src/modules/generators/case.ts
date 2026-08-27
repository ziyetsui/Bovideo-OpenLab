import { z } from 'zod'

import { relationRefSchema } from '@/contracts/common'
import { pageModuleSchema, type PageModule } from '@/page/modules'

import { GenerationBlockedError } from '../errors'
import type { ModuleGenerator } from '../registry'
import { generationEnvelopeSchema } from './shared'

const caseInputSchema = z.object({
  envelope: generationEnvelopeSchema,
  submissionKind: z.enum(['ugc', 'synthetic', 'first_party']),
  authorizationRef: relationRefSchema.nullable(),
  inputSummary: z.string().min(1),
  outputSummary: z.string().min(1),
  workflowRef: relationRefSchema.nullable(),
}).strict()

/** Admits only supplied case evidence and requires authorization for UGC. */
export class CaseModuleGenerator implements ModuleGenerator {
  async generate(input: unknown): Promise<PageModule> {
    const parsed = caseInputSchema.safeParse(input)
    if (!parsed.success) throw new GenerationBlockedError('case_input_unavailable')
    if (parsed.data.submissionKind === 'ugc' && parsed.data.authorizationRef === null)
      throw new GenerationBlockedError('case_ugc_authorization_required')

    return pageModuleSchema.parse({
      ...parsed.data.envelope,
      module_type: 'case',
      review_state: 'candidate',
      payload: {
        submission_kind: parsed.data.submissionKind,
        authorization_ref: parsed.data.authorizationRef,
        input_summary: parsed.data.inputSummary,
        output_summary: parsed.data.outputSummary,
        workflow_ref: parsed.data.workflowRef,
      },
    })
  }
}
