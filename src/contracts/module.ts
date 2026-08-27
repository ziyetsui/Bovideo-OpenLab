import { z } from 'zod'

import {
  immutableIdSchema,
  relationRefSchema,
  schemaVersionSchema,
  utcTimestampSchema,
  versionedHashSchema,
} from './common'
import { applicationLocaleSchema } from './locale'
import { rightsStateSchema } from './rights'

export const moduleEnvelopeSchema = z
  .object({
    module_id: immutableIdSchema,
    page_id: immutableIdSchema,
    locale: applicationLocaleSchema,
    module_type: z.enum([
      'case',
      'tutorial',
      'prompt',
      'comparison',
      'faq',
      'examples',
      'provenance',
      'action',
    ]),
    module_version: z.number().int().positive(),
    source_refs: z.array(relationRefSchema).min(1),
    rights_state: rightsStateSchema,
    generated_by: z.enum(['human', 'rule', 'rpa', 'llm']),
    generator_version: z.string().min(1).nullable(),
    content_hash: versionedHashSchema,
    observed_at: utcTimestampSchema,
    expires_at: utcTimestampSchema.nullable(),
    review_state: z.enum(['candidate', 'approved', 'blocked', 'stale']),
    schema_version: schemaVersionSchema,
  })
  .strict()
export type ModuleEnvelope = z.infer<typeof moduleEnvelopeSchema>
