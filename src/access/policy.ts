import type { Principal, ServiceScope, UserRole } from './principals'
import { principals } from './principals'

export { principals }

export type PayloadCollection =
  | 'users'
  | 'media'
  | 'sources'
  | 'prompt-artifacts'
  | 'taxonomy-nodes'
  | 'page-records'
  | 'locale-variants'
  | 'edges'
  | 'audit-events'
  | 'module-envelopes'
  | 'page-projections'
  | 'publication-snapshots'
  | 'publication-states'
  | 'active-publication-pointers'
  | 'deletion-requests'
  | 'redirects'
  | 'workflow-runs'
  | 'golden-replacement-approvals'

export type AccessAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'locale_transition'
  | 'page_transition'
  | 'redirect_status_transition'
  | 'workflow_run_status_transition'
  | 'rights_override'
  | 'license_change'
  | 'publish'
  | 'deletion_complete'
  | 'audit_append'
  | 'audit_read'
  | 'identity_escalation'

export type SemanticMutationRule = Readonly<{
  id:
    | 'sources.create'
    | 'sources.update'
    | 'users.delete'
    | 'locale_transition'
    | 'page_transition'
    | 'redirect_status_transition'
    | 'workflow_run_status_transition'
    | 'rights_override'
    | 'license_change'
    | 'publish'
    | 'deletion_complete'
    | 'identity_escalation'
  collection: PayloadCollection
  operation: 'create' | 'update' | 'delete'
  action: AccessAction
  changedField?: string
  changedValue?: string
}>

/**
 * The authoritative semantic mutation inventory. Payload route resolution and
 * handler evidence must consume this catalog rather than keeping a test-local
 * allow-list in sync with policy by hand.
 */
export const semanticMutationRules = [
  { id: 'sources.create', collection: 'sources', operation: 'create', action: 'create' },
  { id: 'sources.update', collection: 'sources', operation: 'update', action: 'update' },
  { id: 'users.delete', collection: 'users', operation: 'delete', action: 'delete' },
  { id: 'locale_transition', collection: 'locale-variants', operation: 'update', action: 'locale_transition', changedField: 'workflow_state' },
  { id: 'page_transition', collection: 'page-records', operation: 'update', action: 'page_transition', changedField: 'index_state' },
  { id: 'redirect_status_transition', collection: 'redirects', operation: 'update', action: 'redirect_status_transition', changedField: 'status' },
  { id: 'workflow_run_status_transition', collection: 'workflow-runs', operation: 'update', action: 'workflow_run_status_transition', changedField: 'status' },
  { id: 'rights_override', collection: 'sources', operation: 'update', action: 'rights_override', changedField: 'rights_state' },
  { id: 'license_change', collection: 'sources', operation: 'update', action: 'license_change', changedField: 'rights_basis' },
  { id: 'publish', collection: 'active-publication-pointers', operation: 'update', action: 'publish' },
  { id: 'deletion_complete', collection: 'deletion-requests', operation: 'update', action: 'deletion_complete', changedField: 'status', changedValue: 'completed' },
  { id: 'identity_escalation', collection: 'users', operation: 'update', action: 'identity_escalation', changedField: 'identity_kind' },
] as const satisfies readonly SemanticMutationRule[]

export type SemanticMutationID = (typeof semanticMutationRules)[number]['id']

export const semanticMutationRule = (id: SemanticMutationID): SemanticMutationRule => {
  const rule = semanticMutationRules.find((candidate) => candidate.id === id)
  if (!rule) throw new Error(`unknown semantic mutation rule: ${id}`)
  return rule
}

export type AccessResource = Readonly<{
  collection: PayloadCollection
  moneyPage?: boolean
  lastContentEditorId?: string
  reviewerId?: string
  subjectId?: string
  requestedRoles?: readonly UserRole[]
  requestedServiceScopes?: readonly ServiceScope[]
}>

export type AccessDecision = Readonly<{
  allowed: boolean
  reason:
    | 'allowed'
    | 'anonymous_denied'
    | 'default_deny'
    | 'legal_role_required'
    | 'money_page_reviewer_separation_required'
    | 'money_page_publisher_separation_required'
}>

type AccessRequest = Readonly<{
  principal: Principal
  action: AccessAction
  resource: AccessResource
  path: 'internal' | 'rest' | 'graphql'
}>

const contentCollections = new Set<PayloadCollection>([
  'sources',
  'prompt-artifacts',
  'taxonomy-nodes',
  'page-records',
  'locale-variants',
  'edges',
  'module-envelopes',
  'page-projections',
  'publication-snapshots',
  'publication-states',
  'active-publication-pointers',
  'deletion-requests',
])

const hasRole = (principal: Principal, roles: readonly UserRole[]): boolean =>
  roles.some((role) => principal.roles.includes(role))

const hasScope = (principal: Principal, scopes: readonly ServiceScope[]): boolean =>
  scopes.some((scope) => principal.serviceScopes.includes(scope))

const allowed = (): AccessDecision => ({ allowed: true, reason: 'allowed' })
const denied = (reason: Exclude<AccessDecision['reason'], 'allowed'>): AccessDecision => ({
  allowed: false,
  reason,
})

const isEditorWritable = (collection: PayloadCollection): boolean =>
  collection === 'sources' ||
  collection === 'prompt-artifacts' ||
  collection === 'taxonomy-nodes' ||
  collection === 'page-records' ||
  collection === 'edges' ||
  collection === 'module-envelopes'

const isAdminWritable = (collection: PayloadCollection): boolean =>
  collection === 'sources' ||
  collection === 'prompt-artifacts' ||
  collection === 'taxonomy-nodes' ||
  collection === 'page-records' ||
  collection === 'locale-variants' ||
  collection === 'edges' ||
  collection === 'module-envelopes'

/**
 * The single authorization decision point for Payload local API, REST and GraphQL.
 * `path` is intentionally not used in the decision: it is input evidence for callers/tests,
 * not a bypass capability.
 */
export const decideAccess = ({ principal, action, resource }: AccessRequest): AccessDecision => {
  if (principal.kind === 'anonymous') return denied('anonymous_denied')
  if (principal.roles.length > 0 && principal.serviceScopes.length > 0) return denied('default_deny')

  // Golden replacement approvals are reviewer-authored evidence, never a
  // generic admin/configuration write.  They are append-only in the
  // collection hooks; policy denies update/delete for every principal.
  if (resource.collection === 'golden-replacement-approvals') {
    if (action === 'read') return hasRole(principal, ['reviewer', 'admin', 'legal']) ? allowed() : denied('default_deny')
    if (action === 'create') return hasRole(principal, ['reviewer']) ? allowed() : denied('default_deny')
    return denied('default_deny')
  }

  const semanticRule = semanticMutationRules.find((rule) => rule.action === action)

  if (action === 'audit_append') return denied('default_deny')
  if (action === 'audit_read') return hasRole(principal, ['admin', 'legal']) ? allowed() : denied('default_deny')
  if (resource.collection === 'audit-events') return denied('default_deny')
  if (semanticRule?.id === 'identity_escalation') {
    if (!hasRole(principal, ['admin']) || resource.subjectId === principal.id) return denied('default_deny')
    const roles = resource.requestedRoles ?? []
    const scopes = resource.requestedServiceScopes ?? []
    return (roles.length === 1 && scopes.length === 0) || (roles.length === 0 && scopes.length === 1)
      ? allowed()
      : denied('default_deny')
  }

  if (semanticRule?.id === 'rights_override' || semanticRule?.id === 'license_change')
    return hasRole(principal, ['legal']) ? allowed() : denied('legal_role_required')

  if (semanticRule?.id === 'deletion_complete')
    return hasRole(principal, ['legal']) || hasScope(principal, ['withdraw'])
      ? allowed()
      : denied('default_deny')

  if (semanticRule?.id === 'publish') {
    if (!hasRole(principal, ['publisher']) && !hasScope(principal, ['publish']))
      return denied('default_deny')
    if (resource.moneyPage && resource.reviewerId === principal.id)
      return denied('money_page_publisher_separation_required')
    if (resource.moneyPage && resource.lastContentEditorId === principal.id)
      return denied('money_page_publisher_separation_required')
    return allowed()
  }

  if (semanticRule?.id === 'locale_transition') {
    if (hasScope(principal, ['translate', 'withdraw'])) return allowed()
    if (hasRole(principal, ['translator', 'editor', 'reviewer', 'publisher', 'legal'])) {
      if (resource.moneyPage && hasRole(principal, ['reviewer']) && resource.lastContentEditorId === principal.id)
        return denied('money_page_reviewer_separation_required')
      return allowed()
    }
    return denied('default_deny')
  }

  if (semanticRule?.id === 'page_transition')
    return hasRole(principal, ['editor', 'reviewer', 'publisher', 'legal']) ? allowed() : denied('default_deny')

  if (semanticRule?.id === 'workflow_run_status_transition')
    return principal.kind === 'service' && principal.serviceScopes.length === 1 ? allowed() : denied('default_deny')

  if (action === 'read') {
    if (resource.collection === 'users')
      return hasRole(principal, ['admin']) ? allowed() : denied('default_deny')
    if (principal.kind === 'service')
      return hasScope(principal, ['translate', 'publish', 'withdraw']) && contentCollections.has(resource.collection)
        ? allowed()
        : denied('default_deny')
    return contentCollections.has(resource.collection) ? allowed() : denied('default_deny')
  }

  if (action === 'create' || action === 'update') {
    if (hasScope(principal, ['ingest']) && (resource.collection === 'sources' || resource.collection === 'edges'))
      return action === 'create' ? allowed() : denied('default_deny')
    if (hasScope(principal, ['translate']) && resource.collection === 'locale-variants') return allowed()
    if (hasRole(principal, ['admin']) && isAdminWritable(resource.collection)) return allowed()
    if (hasRole(principal, ['admin']) && resource.collection === 'users') return allowed()
    if (hasRole(principal, ['editor']) && isEditorWritable(resource.collection)) return allowed()
    if (hasRole(principal, ['editor']) && action === 'create' && resource.collection === 'deletion-requests')
      return allowed()
    if (hasRole(principal, ['translator']) && resource.collection === 'locale-variants') return allowed()
    if (hasRole(principal, ['legal']) && resource.collection === 'sources') return allowed()
    return denied('default_deny')
  }

  if (action === 'delete')
    return hasRole(principal, ['admin']) && resource.collection === 'users'
      ? allowed()
      : denied('default_deny')

  return denied('default_deny')
}
