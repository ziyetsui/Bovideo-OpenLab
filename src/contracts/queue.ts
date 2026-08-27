import { z } from 'zod'

import {
  relationRefSchema,
  schemaVersionSchema,
  ulidSchema,
  utcTimestampSchema,
  versionedHashSchema,
} from './common'
import { applicationLocaleSchema } from './locale'

export const queueEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    job_id: ulidSchema,
    kind: z.enum(['ingest', 'translate', 'browser', 'publish', 'export', 'withdraw']),
    entity_ref: relationRefSchema,
    expected_source_version: versionedHashSchema.nullable(),
    idempotency_key: z.string().min(1).max(512),
    correlation_id: ulidSchema,
    causation_id: ulidSchema.nullable(),
    traceparent: z.string().regex(/^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[01]{2}$/).optional(),
    attempt: z.number().int().nonnegative(),
    enqueued_at: utcTimestampSchema,
    priority: z.enum(['normal', 'high', 'emergency']),
  })
  .strict()
  .superRefine((envelope, context) => {
    if (!isQueueIdempotencyKeyForKind(envelope.kind, envelope.idempotency_key))
      context.addIssue({ code: 'custom', path: ['idempotency_key'], message: 'idempotency key does not match queue kind' })
  })
export type QueueEnvelope = z.infer<typeof queueEnvelopeSchema>

export const buildTranslateIdempotencyKey = (
  input: Readonly<{
    entity_id: string
    locale: z.infer<typeof applicationLocaleSchema>
    source_hash: string
    prompt_version: string
    model: string
  }>,
): string =>
  `translate:${input.entity_id}:${input.locale}:${input.source_hash}:${input.prompt_version}:${input.model}`
export const buildPublishIdempotencyKey = (contentTreeHash: string): string =>
  `publish:${contentTreeHash}`
export const buildExportIdempotencyKey = (publishVersion: number, exportTreeHash: string): string =>
  `github:${publishVersion}:${exportTreeHash}`
export const buildWithdrawIdempotencyKey = (entityId: string, requestVersion: number): string =>
  `withdraw:${entityId}:${requestVersion}`

/** Stable key for an immutable source revision. This key deliberately has no content field. */
export const buildIngestIdempotencyKey = (entityId: string, sourceHash: string): string =>
  `ingest:${entityId}:${sourceHash}`

/** Stable key for a browser job whose durable result is a versioned object reference. */
export const buildBrowserIdempotencyKey = (entityId: string, sourceHash: string): string =>
  `browser:${entityId}:${sourceHash}`

const immutableIdToken = '(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})'
const versionedHashToken = 'sha256:v1:[a-f0-9]{64}'
const keyPatterns = {
  ingest: new RegExp(`^ingest:${immutableIdToken}:${versionedHashToken}$`, 'i'),
  translate: new RegExp(`^translate:${immutableIdToken}:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*:${versionedHashToken}:[A-Za-z0-9._-]{1,128}:[A-Za-z0-9._-]{1,128}$`),
  browser: new RegExp(`^browser:${immutableIdToken}:${versionedHashToken}$`, 'i'),
  publish: new RegExp(`^publish:${versionedHashToken}$`),
  export: new RegExp(`^github:[1-9][0-9]*:${versionedHashToken}$`),
  withdraw: new RegExp(`^withdraw:${immutableIdToken}:[1-9][0-9]*$`, 'i'),
} as const

/** Rejects prose, credentials and unbounded arbitrary data from queue idempotency keys. */
export const isQueueIdempotencyKeyForKind = (
  kind: QueueEnvelope['kind'],
  idempotencyKey: string,
): boolean => keyPatterns[kind].test(idempotencyKey)

export class VersionConflictError extends Error {
  readonly code = 'version_conflict' as const
  readonly expected_revision: number
  readonly actual_revision: number

  constructor(
    input: Readonly<{ entity_id: string; expected_revision: number; actual_revision: number }>,
  ) {
    super(
      `version conflict for ${input.entity_id}: expected ${input.expected_revision}, got ${input.actual_revision}`,
    )
    this.name = 'VersionConflictError'
    this.expected_revision = input.expected_revision
    this.actual_revision = input.actual_revision
  }
}

export const queueSchemaVersion = schemaVersionSchema
