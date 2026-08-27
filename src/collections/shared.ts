import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook, type CollectionBeforeDeleteHook, type Field, type PayloadRequest } from 'payload'
import { and, eq } from 'drizzle-orm'

import { decideDeletionTransition } from '@/contracts/deletion'
import { APPLICATION_LOCALES } from '@/contracts/locale'
import { decideLocaleTransition } from '@/contracts/locale'
import { decidePageTransition } from '@/contracts/page'
import { decidePublicationTransition } from '@/contracts/publication'
import { buildAuditEvent } from '@/access/audit-hook'
import { principalFromPayloadUser } from '@/access/principals'
import { decideLocaleContentRevision, deriveLocaleRisk } from '@/localization/state-machine'
import { localeEntityKey } from '@/localization/entity-identity'
import { versionedHashSchema } from '@/contracts/common'

export { APPLICATION_LOCALES } from '@/contracts/locale'

export const localeOptions = APPLICATION_LOCALES.map((value) => ({ label: value, value }))

const stableId = (): string => globalThis.crypto.randomUUID()

const immutableFieldError = (field: string): APIError<{ field: string }> =>
  new APIError(`${field} is immutable`, 400, { field })

const canonicalCommandError = (message: string): APIError<{ field: string }> =>
  new APIError(message, 400, { field: 'canonical_command' })

const localeContentCommandError = (message: string): APIError<{ field: string }> =>
  new APIError(message, 400, { field: 'localized_fields' })

const localeContentIntents = new WeakSet<object>()

export const preventStableIdMutation: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (
    operation === 'update' &&
    data.stable_id !== undefined &&
    originalDoc?.stable_id !== undefined &&
    data.stable_id !== originalDoc.stable_id
  ) {
    const previous = originalDoc as Record<string, unknown>
    await req.payload.create({
      collection: 'audit-events',
      data: buildAuditEvent({
        action: 'stable_id.immutable_denied',
        actor: principalFromPayloadUser(req.user),
        entity: { type: 'record', id: String(previous.stable_id ?? previous.id ?? 'unknown') },
        correlationId: globalThis.crypto.randomUUID(),
        outcome: 'denied',
        reasonCode: 'stable_id_immutable',
        before: previous,
        after: data as Record<string, unknown>,
      }) as never,
      overrideAccess: true,
    })
    throw immutableFieldError('stable_id')
  }

  return data
}

/** Rejects in-place replacement of evidence and immutable identity fields. */
export const preventFieldMutation = (
  fields: readonly string[],
): CollectionBeforeChangeHook => ({ data, operation, originalDoc }) => {
  if (operation !== 'update' || !originalDoc) return data
  const changed = data as Record<string, unknown>
  const previous = originalDoc as Record<string, unknown>
  for (const field of fields) {
    if (changed[field] !== undefined && JSON.stringify(changed[field]) !== JSON.stringify(previous[field]))
      throw immutableFieldError(field)
  }
  return data
}

/** Locale and source language define a variant identity and cannot be rewritten in place. */
export const preventLocaleIdentityMutation = preventFieldMutation(['entity', 'entity_key', 'locale', 'source_locale', 'source_version'])

/** On creation a locale variant inherits its immutable lineage from its entity. */
export const deriveLocaleSourceVersionOnCreate: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create') return data
  const changed = data as Record<string, unknown>
  const entity = changed.entity as Record<string, unknown> | undefined
  let entityKey: string
  try {
    entityKey = localeEntityKey(entity)
  } catch {
    throw new APIError('locale entity must be an authoritative prompt artifact', 400, { field: 'entity' })
  }
  const artifact = await req.payload.findByID({ collection: 'prompt-artifacts', id: (entity as { value: number | string }).value, overrideAccess: true }) as unknown as Record<string, unknown>
  const authoritative = versionedHashSchema.safeParse(artifact.source_version)
  if (!authoritative.success) throw new APIError('prompt artifact source_version is invalid', 400, { field: 'source_version' })
  if (changed.source_version !== undefined && changed.source_version !== authoritative.data)
    throw new APIError('source_version must match the authoritative prompt artifact', 400, { field: 'source_version' })
  if (changed.entity_key !== undefined && changed.entity_key !== entityKey)
    throw new APIError('entity_key must match the authoritative locale entity', 400, { field: 'entity_key' })
  changed.entity_key = entityKey
  changed.source_version = authoritative.data
  return data
}

/**
 * Content and risk facts are a single private, expected-revision command. The
 * hook derives all stored server fields; callers cannot supply a partial
 * content revision or independently change risk/is_money_page facts.
 */
export const enforceLocaleContentCommand: CollectionBeforeChangeHook = async ({ data, operation, originalDoc, req }) => {
  if (operation !== 'update' || !originalDoc) return data
  const changed = data as Record<string, unknown>
  const previous = originalDoc as Record<string, unknown>
  const hasContentChange = changed.localized_fields !== undefined && JSON.stringify(changed.localized_fields) !== JSON.stringify(previous.localized_fields)
  const hasRiskChange = changed.risk_classes !== undefined && JSON.stringify(changed.risk_classes) !== JSON.stringify(previous.risk_classes)
  if (!hasContentChange && !hasRiskChange) return data
  const context = req.context as Record<string, unknown> | undefined
  const command = context?.phase1LocaleContentCommand
  const principal = principalFromPayloadUser(req.user)
  if (typeof command !== 'object' || command === null || principal.kind !== 'user') {
    await auditDeniedTransition('locale', req as never, previous, changed, 'locale_content_command_required')
    throw localeContentCommandError('localized content requires a canonical expected-revision command')
  }
  const commandValue = command as Record<string, unknown>
  if (commandValue.actor_id !== principal.id || !principal.roles.some((role) => role === 'editor' || role === 'translator')) {
    await auditDeniedTransition('locale', req as never, previous, changed, 'locale_content_command_invalid')
    throw localeContentCommandError('localized content command actor is invalid')
  }
  let decision
  try {
    decision = decideLocaleContentRevision({
      record: {
        id: String(previous.stable_id ?? previous.id), revision: Number(previous.revision), content_revision: Number(previous.content_revision),
        workflow_state: previous.workflow_state as never, localized_fields: previous.localized_fields as Record<string, string>,
        reviewed_revision: typeof previous.reviewed_revision === 'number' ? previous.reviewed_revision : null,
        reviewed_by_stable_id: typeof previous.reviewed_by_stable_id === 'string' ? previous.reviewed_by_stable_id : null,
        reviewed_at: typeof previous.reviewed_at === 'string' ? previous.reviewed_at : null,
        published_version: typeof previous.published_version === 'number' ? previous.published_version : null,
        is_money_page: previous.is_money_page === true,
        risk_classes: Array.isArray(previous.risk_classes) ? deriveLocaleRisk(previous.risk_classes as string[]) : [],
      },
      command: {
        expected_revision: Number(commandValue.expected_revision), expected_content_revision: Number(commandValue.expected_content_revision),
        actor_id: String(commandValue.actor_id), correlation_id: String(commandValue.correlation_id), reason_code: String(commandValue.reason_code),
        localized_fields: commandValue.localized_fields as Record<string, string>, risk_classes: deriveLocaleRisk(commandValue.risk_classes as string[]),
      },
    })
  } catch {
    await auditDeniedTransition('locale', req as never, previous, changed, 'locale_content_command_invalid')
    throw localeContentCommandError('localized content command is invalid')
  }
  if (!decision.allowed) {
    await auditDeniedTransition('locale', req as never, previous, changed, decision.reason_code)
    throw localeContentCommandError(decision.reason_code)
  }
  Object.assign(changed, decision.next)
  const canonical = {
    schema_version: 1,
    expected_revision: previous.revision,
    current_revision: previous.revision,
    correlation_id: decision.audit_intent.correlation_id,
    at: String(commandValue.at),
    reason_code: decision.audit_intent.reason_code,
    from: previous.workflow_state,
    to: decision.next.workflow_state,
    actor: { type: 'user', id: principal.id },
    actor_role: principal.roles.includes('editor') ? 'editor' : 'translator',
    guard: { content_revision_changed: true },
  }
  const intent = Object.freeze({ audit_intent: decision.audit_intent, risk_classes: decision.next.risk_classes })
  localeContentIntents.add(intent)
  ;(req.context as Record<string, unknown>).phase1CanonicalCommand = canonical
  ;(req.context as Record<string, unknown>).phase1ServerLocaleCommand = { actor: { id: principal.id }, is_money_page: decision.next.is_money_page, risk_classes: decision.next.risk_classes }
  ;(req.context as Record<string, unknown>).phase1LocaleContentIntent = intent
  return data
}

/** Prompt body revisions are new artifacts; original text and language may not change in place. */
export const preventPromptOriginalTextMutation: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'update' || !originalDoc) return data
  const incomingPrompt = (data as Record<string, unknown>).prompt
  const originalPrompt = (originalDoc as Record<string, unknown>).prompt
  const incomingLanguage = (data as Record<string, unknown>).original_language
  const originalLanguage = (originalDoc as Record<string, unknown>).original_language
  if (incomingLanguage !== undefined && incomingLanguage !== originalLanguage)
    throw immutableFieldError('original_language')
  if (
    typeof incomingPrompt === 'object' &&
    incomingPrompt !== null &&
    typeof originalPrompt === 'object' &&
    originalPrompt !== null &&
    (incomingPrompt as Record<string, unknown>).original_text !== undefined &&
    (incomingPrompt as Record<string, unknown>).original_text !==
      (originalPrompt as Record<string, unknown>).original_text
  )
    throw immutableFieldError('prompt.original_text')
  return data
}

/** State and rights changes must arrive through a versioned canonical command context. */
type CanonicalCommandKind = 'locale' | 'page' | 'publication' | 'deletion' | 'source' | 'generic'

const roleBelongsToActor = (role: unknown, principal: ReturnType<typeof principalFromPayloadUser>): boolean => {
  if (typeof role !== 'string') return false
  const roleMap: Record<string, readonly string[]> = {
    translator_service: ['translate'],
    translator: ['translator'],
    editor: ['editor'],
    qa_service: [],
    reviewer: ['reviewer'],
    legal: ['legal'],
    publisher: ['publisher'],
    publisher_service: ['publish'],
    withdraw_service: ['withdraw'],
    system: ['translate'],
  }
  const expected = roleMap[role]
  if (expected === undefined) return false
  return expected.some((entry) => principal.roles.includes(entry as never) || principal.serviceScopes.includes(entry as never))
}

/** Emits the precise content-revision audit event only for a module-private intent. */
export const localeAuditAfterChange: CollectionAfterChangeHook = async ({ doc, operation, previousDoc, req }) => {
  const context = req.context as Record<string, unknown> | undefined
  const intent = context?.phase1LocaleContentIntent
  const trusted = typeof intent === 'object' && intent !== null && localeContentIntents.has(intent)
  const intentValue = trusted ? intent as { audit_intent: { action: string; reason_code: string; correlation_id: string } } : undefined
  const current = doc as Record<string, unknown>
  const previous = previousDoc as Record<string, unknown> | undefined
  if (process.env.PHASE1_FAIL_LOCALE_CONTENT_AUDIT === 'true' && intentValue !== undefined)
    throw new Error('injected localized_content_revised audit failure')
  await req.payload.create({
    collection: 'audit-events',
    data: buildAuditEvent({
      action: intentValue?.audit_intent.action ?? 'locale-variants.update',
      actor: principalFromPayloadUser(req.user),
      entity: { type: 'locale-variants', id: String(current.stable_id ?? current.id) },
      correlationId: intentValue?.audit_intent.correlation_id ?? globalThis.crypto.randomUUID(),
      outcome: 'allowed',
      reasonCode: intentValue?.audit_intent.reason_code ?? null,
      before: operation === 'create' ? null : previous ?? null,
      after: current,
    }) as never,
    req,
    overrideAccess: true,
  })
  return doc
}

const commandDecision = (kind: CanonicalCommandKind, command: unknown) => {
  switch (kind) {
    case 'locale': return decideLocaleTransition(command)
    case 'page': return decidePageTransition(command)
    case 'publication': return decidePublicationTransition(command)
    case 'deletion': return decideDeletionTransition(command)
    default: return { allowed: true }
  }
}

const auditDeniedTransition = async (
  kind: CanonicalCommandKind,
  req: { user?: unknown; payload: { create: (args: unknown) => Promise<unknown> } },
  previous: Record<string, unknown>,
  changed: Record<string, unknown>,
  reasonCode: string,
): Promise<void> => {
  const principal = principalFromPayloadUser(req.user as never)
  const semanticAction = kind === 'source'
    ? changed.rights_state !== undefined && changed.rights_state !== previous.rights_state
      ? 'sources.rights_override'
      : 'sources.license_change'
    : kind === 'locale'
      ? 'locale-variants.locale_transition'
      : kind === 'page'
        ? 'page-records.page_transition'
    : kind === 'deletion' && changed.status === 'completed'
      ? 'deletion-requests.deletion_complete'
    : undefined
  await req.payload.create({
    collection: 'audit-events',
    data: buildAuditEvent({
      action: semanticAction ?? `${kind}.transition_denied`,
      actor: principal,
      entity: { type: kind, id: String(previous.stable_id ?? previous.id ?? changed.stable_id ?? changed.id ?? 'unknown') },
      correlationId: globalThis.crypto.randomUUID(),
      outcome: 'denied',
      reasonCode,
      before: previous,
      after: changed,
    }) as never,
    overrideAccess: true,
  })
}

const auditAllowedTransition = async (
  kind: CanonicalCommandKind,
  req: { user?: unknown; payload: { create: (args: unknown) => Promise<unknown> } },
  previous: Record<string, unknown>,
  changed: Record<string, unknown>,
  command: Record<string, unknown>,
): Promise<void> => {
  const principal = principalFromPayloadUser(req.user as never)
  const sourceAction = kind === 'source'
    ? changed.rights_state !== undefined && changed.rights_state !== previous.rights_state
      ? 'sources.rights_override'
      : 'sources.license_change'
    : kind === 'locale'
      ? 'locale-variants.locale_transition'
      : kind === 'page'
        ? 'page-records.page_transition'
        : undefined
  await req.payload.create({
    collection: 'audit-events',
    data: buildAuditEvent({
      action: sourceAction ?? `${kind}.transition`,
      actor: principal,
      entity: { type: kind, id: String(previous.stable_id ?? previous.id ?? 'unknown') },
      correlationId: String(command.correlation_id),
      outcome: 'allowed',
      reasonCode: typeof command.reason_code === 'string' ? command.reason_code : null,
      before: previous,
      after: {
        ...changed,
        ...(kind === 'page'
          ? {
              qualification_input_hash: previous.qualification_input_hash,
              metrics_input_hash: command.metrics_input_hash,
            }
          : {}),
      },
    }) as never,
    req: req as never,
    overrideAccess: true,
  })
}

/**
 * Locale Money Page facts are an internal command result, never a client-provided
 * authorization input. Only a trusted server command may change them, and it is
 * bound to the authenticated editor identity.
 */
export const enforceLocaleServerMetadata: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'update' && operation !== 'create') return data
  const changed = data as Record<string, unknown>
  const previous = (originalDoc ?? {}) as Record<string, unknown>
  const protectedFields = [
    'is_money_page',
    'risk_classes',
    'last_content_editor',
    'last_content_editor_stable_id',
    'reviewed_by',
    'reviewed_by_stable_id',
    'reviewed_revision',
  ]
  const metadataChanged = protectedFields.some((field) =>
    operation === 'create'
      ? changed[field] !== undefined
      : changed[field] !== undefined && JSON.stringify(changed[field]) !== JSON.stringify(previous[field]),
  )
  if (!metadataChanged) return data

  const reviewerMetadataChanged = ['reviewed_by', 'reviewed_by_stable_id', 'reviewed_revision'].some((field) =>
    operation === 'create'
      ? changed[field] !== undefined
      : changed[field] !== undefined && JSON.stringify(changed[field]) !== JSON.stringify(previous[field]),
  )
  const context = req.context as Record<string, unknown> | undefined
  const contentIntent = context?.phase1LocaleContentIntent
  const trustedContentIntent = typeof contentIntent === 'object' && contentIntent !== null && localeContentIntents.has(contentIntent)
  if (reviewerMetadataChanged && !trustedContentIntent) {
    await auditDeniedTransition('locale', req as never, previous, changed, 'locale_metadata_server_managed')
    throw new APIError('locale Money Page metadata is server-managed', 400, { field: 'is_money_page' })
  }

  const serverCommand = context?.phase1ServerLocaleCommand
  const command = typeof serverCommand === 'object' && serverCommand !== null
    ? serverCommand as Record<string, unknown>
    : undefined
  const principal = principalFromPayloadUser(req.user)
  const actor = command?.actor
  const actorID = typeof actor === 'object' && actor !== null
    ? (actor as Record<string, unknown>).id
    : undefined
  if (
    command?.is_money_page === undefined ||
    typeof command.is_money_page !== 'boolean' ||
    principal.kind !== 'user' ||
    !principal.roles.includes('editor') ||
    actorID !== principal.id
  ) {
    await auditDeniedTransition('locale', req as never, previous, changed, 'locale_metadata_server_managed')
    throw new APIError('locale Money Page metadata is server-managed', 400, { field: 'is_money_page' })
  }

  let riskClasses: readonly string[]
  try {
    riskClasses = deriveLocaleRisk(Array.isArray(command.risk_classes)
      ? command.risk_classes as string[]
      : command.is_money_page ? ['money'] : [])
  } catch {
    await auditDeniedTransition('locale', req as never, previous, changed, 'locale_metadata_server_managed')
    throw new APIError('locale risk metadata is server-managed', 400, { field: 'risk_classes' })
  }
  if (command.is_money_page !== riskClasses.includes('money')) {
    await auditDeniedTransition('locale', req as never, previous, changed, 'locale_metadata_server_managed')
    throw new APIError('locale Money Page metadata is server-managed', 400, { field: 'is_money_page' })
  }
  changed.is_money_page = riskClasses.includes('money')
  changed.risk_classes = riskClasses
  changed.last_content_editor_stable_id = principal.id
  if (principal.payloadUserId !== undefined) changed.last_content_editor = principal.payloadUserId
  return data
}

/**
 * Requires an authenticated, revision-bound command and delegates domain transitions
 * to the accepted T1 decision functions. A context marker alone never authorizes.
 */
export const requireCanonicalCommandFor = (kind: CanonicalCommandKind): CollectionBeforeChangeHook => async ({ data, operation, originalDoc, req }) => {
  const changed = data as Record<string, unknown>
  if (operation === 'create') {
    if (kind === 'generic' || kind === 'source') return data
    const initialState = kind === 'locale' ? changed.workflow_state : kind === 'page' ? changed.index_state : changed.status
    const defaultState = kind === 'locale' ? 'missing'
      : kind === 'page' ? 'not_generated'
        : kind === 'publication' ? 'draft'
          : kind === 'deletion' ? 'received'
            : undefined
    if (initialState !== undefined && initialState !== defaultState) {
      await auditDeniedTransition(kind, req as never, {}, changed, 'canonical_command_required')
      throw canonicalCommandError('state mutations require a canonical expected-revision command')
    }
    return data
  }
  if (operation !== 'update' || !originalDoc) return data
  const previous = originalDoc as Record<string, unknown>
  const sensitiveStateChanged = [
    'status',
    'workflow_state',
    'index_state',
    'rights_state',
    'deletion_state',
    ...(kind === 'source' ? ['rights_basis'] : []),
    ...(kind === 'publication' ? ['publish_version', 'previous_verified_version'] : []),
  ].some(
    (field) => changed[field] !== undefined && JSON.stringify(changed[field]) !== JSON.stringify(previous[field]),
  )
  if (!sensitiveStateChanged) return data

  const context = req.context as Record<string, unknown> | undefined
  const command = context?.phase1CanonicalCommand
  if (typeof command !== 'object' || command === null) {
    await auditDeniedTransition(kind, req as never, previous, changed, 'canonical_command_required')
    throw canonicalCommandError('state mutations require a canonical expected-revision command')
  }
  const commandValue = command as Record<string, unknown>
  const principal = principalFromPayloadUser(req.user)
  const actor = commandValue.actor as Record<string, unknown> | undefined
  const targetField = kind === 'locale' ? 'workflow_state'
    : kind === 'page' ? 'index_state'
      : kind === 'deletion' ? 'status'
        : 'status'
  const isTransitionKind = kind !== 'generic' && kind !== 'source' && !(kind === 'publication' && previous.status === undefined)
  if (
    commandValue.expected_revision !== previous.revision ||
    commandValue.current_revision !== previous.revision ||
    commandValue.correlation_id === undefined ||
    changed.revision !== Number(previous.revision) + 1 ||
    !actor ||
    actor.id !== principal.id ||
    (actor.type !== principal.kind) ||
    !roleBelongsToActor(commandValue.actor_role, principal) ||
    (isTransitionKind && commandValue.from !== previous[targetField]) ||
    (isTransitionKind && commandValue.to !== changed[targetField])
  ) {
    await auditDeniedTransition(kind, req as never, previous, changed, 'canonical_command_conflict')
    throw canonicalCommandError('canonical command revision conflict')
  }
  if (kind === 'locale') {
    const guard = commandValue.guard as Record<string, unknown> | undefined
    const isMoneyPage = previous.is_money_page === true
    const isApproval = previous.workflow_state === 'review' && changed.workflow_state === 'approved'
    const isPublication = previous.workflow_state === 'approved' && changed.workflow_state === 'published'
    if (
      (changed.is_money_page !== undefined && changed.is_money_page !== previous.is_money_page) ||
      (isMoneyPage && guard?.money_page !== true) ||
      (!isMoneyPage && guard?.money_page === true) ||
      (isMoneyPage && isApproval &&
        (typeof previous.last_content_editor_stable_id !== 'string' ||
          guard?.last_content_editor_id !== previous.last_content_editor_stable_id)) ||
      (isMoneyPage && isPublication &&
        (typeof previous.reviewed_by_stable_id !== 'string' ||
          guard?.reviewer_id !== previous.reviewed_by_stable_id ||
          previous.reviewed_revision !== previous.content_revision))
    ) {
      await auditDeniedTransition(kind, req as never, previous, changed, 'money_page_persisted_facts_required')
      throw canonicalCommandError('canonical command Money Page facts do not match persisted record')
    }
  }
  if (!commandDecision(kind, command).allowed) {
    await auditDeniedTransition(kind, req as never, previous, changed, 'canonical_transition_denied')
    throw canonicalCommandError('canonical command transition denied')
  }
  if (kind === 'locale' && previous.workflow_state === 'review' && changed.workflow_state === 'approved') {
    changed.reviewed_by_stable_id = principal.id
    changed.reviewed_revision = previous.content_revision
    changed.reviewed_at = new Date().toISOString()
    if (principal.payloadUserId !== undefined) changed.reviewed_by = principal.payloadUserId
  }
  await auditAllowedTransition(kind, req as never, previous, changed, commandValue)
  return data
}

export const requireCanonicalCommand = requireCanonicalCommandFor('generic')

type PointerTriple = Readonly<{
  publish_version: number | null
  previous_verified_version: number | null
  revision: number
}>

type PointerCommand = Readonly<{
  singleton_key: string
  expected_pointer: PointerTriple
  desired_pointer: PointerTriple
  reason_code: string
  correlation_id: string
  publisher_principal_id: string
  publish_service_id: string
}>

const pointerConflict = (reason: string): APIError<{ code: string; field: string }> =>
  new APIError(reason, 409, { code: 'version_conflict', field: 'active_publication_pointer' })

const pointerCommandFailure = (reason: string): APIError<{ code: string; field: string }> =>
  new APIError(reason, 400, { code: 'pointer_command_invalid', field: 'active_publication_pointer' })

const pointerTriple = (value: unknown): PointerTriple | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const publishVersion = record.publish_version
  const previousVersion = record.previous_verified_version
  const revision = record.revision
  if (
    (publishVersion !== null && (typeof publishVersion !== 'number' || !Number.isInteger(publishVersion) || publishVersion <= 0)) ||
    (previousVersion !== null && (typeof previousVersion !== 'number' || !Number.isInteger(previousVersion) || previousVersion <= 0)) ||
    typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0
  ) return undefined
  if (publishVersion === null && (previousVersion !== null || revision !== 0)) return undefined
  if (publishVersion !== null && revision === 0) return undefined
  return {
    publish_version: publishVersion as number | null,
    previous_verified_version: previousVersion as number | null,
    revision,
  }
}

const samePointerTriple = (left: PointerTriple, right: PointerTriple): boolean =>
  left.publish_version === right.publish_version &&
  left.previous_verified_version === right.previous_verified_version &&
  left.revision === right.revision

const pointerTripleFromRecord = (record: Record<string, unknown>): PointerTriple | undefined =>
  pointerTriple({
    publish_version: record.publish_version ?? null,
    previous_verified_version: record.previous_verified_version ?? null,
    revision: record.revision,
  })

const privatePointerCommand = (context: unknown): PointerCommand | undefined => {
  if (typeof context !== 'object' || context === null) return undefined
  const command = (context as Record<string, unknown>).phase1PointerCommand
  if (typeof command !== 'object' || command === null) return undefined
  const record = command as Record<string, unknown>
  const expected = pointerTriple(record.expected_pointer)
  const desired = pointerTriple(record.desired_pointer)
  if (
    expected === undefined || desired === undefined ||
    typeof record.singleton_key !== 'string' ||
    typeof record.reason_code !== 'string' || record.reason_code.length === 0 ||
    typeof record.correlation_id !== 'string' || record.correlation_id.length === 0 ||
    typeof record.publisher_principal_id !== 'string' ||
    typeof record.publish_service_id !== 'string'
  ) return undefined
  return {
    singleton_key: record.singleton_key,
    expected_pointer: expected,
    desired_pointer: desired,
    reason_code: record.reason_code,
    correlation_id: record.correlation_id,
    publisher_principal_id: record.publisher_principal_id,
    publish_service_id: record.publish_service_id,
  }
}

const persistedUserByStableID = async (
  req: PayloadRequest,
  stableID: string,
): Promise<Record<string, unknown> | undefined> => {
  const result = await req.payload.find({
    collection: 'users',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { stable_id: { equals: stableID } },
  }) as { docs?: unknown[] }
  const user = result.docs?.[0]
  return typeof user === 'object' && user !== null ? user as Record<string, unknown> : undefined
}

const exactSingleValue = (value: unknown, expected: string): boolean =>
  Array.isArray(value) && value.length === 1 && value[0] === expected

const verifyPointerAuthorities = async (
  req: PayloadRequest,
  command: PointerCommand,
): Promise<boolean> => {
  const [human, service] = await Promise.all([
    persistedUserByStableID(req, command.publisher_principal_id),
    persistedUserByStableID(req, command.publish_service_id),
  ])
  const requestUser = req.user as unknown as Record<string, unknown> | undefined
  return (
    human?.identity_kind === 'human' &&
    exactSingleValue(human.roles, 'publisher') &&
    Array.isArray(human.service_scopes) && human.service_scopes.length === 0 &&
    requestUser?.id === human.id &&
    service?.identity_kind === 'service' &&
    Array.isArray(service.roles) && service.roles.length === 0 &&
    exactSingleValue(service.service_scopes, 'publish')
  )
}

const auditPointerDenied = async (
  req: Parameters<CollectionBeforeChangeHook>[0]['req'],
  previous: Record<string, unknown>,
  changed: Record<string, unknown>,
  reason: string,
): Promise<void> => {
  const principal = principalFromPayloadUser(req.user)
  await req.payload.create({
    collection: 'audit-events',
    data: buildAuditEvent({
      action: 'active-publication-pointers.publish',
      actor: principal,
      entity: {
        type: 'active-publication-pointers',
        id: String(previous.stable_id ?? previous.id ?? changed.stable_id ?? changed.id ?? 'unknown'),
      },
      correlationId: globalThis.crypto.randomUUID(),
      outcome: 'denied',
      reasonCode: reason,
      before: previous,
      after: changed,
    }) as never,
    overrideAccess: true,
  })
}

type PointerCasDatabase = Readonly<{
  update: (table: never) => Readonly<{
    set: (values: never) => Readonly<{
      where: (predicate: never) => Readonly<{
        returning: (selection: never) => Promise<readonly unknown[]>
      }>
    }>
  }>
}>

type PointerCasAdapter = Readonly<{
  drizzle?: PointerCasDatabase
  sessions?: Readonly<Record<string, Readonly<{ db: PointerCasDatabase }>>>
  tables?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}>

/**
 * Claims an expected pointer revision in the caller's Payload transaction.
 * Payload's normal update-by-ID reads before hooks and writes by primary key;
 * this predicate makes that snapshot check a database-enforced CAS instead.
 */
const claimPointerRevision = async (
  req: PayloadRequest,
  previous: Record<string, unknown>,
  expectedRevision: number,
  nextRevision: number,
): Promise<boolean> => {
  const adapter = req.payload.db as unknown as PointerCasAdapter
  const table = adapter.tables?.active_publication_pointers
  const id = table?.id
  const revision = table?.revision
  const transactionID = req.transactionID === undefined ? undefined : await req.transactionID
  const database = transactionID === undefined
    ? adapter.drizzle
    : adapter.sessions?.[String(transactionID)]?.db
  if (database === undefined || table === undefined || id === undefined || revision === undefined)
    throw new Error('publication pointer CAS requires the PostgreSQL Drizzle transaction')

  const rows = await database.update(table as never)
    .set({ revision: nextRevision } as never)
    .where(and(
      eq(id as never, previous.id as never),
      eq(revision as never, expectedRevision),
    ) as never)
    .returning({ id } as never)
  return rows.length === 1
}

/**
 * The singleton pointer accepts only a server-local, dual-authorized CAS command.
 * The command binds facts from persisted identities; route bodies cannot establish it.
 */
export const requirePointerCanonicalCommand: CollectionBeforeChangeHook = async ({ data, operation, originalDoc, req }) => {
  const changed = data as Record<string, unknown>
  const previous = (originalDoc ?? {}) as Record<string, unknown>
  const command = privatePointerCommand(req.context)
  if (command === undefined || command.singleton_key !== 'active-publication') {
    await auditPointerDenied(req, previous, changed, 'pointer_command_required')
    throw pointerCommandFailure('publication pointer mutations require a private server command')
  }
  if (!(await verifyPointerAuthorities(req, command))) {
    await auditPointerDenied(req, previous, changed, 'pointer_dual_authorization_required')
    throw pointerCommandFailure('publication pointer requires publisher and publish-service authorization')
  }
  const candidate = { ...previous, ...changed }
  const desired = pointerTripleFromRecord(candidate)
  if (desired === undefined || candidate.singleton_key !== command.singleton_key) {
    await auditPointerDenied(req, previous, changed, 'pointer_command_conflict')
    throw pointerConflict('publication pointer desired triple conflicts with its command')
  }
  if (operation === 'create') {
    const bootstrap: PointerTriple = { publish_version: null, previous_verified_version: null, revision: 0 }
    if (!samePointerTriple(command.expected_pointer, bootstrap) || !samePointerTriple(command.desired_pointer, bootstrap) || !samePointerTriple(desired, bootstrap)) {
      await auditPointerDenied(req, previous, changed, 'pointer_bootstrap_conflict')
      throw pointerConflict('publication pointer bootstrap must create the exact revision-0 triple')
    }
    changed.singleton_key = 'active-publication'
    changed.publish_version = null
    changed.previous_verified_version = null
    changed.revision = 0
    return data
  }
  if (operation !== 'update' || originalDoc === undefined) {
    await auditPointerDenied(req, previous, changed, 'pointer_operation_denied')
    throw pointerCommandFailure('publication pointer operation is not permitted')
  }
  const persisted = pointerTripleFromRecord(previous)
  if (
    persisted === undefined ||
    !samePointerTriple(command.expected_pointer, persisted) ||
    !samePointerTriple(command.desired_pointer, desired) ||
    command.desired_pointer.revision !== command.expected_pointer.revision + 1 ||
    candidate.stable_id !== previous.stable_id ||
    candidate.singleton_key !== previous.singleton_key
  ) {
    await auditPointerDenied(req, previous, changed, 'pointer_version_conflict')
    throw pointerConflict('publication pointer version_conflict')
  }
  if (!(await claimPointerRevision(
    req,
    previous,
    command.expected_pointer.revision,
    command.desired_pointer.revision,
  ))) {
    await auditPointerDenied(req, previous, changed, 'pointer_version_conflict')
    throw pointerConflict('publication pointer version_conflict')
  }
  changed.stable_id = previous.stable_id
  changed.singleton_key = previous.singleton_key
  changed.publish_version = command.desired_pointer.publish_version
  changed.previous_verified_version = command.desired_pointer.previous_verified_version
  changed.revision = command.desired_pointer.revision
  return data
}

/** The active-publication pointer is permanent singleton state and may never be deleted. */
export const preventPointerDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  await auditDeniedTransition(
    'publication',
    req as never,
    { id },
    {},
    'pointer_delete_denied',
  )
  throw pointerCommandFailure('publication pointer deletion is not permitted')
}

const relationIDs = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).flatMap((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return [String(entry)]
    if (typeof entry === 'object' && entry !== null && 'id' in entry) {
      const id = (entry as { id?: unknown }).id
      return typeof id === 'string' || typeof id === 'number' ? [String(id)] : []
    }
    return []
  })

/** Requires persisted, approved graph evidence before a page enters an indexable state. */
export const requireApprovedPageEvidence: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const changed = data as Record<string, unknown>
  const previous = (originalDoc ?? {}) as Record<string, unknown>
  const indexState = changed.index_state ?? previous.index_state
  if (indexState !== 'index_candidate' && indexState !== 'indexable') return data

  const edgeID = changed.approval_edge ?? previous.approval_edge
  const evidenceIDs = relationIDs(changed.approval_evidence ?? previous.approval_evidence)
  if (edgeID === undefined || evidenceIDs.length === 0) {
    throw new Error('indexable PageRecords require approved edge evidence')
  }
  const edge = await req.payload.findByID({
    collection: 'edges',
    id: edgeID as never,
    depth: 0,
    overrideAccess: true,
    req,
  }) as unknown as Record<string, unknown>
  if (edge.review_state !== 'approved') throw new Error('indexable PageRecords require an approved edge')
  const persistedEvidence = relationIDs(edge.evidence)
  if (persistedEvidence.length === 0 || !evidenceIDs.every((id) => persistedEvidence.includes(id))) {
    throw new Error('indexable PageRecords require approved edge evidence')
  }
  return data
}

export const productionFields = (statusOptions: readonly string[], defaultStatus: string): Field[] => [
  {
    name: 'stable_id',
    type: 'text',
    required: true,
    unique: true,
    index: true,
    defaultValue: stableId,
    admin: { readOnly: true },
  },
  {
    name: 'revision',
    type: 'number',
    required: true,
    min: 1,
    defaultValue: 1,
    index: true,
    admin: { readOnly: true },
  },
  {
    name: 'schema_version',
    type: 'number',
    required: true,
    min: 1,
    defaultValue: 1,
  },
  {
    name: 'source_version',
    type: 'text',
    required: true,
    index: true,
  },
  {
    name: 'status',
    type: 'select',
    required: true,
    index: true,
    defaultValue: defaultStatus,
    options: statusOptions.map((value) => ({ label: value, value })),
  },
  {
    name: 'audit',
    type: 'group',
    fields: [
      { name: 'created_by', type: 'relationship', relationTo: 'users' },
      { name: 'updated_by', type: 'relationship', relationTo: 'users' },
      { name: 'correlation_id', type: 'text', index: true },
    ],
  },
]
