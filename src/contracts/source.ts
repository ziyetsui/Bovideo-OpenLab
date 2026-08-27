import { z } from 'zod'

import {
  assertUnchanged,
  auditMetadataSchema,
  immutableIdSchema,
  RelationRef,
  schemaVersionSchema,
  utcTimestampSchema,
  versionedHashSchema,
} from './common'
import { rightsStateSchema } from './rights'
import { objectRefSchema } from '@/storage/object-ref'

export const SOURCE_PROVIDERS = ['twitter241', 'x_public_search', 'first_party', 'submission', 'official_doc'] as const
export const sourceProviderSchema = z.enum(SOURCE_PROVIDERS)
export const sourceDeletionStateSchema = z.enum(['active', 'requested', 'removed'])

export const sourceSchema = z
  .object({
    id: immutableIdSchema,
    schema_version: schemaVersionSchema,
    created_at: utcTimestampSchema,
    updated_at: utcTimestampSchema,
    provider: sourceProviderSchema,
    provider_record_id: z.string().min(1),
    // Old persisted source revisions predate semantic identity. The migration
    // backfills X rows; non-X sources legitimately remain null.
    semantic_key: z.string().min(1).nullable().optional(),
    canonical_url: z.url(),
    raw_ref: objectRefSchema,
    captured_at: utcTimestampSchema,
    content_hash: versionedHashSchema,
    supersedes_source_ref: z
      .object({ type: z.literal('source'), id: immutableIdSchema })
      .strict()
      .nullable(),
    author_ref: z
      .object({ type: z.literal('taxonomy_node'), id: immutableIdSchema })
      .strict()
      .nullable(),
    rights_state: rightsStateSchema,
    rights_basis: z.string().min(1).nullable(),
    deletion_state: sourceDeletionStateSchema,
    audit: auditMetadataSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.raw_ref.namespace !== 'raw-evidence') {
      context.addIssue({ code: 'custom', message: 'raw_ref must use raw-evidence namespace', path: ['raw_ref', 'namespace'] })
    }
    if (value.raw_ref.content_hash !== value.content_hash) {
      context.addIssue({ code: 'custom', message: 'raw_ref content hash must match source content_hash', path: ['raw_ref', 'content_hash'] })
    }
    if (
      ['display_licensed', 'redistribution_licensed', 'first_party'].includes(value.rights_state) &&
      value.rights_basis === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'rights_basis is required for licensed or first-party content',
        path: ['rights_basis'],
      })
    }
  })
export type Source = z.infer<typeof sourceSchema>

export const sourceUniqueKey = (
  source: Pick<Source, 'provider' | 'provider_record_id' | 'content_hash'> &
    Record<string, unknown>,
): string =>
  `${source.provider}:${encodeURIComponent(source.provider_record_id)}:${source.content_hash}`

export type SourceRevisionDecision =
  | Readonly<{ allowed: true; code: 'allowed' }>
  | Readonly<{
      allowed: false
      code: 'same_source_id' | 'unchanged_content_hash' | 'supersession_mismatch'
    }>

export class SourceRevisionError extends Error {
  readonly code: Exclude<SourceRevisionDecision['code'], 'allowed'>

  constructor(code: Exclude<SourceRevisionDecision['code'], 'allowed'>) {
    super(`source revision rejected: ${code}`)
    this.name = 'SourceRevisionError'
    this.code = code
  }
}

export const decideSourceRevision = (
  previous: Source,
  successor: Source,
): SourceRevisionDecision => {
  if (previous.id === successor.id) return { allowed: false, code: 'same_source_id' }
  if (previous.content_hash === successor.content_hash)
    return { allowed: false, code: 'unchanged_content_hash' }
  if (
    successor.supersedes_source_ref === null ||
    successor.supersedes_source_ref.type !== 'source' ||
    successor.supersedes_source_ref.id !== previous.id
  ) {
    return { allowed: false, code: 'supersession_mismatch' }
  }
  return { allowed: true, code: 'allowed' }
}

export const sourceRevisionKey = (
  previous: Source,
  successor: Source,
): Readonly<{ supersedes_source_ref: RelationRef; content_hash: string }> => {
  const decision = decideSourceRevision(previous, successor)
  if (!decision.allowed) throw new SourceRevisionError(decision.code)
  const supersedesSourceRef = successor.supersedes_source_ref
  if (supersedesSourceRef === null) throw new SourceRevisionError('supersession_mismatch')
  return {
    supersedes_source_ref: supersedesSourceRef,
    content_hash: successor.content_hash,
  }
}

export const assertSourceMutationAllowed = (current: Source, next: Source): void => {
  assertUnchanged(current, next, [
    'id',
    'provider',
    'provider_record_id',
    'raw_ref',
    'captured_at',
    'content_hash',
    'supersedes_source_ref',
  ])
}
