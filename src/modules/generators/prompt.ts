import { createHash } from 'node:crypto'

import { z } from 'zod'

import { immutableIdSchema, relationRefSchema } from '@/contracts/common'
import { pageModuleSchema, type PageModule } from '@/page/modules'

import { GenerationBlockedError } from '../errors'
import type { ModuleGenerator } from '../registry'
import { generationEnvelopeSchema, isDeclaredSource } from './shared'

const promptInputSchema = z.object({
  envelope: generationEnvelopeSchema,
  originalText: z.string().min(1),
  sourceRef: relationRefSchema,
  redistributionAllowed: z.boolean(),
  variationOf: immutableIdSchema.nullable(),
}).strict()

const tokenIntegrityHash = (text: string): string => `sha256:v1:${createHash('sha256').update(text).digest('hex')}`

/** Imports a supplied Prompt verbatim; it never rewrites unavailable source text. */
export class PromptModuleGenerator implements ModuleGenerator {
  async generate(input: unknown): Promise<PageModule> {
    const parsed = promptInputSchema.safeParse(input)
    if (!parsed.success) throw new GenerationBlockedError('prompt_input_unavailable')
    if (!isDeclaredSource(parsed.data.envelope.source_refs, parsed.data.sourceRef))
      throw new GenerationBlockedError('prompt_source_required')

    return pageModuleSchema.parse({
      ...parsed.data.envelope,
      module_type: 'prompt',
      review_state: 'candidate',
      payload: {
        original_text: parsed.data.originalText,
        source_ref: parsed.data.sourceRef,
        redistribution_allowed: parsed.data.redistributionAllowed,
        token_integrity_hash: tokenIntegrityHash(parsed.data.originalText),
        variation_of: parsed.data.variationOf,
      },
    })
  }
}
