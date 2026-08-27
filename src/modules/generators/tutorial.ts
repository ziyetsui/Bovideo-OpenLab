import { z } from 'zod'

import { relationRefSchema } from '@/contracts/common'
import { pageModuleSchema, type PageModule } from '@/page/modules'

import { GenerationBlockedError } from '../errors'
import type { ModuleGenerator } from '../registry'
import { generationEnvelopeSchema } from './shared'

const tutorialStepInputSchema = z.object({
  selector: z.string().min(1),
  action: z.string().min(1),
  assertion: z.string().min(1),
  result: z.enum(['passed', 'failed', 'unavailable']),
  screenshotRef: relationRefSchema.nullable(),
  piiRedacted: z.boolean(),
  thirdPartyUiAuthorized: z.boolean(),
}).strict()

const tutorialInputSchema = z.object({
  envelope: generationEnvelopeSchema,
  applicationVersion: z.string().min(1),
  steps: z.array(tutorialStepInputSchema).min(1),
}).strict()

/** Projects execution evidence only after every RPA safety assertion has passed. */
export class TutorialModuleGenerator implements ModuleGenerator {
  async generate(input: unknown): Promise<PageModule> {
    const parsed = tutorialInputSchema.safeParse(input)
    if (!parsed.success) throw new GenerationBlockedError('tutorial_input_unavailable')
    if (parsed.data.steps.some((step) => step.result !== 'passed'))
      throw new GenerationBlockedError('tutorial_steps_not_passed')
    if (parsed.data.steps.some((step) => !step.piiRedacted))
      throw new GenerationBlockedError('tutorial_pii_redaction_required')
    if (parsed.data.steps.some((step) => !step.thirdPartyUiAuthorized))
      throw new GenerationBlockedError('tutorial_ui_authorization_required')
    if (parsed.data.steps.some((step) => step.screenshotRef === null))
      throw new GenerationBlockedError('tutorial_screenshot_evidence_required')

    return pageModuleSchema.parse({
      ...parsed.data.envelope,
      module_type: 'tutorial',
      review_state: 'candidate',
      payload: {
        application_version: parsed.data.applicationVersion,
        steps: parsed.data.steps.map((step) => ({
          selector: step.selector,
          action: step.action,
          assertion: step.assertion,
          result: step.result,
          screenshot_ref: step.screenshotRef,
          pii_redacted: step.piiRedacted,
          third_party_ui_authorized: step.thirdPartyUiAuthorized,
        })),
      },
    })
  }
}
