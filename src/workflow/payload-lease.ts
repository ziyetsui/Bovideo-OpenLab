import type { Payload } from 'payload'
import { sql } from 'drizzle-orm'

import { isAuthenticatedPrincipal, type Principal } from '@/access/principals'
import { workflowRunSchema, type WorkflowJobType } from '@/contracts/workflow-run'
import { decideAccess } from '@/access/policy'
import type { WorkflowOutputRef } from './registry'

export type DurableWorkflowRun = Readonly<{
  id: number | string
  stable_id: string
  revision: number
  source_version: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'stale_ignored'
  job_type: WorkflowJobType
  idempotency_key: string
  attempt: number
  input_ref: string
  output_ref: string | null
  error_class: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  audit: Readonly<{ correlation_id: string | null }>
}>

type WorkflowStatus = DurableWorkflowRun['status']

/**
 * An opaque, one-use-in-process capability issued only by an authorized native
 * claim. Terminal calls accept this receipt instead of a caller-supplied run
 * and worker id, so a queued row cannot be terminalized by fabricating input.
 */
export type WorkflowLeaseReceipt = Readonly<{
  run: DurableWorkflowRun
  worker: Principal
}>

/** Opaque authorization issued from a Payload-authenticated service identity. */
export type WorkflowWorkerAuthorization = Readonly<Record<never, never>>

type WorkflowWorkerFacts = Readonly<{
  authenticatedPrincipal: Principal
  actor: Principal
  id: string
}>
type WorkflowLeaseFacts = Readonly<{ run: DurableWorkflowRun; worker: WorkflowWorkerFacts }>

const authorizedWorkers = new WeakMap<object, WorkflowWorkerFacts>()
const leaseReceipts = new WeakMap<object, WorkflowLeaseFacts>()

export class WorkflowLeaseCapabilityError extends Error {
  readonly code = 'workflow_lease_capability_invalid' as const

  constructor() {
    super('workflow terminal transition requires an acquired lease receipt')
    this.name = 'WorkflowLeaseCapabilityError'
  }
}

export class WorkflowWorkerAuthenticationError extends Error {
  readonly code = 'workflow_worker_authentication_required' as const

  constructor() {
    super('workflow claim requires a Payload-authenticated service principal')
    this.name = 'WorkflowWorkerAuthenticationError'
  }
}

export class WorkflowLeaseLostError extends Error {
  readonly code = 'workflow_lease_lost' as const

  constructor() {
    super('workflow run lease lost')
    this.name = 'WorkflowLeaseLostError'
  }
}

export class WorkflowProductionDatabaseRequiredError extends Error {
  constructor() {
    super('durable workflow workers require the Payload PostgreSQL database adapter')
    this.name = 'WorkflowProductionDatabaseRequiredError'
  }
}

type NativeWorkflowRow = Record<string, unknown>
type NativeDrizzle = Readonly<{ execute: (query: unknown) => Promise<Readonly<{ rows: readonly NativeWorkflowRow[] }>> }>

const nativeDrizzle = (payload: Payload): NativeDrizzle | null => {
  const database = payload.db as unknown
  if (typeof database !== 'object' || database === null || !('drizzle' in database)) return null
  const drizzle = (database as { drizzle?: unknown }).drizzle
  return typeof drizzle === 'object' && drizzle !== null && 'execute' in drizzle &&
    typeof (drizzle as { execute?: unknown }).execute === 'function'
    ? drizzle as NativeDrizzle
    : null
}

const requireNativeDrizzle = (payload: Payload): NativeDrizzle => {
  const drizzle = nativeDrizzle(payload)
  if (drizzle === null) throw new WorkflowProductionDatabaseRequiredError()
  return drizzle
}

const nativeRun = (row: NativeWorkflowRow): DurableWorkflowRun => ({
  id: row.id as number | string,
  stable_id: String(row.stable_id),
  revision: Number(row.revision),
  source_version: String(row.source_version),
  status: row.status as WorkflowStatus,
  job_type: row.job_type as WorkflowJobType,
  idempotency_key: String(row.idempotency_key),
  attempt: Number(row.attempt),
  input_ref: String(row.input_ref),
  output_ref: typeof row.output_ref === 'string' ? row.output_ref : null,
  error_class: typeof row.error_class === 'string' ? row.error_class : null,
  lease_owner: typeof row.lease_owner === 'string' ? row.lease_owner : null,
  lease_expires_at: typeof row.lease_expires_at === 'string' ? new Date(row.lease_expires_at).toISOString() : null,
  audit: { correlation_id: typeof row.audit_correlation_id === 'string' ? row.audit_correlation_id : null },
})

const auditTransition = (
  workerID: string,
  reasonCode: string | ReturnType<typeof sql>,
) => sql`
  INSERT INTO audit_events (
    event_id, stable_id, schema_version, source_version, status,
    actor_service, actor_type, actor_stable_id, correlation_id,
    event_type, entity_type, entity_stable_id, outcome,
    prior_state, new_state, reason_code, occurred_at
  )
  SELECT
    ${globalThis.crypto.randomUUID()}, ${globalThis.crypto.randomUUID()}, 1, 'audit:workflow-runs.state_transition', 'recorded',
    ${workerID}, 'service', ${workerID}, audit_correlation_id,
    'workflow-runs.state_transition', 'workflow-runs', stable_id, 'allowed',
    jsonb_build_object('status', previous_status, 'revision', previous_revision),
    jsonb_build_object('status', status, 'revision', revision), ${reasonCode}, NOW()
  FROM transition
`

const OUTPUT_REF_MAX_LENGTH = 512
const outputRefPattern = /^private\/[a-z0-9][a-z0-9/_-]*$/i

const requireAuthorizedWorker = (worker: Principal, operation: 'claim' | 'transition'): void => {
  if (!isAuthenticatedPrincipal(worker)) throw new WorkflowWorkerAuthenticationError()
  if (worker.kind !== 'service' || worker.id.trim().length === 0 || worker.roles.length !== 0 || worker.serviceScopes.length !== 1)
    throw new Error('workflow worker principal is invalid')
  const decision = decideAccess({
    principal: worker,
    action: 'workflow_run_status_transition', resource: { collection: 'workflow-runs' }, path: 'internal',
  })
  if (!decision.allowed) throw new Error(`workflow ${operation} denied: ${decision.reason}`)
}

const copyWorker = (worker: Principal, freeze: boolean): Principal => {
  const value = {
    ...worker,
    roles: freeze ? Object.freeze([...worker.roles]) : [...worker.roles],
    serviceScopes: freeze ? Object.freeze([...worker.serviceScopes]) : [...worker.serviceScopes],
  }
  return freeze ? Object.freeze(value) as Principal : value as Principal
}

const copyRun = (run: DurableWorkflowRun, freeze: boolean): DurableWorkflowRun => {
  const value = { ...run, audit: freeze ? Object.freeze({ ...run.audit }) : { ...run.audit } }
  return freeze ? Object.freeze(value) as DurableWorkflowRun : value as DurableWorkflowRun
}

/** Converts a Payload-authenticated service principal into an opaque worker authorization. */
export const authorizeWorkflowWorker = (principal: Principal): WorkflowWorkerAuthorization => {
  requireAuthorizedWorker(principal, 'claim')
  const authorization: WorkflowWorkerAuthorization = Object.freeze({})
  authorizedWorkers.set(authorization, Object.freeze({
    authenticatedPrincipal: principal,
    actor: copyWorker(principal, true),
    id: principal.id,
  }))
  return authorization
}

const requireAuthorizedWorkerFacts = (worker: WorkflowWorkerAuthorization): WorkflowWorkerFacts => {
  const facts = authorizedWorkers.get(worker)
  if (facts === undefined) throw new WorkflowWorkerAuthenticationError()
  requireAuthorizedWorker(facts.authenticatedPrincipal, 'claim')
  return facts
}

const issueLeaseReceipt = (run: DurableWorkflowRun, worker: WorkflowWorkerFacts): WorkflowLeaseReceipt => {
  // The public fields make a receipt inspectable for handlers, but terminal
  // decisions deliberately read only the separate immutable WeakMap facts.
  const receipt: WorkflowLeaseReceipt = Object.freeze({ run: copyRun(run, false), worker: copyWorker(worker.actor, false) })
  leaseReceipts.set(receipt, Object.freeze({ run: copyRun(run, true), worker }))
  return receipt
}

const requireCurrentLeaseReceipt = (receipt: WorkflowLeaseReceipt): WorkflowLeaseFacts => {
  const facts = leaseReceipts.get(receipt)
  if (facts === undefined) throw new WorkflowLeaseCapabilityError()
  const { run, worker } = facts
  requireAuthorizedWorker(worker.authenticatedPrincipal, 'transition')
  if (run.status !== 'running' || run.lease_owner !== worker.id || run.lease_expires_at === null || new Date(run.lease_expires_at).valueOf() <= Date.now())
    throw new WorkflowLeaseLostError()
  return facts
}

/**
 * PostgreSQL row locks are necessary for leases. This narrow preflight keeps
 * native SQL behind the same canonical schema and access decision as Payload.
 */
export const validateNativeWorkflowTransition = (
  receipt: WorkflowLeaseReceipt,
  status: WorkflowStatus,
  data: Readonly<{ output_ref: string | null; error_class: string | null }>,
): void => {
  const { run, worker } = requireCurrentLeaseReceipt(receipt)
  if (data.output_ref !== null && (data.output_ref.length > OUTPUT_REF_MAX_LENGTH || !outputRefPattern.test(data.output_ref)))
    throw new Error('workflow output_ref is invalid')
  const now = new Date().toISOString()
  workflowRunSchema.parse({
    id: run.stable_id, schema_version: 1, revision: run.revision + 1,
    source_version: run.source_version, job_type: run.job_type, idempotency_key: run.idempotency_key,
    attempt: run.attempt, input_ref: run.input_ref, output_ref: data.output_ref, status,
    error_class: data.error_class, created_at: now, updated_at: now,
    lease_owner: status === 'running' ? worker.id : null,
    lease_expires_at: status === 'running' ? new Date(Date.now() + 60_000).toISOString() : null,
    audit: { created_by: { type: 'service', id: run.stable_id }, updated_by: { type: 'service', id: run.stable_id }, correlation_id: run.audit.correlation_id ?? run.stable_id },
  })
}

/** Applies the workflow access policy before the narrow PostgreSQL claim statement. */
export const validateNativeWorkflowClaim = (worker: WorkflowWorkerAuthorization): void => { requireAuthorizedWorkerFacts(worker) }

const nativeTransition = async (
  drizzle: NativeDrizzle,
  receipt: WorkflowLeaseReceipt,
  status: WorkflowStatus,
  data: Readonly<{ output_ref: string | null; error_class: string | null }>,
  reasonCode: string,
): Promise<DurableWorkflowRun> => {
  validateNativeWorkflowTransition(receipt, status, data)
  const { run, worker } = requireCurrentLeaseReceipt(receipt)
  const correlationID = run.audit.correlation_id ?? run.stable_id
  const updated = sql`
    UPDATE workflow_runs
    SET
      status = ${status},
      revision = revision + 1,
      output_ref = ${data.output_ref},
      error_class = ${data.error_class},
      lease_owner = NULL,
      lease_expires_at = NULL,
      audit_correlation_id = ${correlationID},
      updated_at = NOW()
    WHERE id = ${run.id} AND revision = ${run.revision} AND status = 'running'
      AND lease_owner = ${worker.id} AND lease_expires_at > NOW()
    RETURNING *, 'running'::text AS previous_status, ${run.revision}::numeric AS previous_revision
  `
  const result = await drizzle.execute(sql`
    WITH transition AS (${updated}), audit AS (${auditTransition(worker.id, reasonCode)})
    SELECT * FROM transition
  `)
  const row = result.rows[0]
  if (row === undefined) throw new WorkflowLeaseLostError()
  return nativeRun(row)
}

const nativeClaim = async (drizzle: NativeDrizzle, worker: WorkflowWorkerAuthorization): Promise<DurableWorkflowRun | null> => {
  const workerFacts = requireAuthorizedWorkerFacts(worker)
  const correlationID = globalThis.crypto.randomUUID()
  const candidate = sql`
    SELECT id, revision, status AS previous_status
    FROM workflow_runs
    WHERE status = 'queued' OR (status = 'running' AND lease_expires_at <= NOW())
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `
  const claimed = sql`
    UPDATE workflow_runs AS run
    SET status = 'running', revision = run.revision + 1, attempt = run.attempt + 1,
      output_ref = NULL, error_class = NULL, lease_owner = ${workerFacts.id}, lease_expires_at = NOW() + INTERVAL '5 minutes',
      audit_correlation_id = COALESCE(run.audit_correlation_id, ${correlationID}), updated_at = NOW()
    FROM (${candidate}) AS candidate
    WHERE run.id = candidate.id AND run.revision = candidate.revision
      AND (run.status = 'queued' OR (run.status = 'running' AND run.lease_expires_at <= NOW()))
    RETURNING run.*, candidate.previous_status, (run.revision - 1)::numeric AS previous_revision
  `
  const result = await drizzle.execute(sql`
    WITH transition AS (${claimed}), audit AS (${auditTransition(workerFacts.id, sql`CASE WHEN previous_status = 'running' THEN 'workflow_lease_taken_over' ELSE 'workflow_claimed' END`)})
    SELECT * FROM transition
  `)
  const row = result.rows[0]
  return row === undefined ? null : nativeRun(row)
}

const transition = async (
  payload: Payload,
  receipt: WorkflowLeaseReceipt,
  status: WorkflowStatus,
  data: Readonly<{ output_ref: string | null; error_class: string | null }>,
  reasonCode: string,
): Promise<DurableWorkflowRun> => {
  return nativeTransition(requireNativeDrizzle(payload), receipt, status, data, reasonCode)
}

/** Finds the oldest queued or expired-running row and claims it through its persisted revision. */
export const claimOldestQueuedRun = async (payload: Payload, worker: WorkflowWorkerAuthorization): Promise<WorkflowLeaseReceipt | null> => {
  validateNativeWorkflowClaim(worker)
  const run = await nativeClaim(requireNativeDrizzle(payload), worker)
  return run === null ? null : issueLeaseReceipt(run, requireAuthorizedWorkerFacts(worker))
}

export const succeedRun = async (
  payload: Payload,
  receipt: WorkflowLeaseReceipt,
  outputRef: WorkflowOutputRef,
): Promise<DurableWorkflowRun> =>
  transition(payload, receipt, 'succeeded', { output_ref: outputRef, error_class: null }, 'workflow_succeeded')

export const failRun = async (
  payload: Payload,
  receipt: WorkflowLeaseReceipt,
  errorClass: string,
): Promise<DurableWorkflowRun> =>
  transition(payload, receipt, 'failed', { output_ref: null, error_class: errorClass }, 'workflow_failed')

export const staleIgnoreRun = async (
  payload: Payload,
  receipt: WorkflowLeaseReceipt,
): Promise<DurableWorkflowRun> =>
  transition(payload, receipt, 'stale_ignored', { output_ref: null, error_class: null }, 'workflow_stale_ignored')
