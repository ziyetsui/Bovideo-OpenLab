import type { PayloadCollection } from '@/access/policy'

/**
 * Declarative inventory for the generated Local API, REST, and GraphQL mutation
 * matrix. Payload also provides internal `payload-*` collections at runtime;
 * those implementation details are intentionally excluded from product RBAC.
 */
export const mutationHandlerCatalog = [
  'users', 'media', 'sources', 'prompt-artifacts', 'taxonomy-nodes', 'page-records',
  'locale-variants', 'edges', 'audit-events', 'module-envelopes', 'publication-snapshots',
  'publication-states', 'active-publication-pointers', 'redirects', 'workflow-runs',
  'deletion-requests', 'golden-replacement-approvals',
] as const satisfies readonly PayloadCollection[]

export type MatrixCollection = typeof mutationHandlerCatalog[number]
export type MatrixOperation = 'create' | 'update' | 'delete'
export const matrixPrincipals = [
  'anonymous', 'admin', 'editor', 'translator', 'reviewer', 'publisher', 'legal',
  'ingestService', 'translateService', 'publishService', 'withdrawService',
] as const
export type MatrixPrincipal = typeof matrixPrincipals[number]
export const matrixTransports = ['local', 'rest', 'graphql'] as const
