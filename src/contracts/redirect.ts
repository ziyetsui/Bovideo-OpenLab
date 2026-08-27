import { z } from 'zod'

import {
  auditMetadataSchema,
  immutableIdSchema,
  revisionSchema,
  schemaVersionSchema,
  utcTimestampSchema,
  versionedHashSchema,
} from './common'
import { applicationLocaleSchema } from './locale'

export const REDIRECT_STATUSES = ['301', '308', '410'] as const
export const DEFAULT_REDIRECT_STATUS = REDIRECT_STATUSES[0]
export const redirectStatusSchema = z.enum(REDIRECT_STATUSES)

/** Canonical redirect record; unknown fields are rejected at the contract boundary. */
export const redirectSchema = z.object({
  id: immutableIdSchema,
  schema_version: schemaVersionSchema,
  revision: revisionSchema,
  source_version: versionedHashSchema,
  locale: applicationLocaleSchema,
  old_path: z.string().startsWith('/'),
  target_path: z.string().startsWith('/').nullable(),
  status: redirectStatusSchema,
  reason_code: z.string().min(1),
  created_at: utcTimestampSchema,
  audit: auditMetadataSchema,
}).strict().superRefine((value, context) => {
  if (value.status === '410' && value.target_path !== null)
    context.addIssue({ code: 'custom', path: ['target_path'], message: '410 redirects must not have a target path' })
  if (value.status !== '410' && value.target_path === null)
    context.addIssue({ code: 'custom', path: ['target_path'], message: '301 and 308 redirects require a target path' })
})

export type Redirect = z.infer<typeof redirectSchema>
