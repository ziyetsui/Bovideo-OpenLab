import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook, type CollectionBeforeValidateHook, type Field, type PayloadRequest } from 'payload'
import { z } from 'zod'

import { buildAuditEvent } from '@/access/audit-hook'
import { principalFromPayloadUser } from '@/access/principals'
import { createUlid } from '@/access/ulid'
import { IMMUTABLE_ID_PATTERN } from '@/contracts/common'
import { redirectSchema } from '@/contracts/redirect'
import { workflowRunSchema } from '@/contracts/workflow-run'

import { productionFields } from './shared'

type ContractKind = 'redirect' | 'workflowRun'
type RecordValue = Record<string, unknown>
type StateSnapshot = Readonly<{ status: string; revision: number }>
type RecordStateCommand = Readonly<{
  kind: ContractKind
  stable_id: string
  expected: StateSnapshot
  desired: StateSnapshot
  reason_code: string
  correlation_id: string
  actor: Readonly<{ id: string; type: 'user' | 'service' }>
}>

type WorkflowTransitionIntent = Readonly<{ command: RecordStateCommand }>
const workflowTransitionIntents = new WeakSet<object>()

/**
 * Creates the capability consumed by WorkflowRuns' normal Payload hooks for
 * non-atomic service transitions (for example direct snapshot import). It is
 * object-identity guarded, so a REST/GraphQL body cannot forge this path.
 */
export const createWorkflowRunTransitionRequest = (input: Readonly<{
  stable_id: string
  expected: StateSnapshot
  status: StateSnapshot['status']
  reason_code: string
  correlation_id: string
}>) => {
  const intent: WorkflowTransitionIntent = Object.freeze({
    command: Object.freeze({
      kind: 'workflowRun', stable_id: input.stable_id, expected: input.expected,
      desired: { status: input.status, revision: input.expected.revision + 1 },
      reason_code: input.reason_code, correlation_id: input.correlation_id,
      actor: { id: SYSTEM_ACTOR_ID, type: 'service' as const },
    }),
  })
  workflowTransitionIntents.add(intent)
  return { context: { phase3WorkflowTransition: intent } }
}

const SYSTEM_ACTOR_ID = '00000000000000000000000000'
const commonKeys = ['stable_id', 'revision', 'schema_version', 'source_version', 'status', 'audit']
const payloadMetadataKeys = ['id', 'createdAt', 'updatedAt']
const contractKeys: Record<ContractKind, readonly string[]> = {
  redirect: [...commonKeys, ...payloadMetadataKeys, 'locale', 'old_path', 'target_path', 'reason_code'],
  workflowRun: [...commonKeys, ...payloadMetadataKeys, 'job_type', 'idempotency_key', 'attempt', 'input_ref', 'output_ref', 'error_class', 'lease_owner', 'lease_expires_at'],
}

const asRecord = (value: unknown): RecordValue =>
  typeof value === 'object' && value !== null ? value as RecordValue : {}

type CanonicalAuditActor = { type: 'user' | 'service'; id: string }

const canonicalActorFromRecord = (value: RecordValue): CanonicalAuditActor | undefined => {
  const stableID = value.stable_id
  if (typeof stableID === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/i.test(stableID)) {
    return { type: value.identity_kind === 'service' ? 'service' : 'user', id: stableID }
  }
  return undefined
}

const canonicalActor = (user: unknown): CanonicalAuditActor => {
  const actor = canonicalActorFromRecord(asRecord(user))
  if (actor !== undefined) return actor
  return { type: 'service', id: SYSTEM_ACTOR_ID }
}

const canonicalAudit = (record: RecordValue, user: unknown) => {
  const audit = asRecord(record.audit)
  const fallbackActor = canonicalActor(user)
  const actorFromStoredRelation = (value: unknown): CanonicalAuditActor =>
    canonicalActorFromRecord(asRecord(value)) ?? fallbackActor
  return {
    created_by: actorFromStoredRelation(audit.created_by),
    updated_by: actorFromStoredRelation(audit.updated_by),
    correlation_id: typeof audit.correlation_id === 'string' ? audit.correlation_id : createUlid(),
  }
}

const payloadTimestamp = (value: unknown): string =>
  typeof value === 'string' ? value : new Date().toISOString()

/** Maps a complete Payload redirect document into its strict canonical contract form. */
export const normalizeRedirectPayloadDocument = (document: unknown, user?: unknown) => {
  const value = asRecord(document)
  return {
    id: value.stable_id,
    schema_version: value.schema_version,
    revision: value.revision,
    source_version: value.source_version,
    locale: value.locale,
    old_path: value.old_path,
    target_path: value.target_path ?? null,
    status: value.status,
    reason_code: value.reason_code,
    created_at: payloadTimestamp(value.createdAt),
    audit: canonicalAudit(value, user),
  }
}

/** Maps a complete Payload workflow-run document into its strict canonical contract form. */
export const normalizeWorkflowRunPayloadDocument = (document: unknown, user?: unknown) => {
  const value = asRecord(document)
  return {
    id: value.stable_id,
    schema_version: value.schema_version,
    revision: value.revision,
    source_version: value.source_version,
    job_type: value.job_type,
    idempotency_key: value.idempotency_key,
    attempt: value.attempt,
    input_ref: value.input_ref,
    output_ref: value.output_ref ?? null,
    status: value.status,
    error_class: value.error_class ?? null,
    lease_owner: value.lease_owner ?? null,
    lease_expires_at: value.lease_expires_at ?? null,
    created_at: payloadTimestamp(value.createdAt),
    updated_at: payloadTimestamp(value.updatedAt),
    audit: canonicalAudit(value, user),
  }
}

const schemaFor = (kind: ContractKind): z.ZodType => kind === 'redirect' ? redirectSchema : workflowRunSchema

/** Validates the fully normalized persisted document, never a permissive Payload subset. */
export const validateCanonicalPayloadDocument = (kind: ContractKind, document: unknown, user?: unknown): void => {
  const normalized = kind === 'redirect'
    ? normalizeRedirectPayloadDocument(document, user)
    : normalizeWorkflowRunPayloadDocument(document, user)
  schemaFor(kind).parse(normalized)
}

const contractInputError = (field: string): APIError<{ field: string }> =>
  new APIError(`${field} is server-managed or not part of the canonical Payload contract`, 400, { field })

const stateConflict = (): APIError<{ code: string; field: string }> =>
  new APIError('record state version_conflict', 409, { code: 'version_conflict', field: 'status' })

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const stateSnapshot = (value: unknown): StateSnapshot | undefined => {
  const record = asRecord(value)
  return typeof record.status === 'string' &&
    typeof record.revision === 'number' && Number.isInteger(record.revision) && record.revision > 0
    ? { status: record.status, revision: record.revision }
    : undefined
}

const privateRecordStateCommand = (kind: ContractKind, context: unknown): RecordStateCommand | undefined => {
  const phase3Intent = asRecord(context).phase3WorkflowTransition
  if (kind === 'workflowRun' && typeof phase3Intent === 'object' && phase3Intent !== null && workflowTransitionIntents.has(phase3Intent))
    return (phase3Intent as WorkflowTransitionIntent).command
  const record = asRecord(asRecord(context).phase1RecordStateCommand)
  const expected = stateSnapshot(record.expected)
  const desired = stateSnapshot(record.desired)
  const actor = asRecord(record.actor)
  if (
    record.kind !== kind ||
    typeof record.stable_id !== 'string' || !IMMUTABLE_ID_PATTERN.test(record.stable_id) ||
    expected === undefined || desired === undefined ||
    typeof record.reason_code !== 'string' || record.reason_code.length === 0 ||
    typeof record.correlation_id !== 'string' || !IMMUTABLE_ID_PATTERN.test(record.correlation_id) ||
    typeof actor.id !== 'string' || !IMMUTABLE_ID_PATTERN.test(actor.id) ||
    (actor.type !== 'user' && actor.type !== 'service')
  ) return undefined
  return {
    kind,
    stable_id: record.stable_id,
    expected,
    desired,
    reason_code: record.reason_code,
    correlation_id: record.correlation_id,
    actor: { id: actor.id, type: actor.type },
  }
}

const auditDeniedRecordMutation = async (
  kind: ContractKind,
  req: PayloadRequest,
  previous: RecordValue,
  changed: RecordValue,
  reasonCode: string,
): Promise<void> => {
  await req.payload.create({
    collection: 'audit-events',
    data: buildAuditEvent({
      action: `${kind === 'redirect' ? 'redirects' : 'workflow-runs'}.state_denied`,
      actor: principalFromPayloadUser(req.user),
      entity: { type: kind === 'redirect' ? 'redirects' : 'workflow-runs', id: String(previous.stable_id ?? previous.id ?? 'unknown') },
      correlationId: createUlid(),
      outcome: 'denied',
      reasonCode,
      before: previous,
      after: changed,
    }) as never,
    overrideAccess: true,
  })
}

const rejectUnknownOrClientManagedFacts = async (
  kind: ContractKind,
  data: RecordValue,
  previous: RecordValue,
  operation: 'create' | 'update',
  req: PayloadRequest,
): Promise<void> => {
  for (const key of Object.keys(data)) {
    if (!contractKeys[kind].includes(key)) {
      await auditDeniedRecordMutation(kind, req, previous, data, 'unknown_canonical_key')
      throw contractInputError(key)
    }
  }
  // Payload applies a stable_id default before this hook, making a client value
  // indistinguishable from that default. The hook therefore overwrites it below.
  for (const field of ['id', 'created_at', 'updated_at']) {
    if (data[field] !== undefined) {
      await auditDeniedRecordMutation(kind, req, previous, data, 'server_managed_field')
      throw contractInputError(field)
    }
  }
  if (operation === 'create') for (const field of ['createdAt', 'updatedAt']) {
    if (data[field] !== undefined) {
      await auditDeniedRecordMutation(kind, req, previous, data, 'server_managed_timestamp')
      throw contractInputError(field)
    }
  }
  // Payload materializes an empty group before this hook. A populated group is a
  // caller attempt to establish audit facts and must fail closed.
  if (operation === 'create' && Object.values(asRecord(data.audit)).some((value) => value !== undefined && value !== null && value !== '')) {
    await auditDeniedRecordMutation(kind, req, previous, data, 'server_managed_audit')
    throw contractInputError('audit')
  }
  if (operation === 'update') {
    for (const field of ['createdAt', 'updatedAt', 'audit']) {
      if (data[field] !== undefined && !sameValue(data[field], previous[field])) {
        await auditDeniedRecordMutation(kind, req, previous, data, `server_managed_${field}`)
        throw contractInputError(field)
      }
    }
  }
}

const payloadAudit = (
  operation: 'create' | 'update',
  originalDoc: RecordValue,
  user: unknown,
  correlationID = createUlid(),
): RecordValue => {
  const actor = asRecord(user)
  const actorID = actor.id
  const originalAudit = asRecord(originalDoc.audit)
  return {
    ...(operation === 'update' && originalAudit.created_by !== undefined ? { created_by: originalAudit.created_by } : {}),
    ...(actorID !== undefined && actorID !== null ? {
      ...(operation === 'create' ? { created_by: actorID } : {}),
      updated_by: actorID,
    } : {}),
    correlation_id: correlationID,
  }
}

const mergePayloadRecord = (originalDoc: unknown, data: unknown): RecordValue => ({
  ...asRecord(originalDoc),
  ...asRecord(data),
})

/** The two strict collections require an audit group that only hooks may populate. */
export const serverManagedProductionFields = (statusOptions: readonly string[], defaultStatus: string): Field[] =>
  productionFields(statusOptions, defaultStatus).map((field) =>
    'name' in field && field.name === 'audit' ? { ...field, required: true } : field,
  )

export const canonicalPayloadBeforeValidate = (kind: ContractKind): CollectionBeforeValidateHook => ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const changed = asRecord(data)
  const previous = asRecord(originalDoc)
  return (async () => {
    await rejectUnknownOrClientManagedFacts(kind, changed, previous, operation, req)
    let stateCommand: RecordStateCommand | undefined
    const statusChanged = operation === 'update' && changed.status !== undefined && changed.status !== previous.status
    if (statusChanged) {
      stateCommand = privateRecordStateCommand(kind, req.context)
      const principal = principalFromPayloadUser(req.user)
      const phase3Intent = asRecord(req.context).phase3WorkflowTransition
      const trustedWorkflowIntent = kind === 'workflowRun' &&
        typeof phase3Intent === 'object' && phase3Intent !== null && workflowTransitionIntents.has(phase3Intent)
      if (
        stateCommand === undefined ||
        stateCommand.stable_id !== previous.stable_id ||
        !sameValue(stateCommand.expected, stateSnapshot(previous)) ||
        stateCommand.desired.revision !== stateCommand.expected.revision + 1 ||
        stateCommand.desired.status !== changed.status ||
        (!trustedWorkflowIntent && (stateCommand.actor.id !== principal.id || stateCommand.actor.type !== principal.kind))
      ) {
        await auditDeniedRecordMutation(kind, req, previous, changed, 'record_state_version_conflict')
        throw stateConflict()
      }
    }
    if (operation === 'create') {
      // Payload defaults are convenience only. The server always assigns the durable identity.
      changed.stable_id = createUlid()
      changed.revision = 1
      changed.schema_version = 1
    } else {
      changed.stable_id = previous.stable_id
      changed.schema_version = previous.schema_version
      // Non-state changes retain the persisted revision. A state change is only
      // possible through the expected-revision command above.
      changed.revision = stateCommand?.desired.revision ?? previous.revision
      changed.createdAt = previous.createdAt
      changed.updatedAt = new Date().toISOString()
    }
    if (kind === 'redirect') changed.target_path ??= null
    else {
      changed.output_ref ??= null
      changed.error_class ??= null
      changed.lease_owner ??= null
      changed.lease_expires_at ??= null
    }
    changed.audit = payloadAudit(operation, previous, req.user, stateCommand?.correlation_id)
    return changed
  })()
}

/** Runs after field validation, when a full document can be normalized and checked. */
export const canonicalPayloadBeforeChange = (kind: ContractKind): CollectionBeforeChangeHook => ({
  data,
  originalDoc,
  req,
}) => {
  validateCanonicalPayloadDocument(kind, mergePayloadRecord(originalDoc, data), req.user)
  return data
}

/** Checks Payload's actual persisted timestamps and null serialization before commit. */
export const canonicalPayloadAfterChange = (kind: ContractKind): CollectionAfterChangeHook => ({ doc, req }) => {
  validateCanonicalPayloadDocument(kind, doc, req.user)
  return doc
}

/** Emits the command-bound allowed audit instead of the generic update audit for an accepted state CAS. */
export const auditCanonicalPayloadStateChange = async (
  kind: ContractKind,
  collection: 'redirects' | 'workflow-runs',
  args: Parameters<CollectionAfterChangeHook>[0],
): Promise<boolean> => {
  if (args.operation !== 'update') return false
  const command = privateRecordStateCommand(kind, args.req.context)
  const previous = asRecord(args.previousDoc)
  const changed = asRecord(args.doc)
  const principal = principalFromPayloadUser(args.req.user)
  if (
    command === undefined ||
    changed.status === previous.status ||
    command.stable_id !== previous.stable_id ||
    !sameValue(command.expected, stateSnapshot(previous)) ||
    !sameValue(command.desired, stateSnapshot(changed)) ||
    command.actor.id !== principal.id || command.actor.type !== principal.kind
  ) return false
  await args.req.payload.create({
    collection: 'audit-events',
    data: buildAuditEvent({
      action: `${collection}.state_transition`,
      actor: principal,
      entity: { type: collection, id: String(changed.stable_id ?? changed.id ?? 'unknown') },
      correlationId: command.correlation_id,
      outcome: 'allowed',
      reasonCode: command.reason_code,
      before: previous,
      after: changed,
    }) as never,
    req: args.req,
    overrideAccess: true,
  })
  return true
}
