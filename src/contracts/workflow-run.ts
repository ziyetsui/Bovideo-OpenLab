import { z } from 'zod'

import {
  auditMetadataSchema,
  immutableIdSchema,
  revisionSchema,
  schemaVersionSchema,
  utcTimestampSchema,
  versionedHashSchema,
} from './common'

export const WORKFLOW_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'stale_ignored'] as const
export const WORKFLOW_RUN_JOB_TYPES = [
  'ingest',
  'translate',
  'browser',
  'publish',
  'export',
  'withdraw',
  'extract_graph',
  'generate_module',
  'project_page',
  'validate_release',
  'observe_search',
] as const
export const DEFAULT_WORKFLOW_RUN_STATUS = WORKFLOW_RUN_STATUSES[0]
export const workflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES)
export const workflowRunJobTypeSchema = z.enum(WORKFLOW_RUN_JOB_TYPES)
export type WorkflowJobType = z.infer<typeof workflowRunJobTypeSchema>

/** Canonical durable worker execution record; unknown fields are rejected. */
export const workflowRunSchema = z.object({
  id: immutableIdSchema,
  schema_version: schemaVersionSchema,
  revision: revisionSchema,
  source_version: versionedHashSchema,
  job_type: workflowRunJobTypeSchema,
  idempotency_key: z.string().min(1).max(512),
  attempt: z.number().int().nonnegative(),
  input_ref: z.string().min(1),
  output_ref: z.string().min(1).nullable(),
  status: workflowRunStatusSchema,
  error_class: z.string().min(1).nullable(),
  lease_owner: z.string().min(1).max(256).nullable(),
  lease_expires_at: utcTimestampSchema.nullable(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  audit: auditMetadataSchema,
}).strict().superRefine((value, context) => {
  const requiresOutput = value.status === 'succeeded'
  const requiresError = value.status === 'failed'
  if (requiresOutput && value.output_ref === null)
    context.addIssue({ code: 'custom', path: ['output_ref'], message: 'succeeded workflow runs require output_ref' })
  if (!requiresOutput && value.output_ref !== null)
    context.addIssue({ code: 'custom', path: ['output_ref'], message: 'only succeeded workflow runs may have output_ref' })
  if (requiresError && value.error_class === null)
    context.addIssue({ code: 'custom', path: ['error_class'], message: 'failed workflow runs require error_class' })
  if (!requiresError && value.error_class !== null)
    context.addIssue({ code: 'custom', path: ['error_class'], message: 'only failed workflow runs may have error_class' })
  if (value.status === 'running' && (value.lease_owner === null || value.lease_expires_at === null))
    context.addIssue({ code: 'custom', path: ['lease_owner'], message: 'running workflow runs require an owner and expiry lease' })
  if (value.status !== 'running' && (value.lease_owner !== null || value.lease_expires_at !== null))
    context.addIssue({ code: 'custom', path: ['lease_owner'], message: 'only running workflow runs may retain a lease' })
})

export type WorkflowRun = z.infer<typeof workflowRunSchema>
