import type { Principal, ServiceScope, UserRole } from '@/access/principals'

import { objectRefSchema, type ObjectNamespace, type ObjectRef } from './object-ref'

export type ObjectAction = 'read' | 'write' | 'head' | 'list' | 'delete' | 'issue_read_capability'
export type ObjectChannel = 'internal' | 'direct'
export type ObjectPrincipal = Principal | Readonly<{ id: string; kind: 'public_worker' }>

export type ObjectAccessDecision = Readonly<{
  allowed: boolean
  reason:
    | 'allowed'
    | 'anonymous_denied'
    | 'direct_access_denied'
    | 'invalid_ref'
    | 'default_deny'
    | 'public_rights_denied'
    | 'deleted_or_revoked'
    | 'snapshot_not_active'
}>

export type ObjectAccessRequest = Readonly<{
  principal: ObjectPrincipal
  ref: ObjectRef
  action: ObjectAction
  channel: ObjectChannel
  active_snapshot_version?: string
}>

const allow = (): ObjectAccessDecision => Object.freeze({ allowed: true, reason: 'allowed' })
const deny = (reason: Exclude<ObjectAccessDecision['reason'], 'allowed'>): ObjectAccessDecision =>
  Object.freeze({ allowed: false, reason })
const hasRole = (principal: ObjectPrincipal, role: UserRole): boolean =>
  'roles' in principal && principal.roles.includes(role)
const hasScope = (principal: ObjectPrincipal, scope: ServiceScope): boolean =>
  'serviceScopes' in principal && principal.serviceScopes.includes(scope)
const isReadLike = (action: ObjectAction): boolean => action === 'read' || action === 'head' || action === 'list' || action === 'issue_read_capability'
const publicRightsEligible = (ref: ObjectRef): boolean =>
  ref.rights_state === 'first_party' || ref.rights_state === 'redistribution_licensed'

/** Lifecycle check shared by capability verification; authorization remains action-specific. */
export const isObjectLifecycleReadable = (ref: ObjectRef): boolean =>
  ref.deletion_state === 'active' && ref.rights_state !== 'revoked'

/** Single deny-by-default object policy. `direct` represents R2/r2.dev-style access and always fails. */
export const decideObjectAccess = (request: ObjectAccessRequest): ObjectAccessDecision => {
  if (request.channel === 'direct') return deny('direct_access_denied')
  if ('kind' in request.principal && request.principal.kind === 'anonymous') return deny('anonymous_denied')
  if (!objectRefSchema.safeParse(request.ref).success) return deny('invalid_ref')

  const { principal, ref, action } = request
  if (!isObjectLifecycleReadable(ref)) return deny('deleted_or_revoked')
  if (ref.namespace === 'public-media' && !publicRightsEligible(ref)) return deny('public_rights_denied')

  switch (ref.namespace as ObjectNamespace) {
    case 'raw-evidence':
      return hasScope(principal, 'ingest') ? allow() : deny('default_deny')
    case 'review-media':
      return (hasRole(principal, 'reviewer') || hasRole(principal, 'legal') || hasRole(principal, 'admin'))
        ? allow()
        : deny('default_deny')
    case 'published-snapshots':
      if (principal.kind === 'public_worker') {
        if (!isReadLike(action)) return deny('default_deny')
        return request.active_snapshot_version === ref.version ? allow() : deny('snapshot_not_active')
      }
      if (action === 'delete') return deny('default_deny')
      return hasScope(principal, 'publish') ? allow() : deny('default_deny')
    case 'public-media':
      if (principal.kind === 'public_worker') return isReadLike(action) ? allow() : deny('default_deny')
      return hasScope(principal, 'publish') ? allow() : deny('default_deny')
  }
}
