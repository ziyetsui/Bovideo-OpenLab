import type { Access } from 'payload'

import {
  buildAuditEvent,
  createAuditAfterChangeHook,
  createAuditAfterDeleteHook,
  createPointerAuditAfterChangeHook,
} from './audit-hook'
import { principalFromPayloadUser } from './principals'
import { hasObjectAuthority } from '@/storage/payload-object-authority'
import {
  decideAccess,
  semanticMutationRules,
  type AccessAction,
  type PayloadCollection,
  type SemanticMutationRule,
} from './policy'

const resourceValues = (data: unknown): Record<string, unknown> =>
  typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}

const correlationIDFrom = (record: Record<string, unknown>): string | undefined => {
  if (typeof record.correlation_id === 'string') return record.correlation_id
  const audit = resourceValues(record.audit)
  return typeof audit.correlation_id === 'string' ? audit.correlation_id : undefined
}

const fieldChanged = (
  values: Record<string, unknown>,
  persistedRecord: Record<string, unknown> | undefined,
  field: string,
): boolean =>
  values[field] !== undefined &&
  (persistedRecord === undefined || JSON.stringify(values[field]) !== JSON.stringify(persistedRecord[field]))

/** Payload access adapter. It delegates every route type to `decideAccess`. */
export const payloadAccess = (collection: PayloadCollection, action: AccessAction): Access =>
  async ({ req, data, id }) => {
    const record = resourceValues(data)
    const persistedRecord =
      action === 'update' && id !== undefined && id !== null
        ? resourceValues(
            await req.payload.findByID({
              collection,
              id,
              depth: 0,
              overrideAccess: true,
              req,
            }),
          )
        : undefined
    const resolvedAction = resolvePayloadAction(collection, action, record, persistedRecord)
    const principal = principalFromPayloadUser(req.user)
    const policyAction = resolvedAction
    const accessDecision = decideAccess({
      principal,
      action: policyAction,
      resource: {
        collection,
        // Client bodies never establish Money Page status or reviewer separation.
        // The canonical-command hook resolves those facts from originalDoc.
        moneyPage: false,
        subjectId:
          typeof record.stable_id === 'string'
            ? record.stable_id
            : typeof persistedRecord?.stable_id === 'string'
              ? persistedRecord.stable_id
              : undefined,
        requestedRoles: Array.isArray(record.roles) ? record.roles.filter((value): value is never => typeof value === 'string') : [],
        requestedServiceScopes: Array.isArray(record.service_scopes) ? record.service_scopes.filter((value): value is never => typeof value === 'string') : [],
      },
      path: 'internal',
    })
    // A pointer delete is still classified/audited as publish, but there is no
    // permitted deletion branch for the singleton CAS record.
    const objectAuthorityRequired = action === 'create' && (collection === 'sources' || collection === 'media')
    const decision =
      collection === 'active-publication-pointers' && action === 'delete'
        ? { allowed: false, reason: 'default_deny' as const }
        : objectAuthorityRequired && !hasObjectAuthority(req.context)
          ? { allowed: false, reason: 'default_deny' as const }
        : accessDecision
    const correlationID = correlationIDFrom(record)
    if (!decision.allowed && (isHighRisk(policyAction) || objectAuthorityRequired)) {
      await req.payload.create({
        collection: 'audit-events',
        data: buildAuditEvent({
          action: `${collection}.${policyAction}`,
          actor: principal,
          entity: {
            type: collection,
            id: String(record.stable_id ?? persistedRecord?.stable_id ?? 'access-request'),
          },
          correlationId: correlationID ?? globalThis.crypto.randomUUID(),
          outcome: 'denied',
          reasonCode: decision.reason,
          before: persistedRecord ?? null,
          after: record,
        }) as never,
        overrideAccess: true,
      })
    }
    return decision.allowed
  }

const isHighRisk = (action: AccessAction): boolean =>
  action === 'locale_transition' ||
  action === 'page_transition' ||
  action === 'redirect_status_transition' ||
  action === 'workflow_run_status_transition' ||
  action === 'rights_override' ||
  action === 'license_change' ||
  action === 'identity_escalation' ||
  action === 'publish' ||
  action === 'deletion_complete'

const resolvePayloadAction = (
  collection: PayloadCollection,
  action: AccessAction,
  values: Record<string, unknown>,
  persistedRecord?: Record<string, unknown>,
): AccessAction => {
  if (collection === 'active-publication-pointers')
    return semanticMutationRules.find((rule) => rule.id === 'publish')!.action
  if (collection === 'users' && action === 'update' &&
    ['roles', 'service_scopes', 'identity_kind'].some((field) => fieldChanged(values, persistedRecord, field)))
    return semanticMutationRules.find((rule) => rule.id === 'identity_escalation')!.action

  const candidates: readonly SemanticMutationRule[] = (semanticMutationRules as readonly SemanticMutationRule[])
    .filter((rule) => rule.collection === collection && rule.operation === action)
    .sort((left, right) => Number(Boolean(right.changedField)) - Number(Boolean(left.changedField)))
  const matchingRule = candidates.find((rule) =>
    rule.changedField === undefined ||
    (fieldChanged(values, persistedRecord, rule.changedField) &&
      (rule.changedValue === undefined || values[rule.changedField] === rule.changedValue)),
  )
  return matchingRule?.action ?? action
}

/** Use this exact read option for SEO/API content reads to prohibit locale fallback. */
export const exactLocaleRead = <TLocale extends string>(locale: TLocale) => ({
  locale,
  fallbackLocale: false as const,
})

export const collectionAccess = (collection: PayloadCollection) => ({
  read: payloadAccess(collection, collection === 'audit-events' ? 'audit_read' : 'read'),
  create: payloadAccess(collection, collection === 'audit-events' ? 'audit_append' : 'create'),
  update: payloadAccess(collection, 'update'),
  delete: payloadAccess(collection, 'delete'),
})

export const auditAfterChange = createAuditAfterChangeHook
export const auditAfterDelete = createAuditAfterDeleteHook
export const pointerAuditAfterChange = createPointerAuditAfterChangeHook
/** Compatibility export for consumers that need the authoritative semantic catalog. */
export const payloadMutationActions = Object.fromEntries(
  semanticMutationRules.map((rule) => [rule.id, rule.action]),
) as Readonly<Record<(typeof semanticMutationRules)[number]['id'], AccessAction>>
