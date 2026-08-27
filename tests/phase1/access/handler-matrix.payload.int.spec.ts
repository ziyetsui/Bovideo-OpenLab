import { DELETE as restDelete, PATCH as restPatch, POST as restPost } from '@/app/(payload)/api/[...slug]/route'
import { POST as graphQLPost } from '@/app/(payload)/api/graphql/route'
import { createUlid } from '@/access/ulid'
import { decideAccess, principals } from '@/access/policy'
import config from '@/payload.config'
import { LocalObjectStore } from '@/storage/local-object-store'
import { createObjectAuthority, createObjectIngressCommand, withObjectAuthority } from '@/storage/payload-object-authority'
import type { ObjectRef } from '@/storage/object-ref'
import { getPayload, type Payload } from 'payload'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type MatrixCollection, type MatrixOperation, type MatrixPrincipal, matrixPrincipals, matrixTransports, mutationHandlerCatalog } from './handler-matrix'

let payload: Payload
let sourceID: number
let artifactID: number
let objectStoreRoot: string
let objectStore: LocalObjectStore
const users: Partial<Record<Exclude<MatrixPrincipal, 'anonymous'>, Record<string, unknown>>> = {}
const tokens: Partial<Record<Exclude<MatrixPrincipal, 'anonymous'>, string>> = {}
const request = (url: string, init: NonNullable<ConstructorParameters<typeof NextRequest>[1]>, token?: string) => new NextRequest(url, { ...init, headers: { ...init.headers, ...(token ? { authorization: `JWT ${token}` } : {}) } })
const production = (id: string, status: string) => ({ stable_id: id, schema_version: 1, revision: 1, source_version: canonicalSourceVersion('a'), status })
const canonicalSourceVersion = (fill: string) => `sha256:v1:${fill.repeat(64)}`
const matrixApprovalHash = (nonce: string, role: 'baseline' | 'candidate') =>
  `sha256:v1:${createHash('sha256').update(`golden-${role}-${nonce}`).digest('hex')}`
const sourceData = (id: string) => {
  const contentHash = `sha256:v1:${globalThis.crypto.randomUUID().replaceAll('-', '').repeat(2)}`
  return { ...production(id, 'active'), provider: 'first_party', provider_record_id: createUlid(), canonical_url: `https://example.test/${id}`, raw_ref: { namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/${contentHash.slice(10, 12)}/${contentHash.slice(10)}`, content_hash: contentHash, version: 'v1', size_bytes: 0, mime_type: 'application/json', rights_state: 'first_party', deletion_state: 'active' }, captured_at: '2026-08-23T00:00:00.000Z', content_hash: contentHash, rights_state: 'first_party', rights_basis: 'matrix', deletion_state: 'active' }
}
const ingressBytes = new Uint8Array()
const ingressHash = `sha256:v1:${createHash('sha256').update(ingressBytes).digest('hex')}`
const ingressRef: ObjectRef = { namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/${ingressHash.slice(10, 12)}/${ingressHash.slice(10)}`, content_hash: ingressHash, version: 'v1', size_bytes: 0, mime_type: 'application/json', rights_state: 'first_party', deletion_state: 'active' }
// A real 1×1 PNG: CRC-checked IHDR, non-empty IDAT, and terminal IEND.
const mediaBytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'))
const mediaHash = `sha256:v1:${createHash('sha256').update(mediaBytes).digest('hex')}`
const mediaRef: ObjectRef = { namespace: 'public-media', bucket_class: 'worker_public', key: 'media/aa/fixture.png', content_hash: mediaHash, version: 'v1', size_bytes: mediaBytes.byteLength, mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' }
const trustedObjectContext = async (data: Record<string, unknown>) => {
  const field = data.raw_ref === undefined ? 'object_ref' as const : 'raw_ref' as const
  const ref = field === 'raw_ref' ? ingressRef : mediaRef
  const receipt = await objectStore.putForIngress({ principal: field === 'raw_ref' ? principals.ingestService : principals.publishService, ref, bytes: field === 'raw_ref' ? ingressBytes : mediaBytes, field, actor_id: 'handler-matrix', correlation_id: 'handler-matrix-correlation' })
  return withObjectAuthority({}, createObjectIngressCommand({ authority: createObjectAuthority(objectStore), receipt, field, actor_id: 'handler-matrix', correlation_id: 'handler-matrix-correlation' }))
}
const trustedSourceContext = async (data: ReturnType<typeof sourceData>) => trustedObjectContext(data)
const localeVariantFixture = async (nonce: string): Promise<Record<string, unknown>> => {
  const sourceVersion = matrixApprovalHash(nonce, 'candidate')
  const artifact = await payload.create({
    collection: 'prompt-artifacts',
    overrideAccess: true,
    data: {
      ...production(createUlid(), 'draft'),
      source_version: sourceVersion,
      kind: 'prompt',
      canonical_label: `matrix-locale-${nonce}`,
      prompt: { original_text: `matrix locale ${nonce}` },
      original_language: 'en',
      source: sourceID,
      rights_state: 'first_party',
      safety_state: 'approved',
      evidence_state: 'verified',
    } as never,
  })
  return {
    stable_id: createUlid(), schema_version: 1, revision: 1, source_version: sourceVersion, status: 'active',
    entity: { relationTo: 'prompt-artifacts', value: artifact.id }, entity_key: `prompt-artifact:${artifact.id}`,
    locale: 'ja-JP', source_locale: 'en', translation_model: 'matrix', translation_prompt_version: '1',
    localized_fields: { title: 'matrix' }, content_revision: 1, workflow_state: 'missing', risk_classes: [],
  }
}
const fixture = (collection: MatrixCollection, nonce: string): Record<string, unknown> => {
  const id = createUlid()
  switch (collection) {
    case 'users': return { email: `matrix-${nonce}@example.test`, password: 'phase1-local-test', stable_id: id, identity_kind: 'human', roles: ['editor'], service_scopes: [] }
    case 'media': return { alt: `matrix-${nonce}`, object_ref: { namespace: 'public-media', bucket_class: 'worker_public', key: 'media/aa/synthetic.png', content_hash: `sha256:v1:${'a'.repeat(64)}`, version: 'v1', size_bytes: 0, mime_type: 'image/png', rights_state: 'first_party', deletion_state: 'active' } }
    case 'sources': return sourceData(id)
    case 'prompt-artifacts': return { ...production(id, 'draft'), source_version: matrixApprovalHash(nonce, 'candidate'), kind: 'prompt', canonical_label: `matrix-${nonce}`, prompt: { original_text: `matrix ${nonce}` }, original_language: 'en', source: sourceID, rights_state: 'first_party', safety_state: 'approved', evidence_state: 'verified' }
    case 'taxonomy-nodes': return { ...production(id, 'active'), node_type: 'model', stable_key: `matrix-${nonce}`, label: 'Matrix', promotion_state: 'candidate' }
    case 'page-records': return { ...production(id, 'active'), page_type: 'detail', locale: 'en', root_object: { relationTo: 'prompt-artifacts', value: artifactID }, root_object_key: `artifact:${artifactID}:${nonce}`, intent: 'matrix', inventory: {}, qualification_score: {}, qualification_input_hash: createUlid(), qualification_rule_version: 'matrix', index_state: 'not_generated' }
    case 'locale-variants': return { stable_id: id, schema_version: 1, revision: 1, status: 'active', entity: { relationTo: 'prompt-artifacts', value: artifactID }, entity_key: `prompt-artifact:${artifactID}`, locale: 'ja-JP', source_locale: 'en', translation_model: 'matrix', translation_prompt_version: '1', localized_fields: { title: 'matrix' }, content_revision: 1, workflow_state: 'missing', risk_classes: [] }
    case 'edges': return { ...production(id, 'active'), from: { relationTo: 'sources', value: sourceID }, from_key: `source:${sourceID}:${nonce}`, relation: 'supports', to: { relationTo: 'prompt-artifacts', value: artifactID }, to_key: `artifact:${artifactID}:${nonce}`, evidence: [sourceID], confidence: 0.9, review_state: 'candidate' }
    case 'audit-events': return { ...production(id, 'recorded'), event_id: createUlid(), actor_type: 'anonymous', actor_stable_id: 'matrix', correlation_id: createUlid(), event_type: 'matrix', entity_type: 'matrix', entity_stable_id: id, outcome: 'denied', occurred_at: '2026-08-23T00:00:00.000Z' }
    case 'module-envelopes': return { ...production(id, 'active'), module_id: createUlid(), page_id: `page-${nonce}`, locale: 'en', module_type: 'prompt', module_version: 1, source_refs: [sourceID], rights_state: 'first_party', content_hash: globalThis.crypto.randomUUID().replaceAll('-', ''), generated_by: 'human', observed_at: '2026-08-23T00:00:00.000Z', review_state: 'candidate' }
    case 'publication-snapshots': return { ...production(id, 'recorded'), publish_version: Number.parseInt(nonce.slice(-5), 36) || 1, route_manifest_ref: `matrix/${nonce}`, sitemap_manifest_ref: `matrix/${nonce}`, github_manifest_ref: `matrix/${nonce}`, content_tree_hash: createUlid(), validation_report_ref: `matrix/${nonce}` }
    case 'publication-states': return { ...production(id, 'draft'), publish_version: Number.parseInt(nonce.slice(-5), 36) || 1 }
    case 'active-publication-pointers': return { ...production(id, 'active'), singleton_key: `matrix-${nonce}` }
    // These two collections derive their durable common fields in a trusted hook.
    // Matrix seed controls intentionally omit every server-maintained fact.
    case 'redirects': return { source_version: canonicalSourceVersion('a'), status: '301', locale: 'en', old_path: `/matrix/${nonce}`, target_path: `/target/${nonce}`, reason_code: 'matrix' }
    case 'workflow-runs': return { source_version: canonicalSourceVersion('a'), status: 'queued', job_type: 'ingest', idempotency_key: `matrix-${nonce}`, attempt: 0, input_ref: `matrix/${nonce}`, output_ref: null, error_class: null }
    case 'deletion-requests': return { ...production(id, 'received'), external_request_key: `matrix-${nonce}`, scope: 'source', requested_by: users.editor?.id as number, legal_basis: 'matrix', object_refs: [{ type: 'source', id: createUlid() }], reason_code: 'matrix' }
    case 'golden-replacement-approvals': return { baseline_manifest_hash: matrixApprovalHash(nonce, 'baseline'), candidate_manifest_hash: matrixApprovalHash(nonce, 'candidate'), evaluator_version: `matrix-evaluator-v1-${nonce}`, correlation_id: createUlid() }
  }
}
const update = (collection: MatrixCollection, nonce: string) => collection === 'users' ? { email: `update-${nonce}@example.test` } : collection === 'media' ? { alt: `update-${nonce}` } : collection === 'audit-events' ? { reason_code: 'update' } : ['redirects', 'workflow-runs'].includes(collection) ? { source_version: canonicalSourceVersion('b') } : { source_version: globalThis.crypto.randomUUID() }
const types: Record<MatrixCollection, string> = { users: 'User', media: 'Media', sources: 'Source', 'prompt-artifacts': 'PromptArtifact', 'taxonomy-nodes': 'TaxonomyNode', 'page-records': 'PageRecord', 'locale-variants': 'LocaleVariant', edges: 'Edge', 'audit-events': 'AuditEvent', 'module-envelopes': 'ModuleEnvelope', 'publication-snapshots': 'PublicationSnapshot', 'publication-states': 'PublicationState', 'active-publication-pointers': 'ActivePublicationPointer', redirects: 'Redirect', 'workflow-runs': 'WorkflowRun', 'deletion-requests': 'DeletionRequest', 'golden-replacement-approvals': 'GoldenReplacementApproval' }
const enums = new Set(['status', 'identity_kind', 'provider', 'rights_state', 'deletion_state', 'kind', 'safety_state', 'evidence_state', 'node_type', 'promotion_state', 'page_type', 'locale', 'source_locale', 'index_state', 'workflow_state', 'relation', 'review_state', 'actor_type', 'outcome', 'module_type', 'generated_by', 'scope', 'job_type', 'roles', 'service_scopes', 'relationTo', 'reviewer_role', 'audit_outcome'])
const gqlJson = (value: unknown): string =>
  typeof value === 'string' ? JSON.stringify(value) : typeof value === 'number' || typeof value === 'boolean' ? String(value) : Array.isArray(value) ? `[${value.map(gqlJson).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${key}:${gqlJson(item)}`).join(' ')}}` : 'null'
const gql = (value: unknown, field?: string): string =>
  field === 'raw_ref' || field === 'object_ref'
    ? gqlJson(value)
    : typeof value === 'string' ? field && enums.has(field) ? value.replaceAll('-', '_') : JSON.stringify(value) : typeof value === 'number' || typeof value === 'boolean' ? String(value) : Array.isArray(value) ? `[${value.map((item) => gql(item, field)).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${key}:${gql(item, key)}`).join(' ')}}` : 'null'
const policyPrincipal = (principal: MatrixPrincipal) => principals[principal]

/**
 * Generated requests cannot carry the two intentionally private command
 * contexts. This is a handler capability constraint, not a second policy.
 */
const publicRouteCanCarryCommand = (collection: MatrixCollection, operation: MatrixOperation): boolean =>
  !(collection === 'active-publication-pointers' ||
    (collection === 'locale-variants' && operation === 'create'))

const expectedHandlerAllowance = (
  collection: MatrixCollection,
  operation: MatrixOperation,
  principal: MatrixPrincipal,
): boolean =>
  publicRouteCanCarryCommand(collection, operation) && decideAccess({
    principal: policyPrincipal(principal),
    action: operation,
    resource: { collection },
    path: 'internal',
  }).allowed && !(['sources', 'media'].includes(collection) && operation === 'create') &&
  // Localized content/source identity can only change through the dedicated
  // canonical command adapter, never the generated generic update handlers.
  !(collection === 'locale-variants' && operation === 'update')
describe('generated Payload mutation-handler matrix', () => {
  beforeAll(async () => {
    objectStoreRoot = await mkdtemp(join(tmpdir(), 'bo-p1-handler-matrix-store-'))
    objectStore = new LocalObjectStore({ root_dir: objectStoreRoot, signer_secret: 'handler-matrix-signer' })
    payload = await getPayload({ config: await config })
    for (const [name, identity] of [['admin', { identity_kind: 'human', roles: ['admin'], service_scopes: [] }], ['editor', { identity_kind: 'human', roles: ['editor'], service_scopes: [] }], ['translator', { identity_kind: 'human', roles: ['translator'], service_scopes: [] }], ['reviewer', { identity_kind: 'human', roles: ['reviewer'], service_scopes: [] }], ['publisher', { identity_kind: 'human', roles: ['publisher'], service_scopes: [] }], ['legal', { identity_kind: 'human', roles: ['legal'], service_scopes: [] }], ['ingestService', { identity_kind: 'service', roles: [], service_scopes: ['ingest'] }], ['translateService', { identity_kind: 'service', roles: [], service_scopes: ['translate'] }], ['publishService', { identity_kind: 'service', roles: [], service_scopes: ['publish'] }], ['withdrawService', { identity_kind: 'service', roles: [], service_scopes: ['withdraw'] }]] as const) {
      const email = `matrix-${name}-${createUlid()}@example.test`
      const user = await payload.create({ collection: 'users', overrideAccess: true, data: { email, password: 'phase1-local-test', stable_id: createUlid(), ...identity } as never })
      users[name] = user as never
      tokens[name] = (await payload.login({ collection: 'users', data: { email, password: 'phase1-local-test' } })).token ?? ''
    }
    const sourceSeed = sourceData(createUlid())
    sourceID = (await payload.create({ collection: 'sources', overrideAccess: true, data: sourceSeed as never, req: { context: await trustedSourceContext(sourceSeed) } as never })).id
    artifactID = (await payload.create({ collection: 'prompt-artifacts', overrideAccess: true, data: fixture('prompt-artifacts', createUlid()) as never })).id
  }, 30_000)
  afterAll(async () => { await payload.destroy(); await rm(objectStoreRoot, { recursive: true, force: true }) })
  it('catalogs every explicitly configured product collection', async () => {
    const configured = (await config).collections?.map(({ slug }) => slug).filter((slug) => !slug.startsWith('payload-')).sort()
    expect([...mutationHandlerCatalog].sort()).toEqual(configured)
    expect(mutationHandlerCatalog).toHaveLength(17)
  })
  it('executes every create, update, and delete cell through Local API, generated REST, and generated GraphQL', async () => {
    const outcomes: boolean[] = []
    for (const collection of mutationHandlerCatalog) for (const operation of ['create', 'update', 'delete'] as const) for (const principal of matrixPrincipals) for (const transport of matrixTransports) {
      const nonce = `${collection}-${operation}-${principal}-${transport}-${createUlid()}`
      const base = collection === 'locale-variants' ? await localeVariantFixture(nonce) : fixture(collection, nonce)
      const expectAllowed = expectedHandlerAllowance(collection, operation, principal)
      const target = operation === 'create' || collection === 'active-publication-pointers' ? undefined : await payload.create({
        collection,
        overrideAccess: true,
        data: base as never,
        ...(['sources', 'media'].includes(collection) ? { req: { context: await trustedObjectContext(base) } as never } : {}),
        ...(collection === 'media' ? {
          file: {
            data: Buffer.from('phase1 matrix media fixture'),
            mimetype: 'text/plain',
            name: `${nonce}.txt`,
            size: 26,
          },
        } : {}),
        ...(collection === 'locale-variants' ? { req: { user: users.editor, context: { phase1ServerLocaleCommand: { actor: { id: users.editor?.stable_id }, is_money_page: false } } } as never } : {}),
        ...(collection === 'golden-replacement-approvals' ? { req: { user: users.reviewer } as never } : {}),
      })
      const before = target && JSON.parse(JSON.stringify(target))
      const data = operation === 'create' ? base : update(collection, nonce)
      const token = principal === 'anonymous' ? undefined : tokens[principal]
      const user = principal === 'anonymous' ? undefined : users[principal]
      let succeeded = false
      let denialShape = false
      let diagnostic = ''
      if (transport === 'local') {
        succeeded = await (operation === 'create' ? payload.create({ collection, data: data as never, overrideAccess: false, req: { user } as never }) : operation === 'update' ? payload.update({ collection, id: target?.id ?? 999_999, data: data as never, overrideAccess: false, req: { user } as never }) : payload.delete({ collection, id: target?.id ?? 999_999, overrideAccess: false, req: { user } as never })).then(() => true, (error: unknown) => { diagnostic = error instanceof Error ? error.message : String(error); return false })
        denialShape = !succeeded
      } else if (transport === 'rest') {
        const targetID = target?.id ?? 999_999
        const response = operation === 'create' ? await restPost(request(`http://localhost/api/${collection}`, { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } }, token), { params: Promise.resolve({ slug: [collection] }) }) : operation === 'update' ? await restPatch(request(`http://localhost/api/${collection}/${targetID}`, { method: 'PATCH', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } }, token), { params: Promise.resolve({ slug: [collection, String(targetID)] }) }) : await restDelete(request(`http://localhost/api/${collection}/${targetID}`, { method: 'DELETE' }, token), { params: Promise.resolve({ slug: [collection, String(targetID)] }) })
        const body = await response.json() as { errors?: unknown[] }
        succeeded = response.status < 300 && !body.errors?.length
        denialShape = !succeeded && response.status >= 400 && Array.isArray(body.errors) && body.errors.length > 0
      } else {
        const targetID = target?.id ?? 999_999
        const graphQLData = operation === 'update'
          ? Object.fromEntries(Object.entries({ ...base, ...data }).filter(([key]) => key !== 'raw_ref' && key !== 'object_ref' && !(collection === 'sources' && key === 'content_hash')))
          : data
        const query = operation === 'create' ? `mutation { create${types[collection]}(data:${gql(graphQLData)}) { id } }` : operation === 'update' ? `mutation { update${types[collection]}(id:${targetID},data:${gql(graphQLData)}) { id } }` : `mutation { delete${types[collection]}(id:${targetID}) { id } }`
        const response = await graphQLPost(request('http://localhost/api/graphql', { method: 'POST', body: JSON.stringify({ query }), headers: { 'content-type': 'application/json' } }, token))
        const body = await response.json() as { data?: unknown; errors?: unknown[] }
        diagnostic = JSON.stringify(body)
        succeeded = response.status === 200 && body.data !== undefined && !body.errors?.length
        denialShape = !succeeded && response.status === 200 && Array.isArray(body.errors) && body.errors.length > 0
      }
      outcomes.push(succeeded)
      expect(succeeded, `${collection}/${operation}/${principal}/${transport} ${diagnostic}`).toBe(expectAllowed)
      if (!expectAllowed) {
        expect(denialShape, `${collection}/${operation}/${principal}/${transport} denial shape`).toBe(true)
        if (target) expect(await payload.findByID({ collection, id: target.id, overrideAccess: true })).toEqual(before)
      }
    }
    expect(outcomes).toHaveLength(17 * 3 * 11 * 3)
  }, 180_000)
})
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
