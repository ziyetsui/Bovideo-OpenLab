export const USER_ROLES = ['admin', 'editor', 'translator', 'reviewer', 'publisher', 'legal'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const SERVICE_SCOPES = [
  'ingest',
  'translate',
  'publish',
  'withdraw',
] as const
export type ServiceScope = (typeof SERVICE_SCOPES)[number]

export type Principal = Readonly<{
  id: string
  kind: 'anonymous' | 'user' | 'service'
  roles: readonly UserRole[]
  serviceScopes: readonly ServiceScope[]
  /** Internal Payload relation id. It is never used for authorization. */
  payloadUserId?: number | string
}>

const authenticatedPrincipals = new WeakSet<object>()

const authenticatedPrincipal = (principal: Principal): Principal => {
  const authenticated = Object.freeze({
    ...principal,
    roles: Object.freeze([...principal.roles]),
    serviceScopes: Object.freeze([...principal.serviceScopes]),
  }) as Principal
  authenticatedPrincipals.add(authenticated)
  return authenticated
}

/** True only for identities issued by the Payload authentication boundary. */
export const isAuthenticatedPrincipal = (principal: Principal): boolean => authenticatedPrincipals.has(principal)

type PayloadUser = Readonly<{
  id?: number | string
  stable_id?: unknown
  identity_kind?: unknown
  roles?: unknown
  service_scopes?: unknown
}>

const roleSet = new Set<string>(USER_ROLES)
const serviceScopeSet = new Set<string>(SERVICE_SCOPES)

const stringArray = (value: unknown, allowed: ReadonlySet<string>): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && allowed.has(entry))
    : []

export const principalFromPayloadUser = (user: PayloadUser | null | undefined): Principal => {
  if (
    user?.id === undefined ||
    user.id === null ||
    typeof user.stable_id !== 'string' ||
    !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(user.stable_id) ||
    (user.identity_kind !== 'human' && user.identity_kind !== 'service')
  )
    return { id: 'anonymous', kind: 'anonymous', roles: [], serviceScopes: [] }

  const roles = stringArray(user.roles, roleSet) as UserRole[]
  const serviceScopes = stringArray(user.service_scopes, serviceScopeSet) as ServiceScope[]
  if (
    (user.identity_kind === 'human' && (roles.length !== 1 || serviceScopes.length !== 0)) ||
    (user.identity_kind === 'service' && (roles.length !== 0 || serviceScopes.length !== 1))
  )
    return { id: 'anonymous', kind: 'anonymous', roles: [], serviceScopes: [] }
  return authenticatedPrincipal({
    id: user.stable_id,
    kind: user.identity_kind === 'service' ? 'service' : 'user',
    roles,
    serviceScopes,
    payloadUserId: user.id,
  })
}

const userPrincipal = (id: string, role: UserRole): Principal => ({
  id,
  kind: 'user',
  roles: [role],
  serviceScopes: [],
})

const servicePrincipal = (id: string, scope: ServiceScope): Principal => ({
  id,
  kind: 'service',
  roles: [],
  serviceScopes: [scope],
})

/** Stable principals used by the access matrix; production identities come from Payload users. */
export const principals = {
  anonymous: { id: 'anonymous', kind: 'anonymous', roles: [], serviceScopes: [] } as Principal,
  admin: authenticatedPrincipal(userPrincipal('admin-1', 'admin')),
  editor: authenticatedPrincipal(userPrincipal('editor-1', 'editor')),
  translator: authenticatedPrincipal(userPrincipal('translator-1', 'translator')),
  reviewer: authenticatedPrincipal(userPrincipal('reviewer-1', 'reviewer')),
  publisher: authenticatedPrincipal(userPrincipal('publisher-1', 'publisher')),
  legal: authenticatedPrincipal(userPrincipal('legal-1', 'legal')),
  ingestService: authenticatedPrincipal(servicePrincipal('ingest-service-1', 'ingest')),
  translateService: authenticatedPrincipal(servicePrincipal('translate-service-1', 'translate')),
  publishService: authenticatedPrincipal(servicePrincipal('publish-service-1', 'publish')),
  withdrawService: authenticatedPrincipal(servicePrincipal('withdraw-service-1', 'withdraw')),
} as const
