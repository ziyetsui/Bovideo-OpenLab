import { z } from 'zod'

import {
  assertUnchanged,
  immutableIdSchema,
  schemaVersionSchema,
  utcTimestampSchema,
  versionedHashSchema,
} from './common'
import { rightsStateSchema } from './rights'

export const artifactSchema = z
  .object({
    id: immutableIdSchema,
    schema_version: schemaVersionSchema,
    created_at: utcTimestampSchema,
    updated_at: utcTimestampSchema,
    kind: z.enum(['prompt', 'workflow', 'comparison']),
    canonical_label: z.string().min(1),
    source: z.object({ type: z.literal('source'), id: immutableIdSchema }).strict(),
    source_version: versionedHashSchema,
    original_language: z.string().min(1),
    original_text: z.string().min(1),
    rights_state: rightsStateSchema,
    safety_state: z.enum(['pending', 'approved', 'blocked']),
    evidence_state: z.enum(['pending', 'verified', 'insufficient']),
  })
  .strict()
export type Artifact = z.infer<typeof artifactSchema>

export const assertArtifactMutationAllowed = (current: Artifact, next: Artifact): void => {
  assertUnchanged(current, next, ['id', 'source', 'source_version', 'original_text'])
}
