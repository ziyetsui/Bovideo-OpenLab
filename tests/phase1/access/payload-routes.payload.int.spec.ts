import { GET as restGet, PATCH as restPatch, POST as restPost } from '@/app/(payload)/api/[...slug]/route'
import { POST as graphQLPost } from '@/app/(payload)/api/graphql/route'
import { GET as healthGet } from '@/app/healthz/route'
import { GET as readinessGet } from '@/app/readyz/route'
import config from '@/payload.config'
import { getPayload, type CollectionBeforeChangeHook, type Payload } from 'payload'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createUlid } from '@/access/ulid'
import { readExactApprovedLocale, readOriginalArtifact } from '@/access/content-read'
import { semanticMutationRule } from '@/access/policy'
import { principals } from '@/access/principals'
import { LocalObjectStore } from '@/storage/local-object-store'
import { createObjectAuthority, createObjectIngressCommand, withObjectAuthority } from '@/storage/payload-object-authority'
import type { ObjectRef } from '@/storage/object-ref'

let payload: Payload
let editorToken: string
let editorID: number
let editorStableID: string
let editorUser: Record<string, unknown>
let adminToken: string
let localeVariantID: number
let localeVariantStableID: string
const principalTokens: Record<string, string | undefined> = { anonymous: undefined }
const principalUsers: Record<string, Record<string, unknown>> = {}
let sourceID: number
let sourceStableID: string
let artifactID: number
const localeSourceVersion = `sha256:v1:${'a'.repeat(64)}`
let payloadConfig: Awaited<typeof config>
let objectStoreRoot: string
let objectStore: LocalObjectStore
const editorEmail = `t02-editor-${globalThis.crypto.randomUUID()}@example.test`
const forcedAuditFailureCorrelationID = globalThis.crypto.randomUUID()
const forcedPointerAuditFailureCorrelationID = createUlid()
const forcedUserCreateAuditFailureStableID = createUlid()
const forcedUserDeleteAuditFailureStableID = createUlid()
const forcedStalenessAuditFailureEntities = new Set<string>()

const sourceData = (stableID: string, correlationID?: string) => {
  const contentHash = `sha256:v1:${globalThis.crypto.randomUUID().replaceAll('-', '').repeat(2)}`
  return ({
  stable_id: stableID,
  schema_version: 1,
  revision: 1,
  source_version: localeSourceVersion,
  status: 'active' as const,
  provider: 'first_party' as const,
  provider_record_id: globalThis.crypto.randomUUID(),
  canonical_url: `https://example.test/t02-source/${stableID}`,
  raw_ref: { namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/${contentHash.slice(10, 12)}/${contentHash.slice(10)}`, content_hash: contentHash, version: 'v1', size_bytes: 0, mime_type: 'application/json', rights_state: 'first_party', deletion_state: 'active' },
  captured_at: '2026-08-23T00:00:00.000Z',
  content_hash: contentHash,
  rights_state: 'first_party' as const,
  rights_basis: 'synthetic local fixture',
  deletion_state: 'active' as const,
  ...(correlationID ? { audit: { correlation_id: correlationID } } : {}),
  })
}
const ingressBytes = new Uint8Array()
const ingressHash = `sha256:v1:${createHash('sha256').update(ingressBytes).digest('hex')}`
const ingressRef: ObjectRef = { namespace: 'raw-evidence', bucket_class: 'private_raw', key: `sha256/${ingressHash.slice(10, 12)}/${ingressHash.slice(10)}`, content_hash: ingressHash, version: 'v1', size_bytes: 0, mime_type: 'application/json', rights_state: 'first_party', deletion_state: 'active' }
const trustedSourceContext = async (data: ReturnType<typeof sourceData>) => {
  const correlation = typeof data.audit === 'object' && data.audit !== null && typeof (data.audit as { correlation_id?: unknown }).correlation_id === 'string' ? (data.audit as { correlation_id: string }).correlation_id : 'payload-routes-correlation'
  const receipt = await objectStore.putForIngress({ principal: principals.ingestService, ref: ingressRef, bytes: ingressBytes, field: 'raw_ref', actor_id: 'payload-routes', correlation_id: correlation })
  return withObjectAuthority({}, createObjectIngressCommand({ authority: createObjectAuthority(objectStore), receipt, field: 'raw_ref', actor_id: 'payload-routes', correlation_id: correlation }))
}

const promptArtifactData = (stableID: string, source: number) => ({
  stable_id: stableID,
  schema_version: 1,
  revision: 1,
  source_version: localeSourceVersion,
  status: 'draft' as const,
  kind: 'prompt' as const,
  canonical_label: `t02-artifact-${stableID}`,
  prompt: { original_text: 'synthetic original text' },
  original_language: 'en',
  source,
  rights_state: 'first_party' as const,
  safety_state: 'approved' as const,
  evidence_state: 'verified' as const,
})

const localeVariantData = (stableID: string, entityID: number, overrides: Record<string, unknown> = {}) => ({
  stable_id: stableID,
  schema_version: 1,
  revision: 1,
  source_version: localeSourceVersion,
  status: 'active',
  entity: { relationTo: 'prompt-artifacts', value: entityID },
  entity_key: `prompt-artifact:${entityID}`,
  locale: 'ja-JP',
  source_locale: 'en',
  translation_model: 'local-test',
  translation_prompt_version: '1',
  localized_fields: { title: 'synthetic translation' },
  content_revision: 1,
  workflow_state: 'missing',
  ...overrides,
})

const createIndependentLocaleVariant = async (overrides: Record<string, unknown> = {}) => {
  const sourceVersion = `sha256:v1:${createHash('sha256').update(createUlid()).digest('hex')}`
  const artifact = await payload.create({
    collection: 'prompt-artifacts',
    data: { ...promptArtifactData(createUlid(), sourceID), source_version: sourceVersion },
    overrideAccess: true,
  })
  return payload.create({
    collection: 'locale-variants',
    data: localeVariantData(createUlid(), artifact.id, { source_version: sourceVersion, ...overrides }) as never,
    overrideAccess: true,
    req: {
      user: principalUsers.editor,
      context: { phase1ServerLocaleCommand: { actor: { id: editorStableID }, is_money_page: overrides.is_money_page === true } },
    } as never,
  })
}

const pageRecordData = (stableID: string, entityID: number, overrides: Record<string, unknown> = {}) => ({
  stable_id: stableID,
  schema_version: 1,
  revision: 1,
  source_version: globalThis.crypto.randomUUID(),
  status: 'active',
  page_type: 'detail',
  locale: 'en',
  root_object: { relationTo: 'prompt-artifacts', value: entityID },
  root_object_key: `prompt-artifact:${entityID}:${stableID}`,
  intent: 'semantic transition fixture',
  inventory: {},
  qualification_score: {},
  qualification_input_hash: `sha256:v1:${'a'.repeat(64)}`,
  qualification_rule_version: 'semantic-transition-v1',
  index_state: 'not_generated',
  ...overrides,
})

const productionDeletionData = (stableID: string) => ({
  stable_id: stableID,
  schema_version: 1,
  revision: 1,
  source_version: globalThis.crypto.randomUUID(),
  status: 'received',
  external_request_key: `semantic-delete-${stableID}`,
  scope: 'source',
  legal_basis: 'synthetic local fixture',
  object_refs: [{ type: 'source', id: createUlid() }],
  reason_code: 'semantic matrix',
})

const failSelectedAuditInsert: CollectionBeforeChangeHook = ({ data }) => {
  if (
    data?.correlation_id === forcedAuditFailureCorrelationID ||
    data?.correlation_id === forcedPointerAuditFailureCorrelationID ||
    (data?.event_type === 'users.create' && data?.entity_stable_id === forcedUserCreateAuditFailureStableID) ||
    (data?.event_type === 'users.delete' && data?.entity_stable_id === forcedUserDeleteAuditFailureStableID) ||
    (data?.event_type === 'locale-variants.update' && typeof data?.entity_stable_id === 'string' &&
      forcedStalenessAuditFailureEntities.has(data.entity_stable_id))
  ) {
    throw new Error('forced immutable audit insert failure')
  }
  return data
}

const request = (url: string, init: NonNullable<ConstructorParameters<typeof NextRequest>[1]>, token?: string) =>
  new NextRequest(url, {
    ...init,
    headers: { ...init.headers, ...(token ? { authorization: `JWT ${token}` } : {}) },
  })

const deniedAuditEvents = async () =>
  payload.find({
    collection: 'audit-events',
    limit: 100,
    overrideAccess: true,
    where: { outcome: { equals: 'denied' } },
  })

describe('Payload generated REST and GraphQL route access', () => {
  beforeAll(async () => {
    objectStoreRoot = await mkdtemp(join(tmpdir(), 'bo-p1-payload-routes-store-'))
    objectStore = new LocalObjectStore({ root_dir: objectStoreRoot, signer_secret: 'payload-routes-signer' })
    payloadConfig = await config
    const auditEvents = payloadConfig.collections?.find(({ slug }) => slug === 'audit-events')
    if (!auditEvents) throw new Error('audit-events collection is required for transaction tests')
    auditEvents.hooks = {
      ...auditEvents.hooks,
      beforeChange: [failSelectedAuditInsert, ...(auditEvents.hooks?.beforeChange ?? [])],
    }
    payload = await getPayload({ config: payloadConfig })
    const editor = await payload.create({
      collection: 'users',
      draft: false,
      data: {
        email: editorEmail,
        password: 'phase1-local-test',
        stable_id: createUlid(),
        identity_kind: 'human',
        roles: ['editor'],
      },
      overrideAccess: true,
    })
    editorID = editor.id
    editorStableID = editor.stable_id
    editorUser = editor as never
    principalUsers.editor = editor as never
    const login = await payload.login({
      collection: 'users',
      data: { email: editorEmail, password: 'phase1-local-test' },
    })
    editorToken = login.token ?? ''
    principalTokens.editor = editorToken
    const adminEmail = `t02-admin-${globalThis.crypto.randomUUID()}@example.test`
    const admin = await payload.create({
      collection: 'users',
      data: {
        email: adminEmail,
        password: 'phase1-local-test',
        stable_id: createUlid(),
        identity_kind: 'human',
        roles: ['admin'],
      },
      overrideAccess: true,
    })
    principalUsers.admin = admin as never
    const adminLogin = await payload.login({
      collection: 'users',
      data: { email: adminEmail, password: 'phase1-local-test' },
    })
    adminToken = adminLogin.token ?? ''
    principalTokens.admin = adminToken
    for (const role of ['translator', 'reviewer', 'publisher', 'legal'] as const) {
      const email = `t02-${role}-${globalThis.crypto.randomUUID()}@example.test`
      const user = await payload.create({
        collection: 'users',
        data: {
          email,
          password: 'phase1-local-test',
          stable_id: createUlid(),
          identity_kind: 'human',
          roles: [role],
        },
        overrideAccess: true,
      })
      principalUsers[role] = user as never
      const login = await payload.login({ collection: 'users', data: { email, password: 'phase1-local-test' } })
      principalTokens[role] = login.token
    }
    for (const scope of ['ingest', 'translate', 'publish', 'withdraw'] as const) {
      const existingTranslate = scope === 'translate'
        ? (await payload.find({
          collection: 'users',
          where: { identity_kind: { equals: 'service' } },
          limit: 100,
          overrideAccess: true,
        })).docs.filter((candidate) => Array.isArray(candidate.service_scopes) && candidate.service_scopes.includes('translate'))
        : []
      if (existingTranslate.length > 1) throw new Error('payload routes requires exactly one translate service fixture')
      const email = `t02-${scope}-service-${globalThis.crypto.randomUUID()}@example.test`
      const user = existingTranslate[0] ?? await payload.create({
        collection: 'users',
        data: {
          email,
          password: 'phase1-local-test',
          stable_id: createUlid(),
          identity_kind: 'service',
          roles: [],
          service_scopes: [scope],
        },
        overrideAccess: true,
      })
      principalUsers[`${scope}Service`] = user as never
      const login = await payload.login({ collection: 'users', data: { email: user.email, password: 'phase1-local-test' } })
      principalTokens[`${scope}Service`] = login.token
    }
    sourceStableID = createUlid()
    const sourceSeed = sourceData(sourceStableID)
    const source = await payload.create({
      collection: 'sources',
      data: sourceSeed,
      overrideAccess: true,
      req: { context: await trustedSourceContext(sourceSeed) } as never,
    })
    sourceID = source.id
    const artifact = await payload.create({
      collection: 'prompt-artifacts',
      data: promptArtifactData(createUlid(), sourceID),
      overrideAccess: true,
    })
    artifactID = artifact.id
    localeVariantStableID = createUlid()
    const localeVariant = await payload.create({
      collection: 'locale-variants',
      data: {
        stable_id: localeVariantStableID,
        schema_version: 1,
        revision: 1,
        source_version: localeSourceVersion,
        status: 'active',
        entity: { relationTo: 'prompt-artifacts', value: artifact.id },
        entity_key: `prompt-artifact:${artifact.id}`,
        locale: 'ja-JP',
        source_locale: 'en',
        translation_model: 'local-test',
        translation_prompt_version: '1',
        localized_fields: { title: 'synthetic translation' },
        content_revision: 1,
        workflow_state: 'missing',
        is_money_page: true,
        risk_classes: ['money'],
        last_content_editor: editorID,
        last_content_editor_stable_id: editorStableID,
      },
      overrideAccess: true,
      req: {
        user: editor,
        context: {
          phase1ServerLocaleCommand: {
            actor: { id: editor.stable_id },
            is_money_page: true,
          },
        },
      } as never,
    })
    localeVariantID = localeVariant.id
  }, 30_000)

  afterAll(async () => {
    await payload.destroy()
    await rm(objectStoreRoot, { recursive: true, force: true })
  })

  it('reports process liveness separately from PostgreSQL readiness', async () => {
    const health = await healthGet()
    const readiness = await readinessGet()

    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toEqual({ status: 'ok' })
    expect(readiness.status).toBe(200)
    await expect(readiness.json()).resolves.toEqual({ database: 'postgres', status: 'ready' })
  })

  it('returns original text/language and never falls back a missing target locale through local, REST, and GraphQL reads', async () => {
    const copyDefault = await readOriginalArtifact(payload, { user: editorUser } as never, artifactID)
    const exactAbsent = await readExactApprovedLocale(
      payload,
      { user: editorUser } as never,
      `prompt-artifact:${artifactID}`,
      'fr-FR',
    )
    const local = await payload.findByID({
      collection: 'prompt-artifacts',
      id: artifactID,
      locale: 'ja-JP',
      fallbackLocale: false,
      overrideAccess: true,
    })
    const rest = await restGet(
      request(
        `http://localhost/api/prompt-artifacts/${artifactID}?locale=ja-JP&fallbackLocale=false`,
        { method: 'GET' },
        editorToken,
      ),
      { params: Promise.resolve({ slug: ['prompt-artifacts', String(artifactID)] }) },
    )
    const graphQL = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `{ PromptArtifact(id: ${artifactID}, locale: ja_JP, fallbackLocale: none) { prompt { original_text } original_language } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        editorToken,
      ),
    )
    const absentLocal = await payload.find({
      collection: 'locale-variants',
      locale: 'fr-FR',
      fallbackLocale: false,
      overrideAccess: true,
      where: {
        and: [
          { entity_key: { equals: `prompt-artifact:${artifactID}` } },
          { locale: { equals: 'fr-FR' } },
        ],
      },
    })
    const absentRest = await restGet(
      request(
        `http://localhost/api/locale-variants?locale=fr-FR&fallbackLocale=false&where[and][0][entity_key][equals]=prompt-artifact:${artifactID}&where[and][1][locale][equals]=fr-FR`,
        { method: 'GET' },
        editorToken,
      ),
      { params: Promise.resolve({ slug: ['locale-variants'] }) },
    )
    const absentGraphQL = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `{ LocaleVariants(locale: fr_FR, fallbackLocale: none, where: { AND: [{ entity_key: { equals: \"prompt-artifact:${artifactID}\" } }, { locale: { equals: fr_FR } }] }) { docs { id } } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        editorToken,
      ),
    )
    const [restBody, graphQLBody, absentRestBody, absentGraphQLBody] = await Promise.all([
      rest.json() as Promise<{ prompt?: { original_text?: string }; original_language?: string }>,
      graphQL.json() as Promise<{ data?: { PromptArtifact?: { prompt?: { original_text?: string }; original_language?: string } }; errors?: unknown[] }>,
      absentRest.json() as Promise<{ docs?: unknown[] }>,
      absentGraphQL.json() as Promise<{ data?: { LocaleVariants?: { docs?: unknown[] } }; errors?: unknown[] }>,
    ])

    expect(local.prompt?.original_text).toBe('synthetic original text')
    expect(local.original_language).toBe('en')
    expect(copyDefault).toEqual({ original_language: 'en', original_text: 'synthetic original text' })
    expect(exactAbsent).toBeNull()
    expect(rest.status).toBe(200)
    expect(restBody).toMatchObject({ prompt: { original_text: 'synthetic original text' }, original_language: 'en' })
    expect(graphQL.status).toBe(200)
    expect(graphQLBody.errors).toBeUndefined()
    expect(graphQLBody.data?.PromptArtifact).toMatchObject({ prompt: { original_text: 'synthetic original text' }, original_language: 'en' })
    expect(absentLocal.totalDocs).toBe(0)
    expect(absentRest.status).toBe(200)
    expect(absentRestBody.docs).toHaveLength(0)
    expect(absentGraphQL.status).toBe(200)
    expect(absentGraphQLBody.errors).toBeUndefined()
    expect(absentGraphQLBody.data?.LocaleVariants?.docs).toHaveLength(0)
  })

  it('invalidates every publishable locale state when a source revision is appended', async () => {
    const providerRecordID = createUlid()
    const sourceRevision = async (fill: string) => {
      const bytes = new TextEncoder().encode(`source-revision-${fill}`)
      const contentHash = `sha256:v1:${createHash('sha256').update(bytes).digest('hex')}`
      const ref: ObjectRef = {
        namespace: 'raw-evidence',
        bucket_class: 'private_raw',
        key: `sha256/${contentHash.slice(10, 12)}/${contentHash.slice(10)}`,
        content_hash: contentHash,
        version: 'v1',
        size_bytes: bytes.byteLength,
        mime_type: 'application/json',
        rights_state: 'first_party',
        deletion_state: 'active',
      }
      const data = {
        ...sourceData(createUlid()),
        provider_record_id: providerRecordID,
        content_hash: contentHash,
        raw_ref: ref,
      }
      const correlationID = createUlid()
      const receipt = await objectStore.putForIngress({ principal: principals.ingestService, ref, bytes, field: 'raw_ref', actor_id: 'source-staleness-test', correlation_id: correlationID })
      const context = withObjectAuthority({}, createObjectIngressCommand({ authority: createObjectAuthority(objectStore), receipt, field: 'raw_ref', actor_id: 'source-staleness-test', correlation_id: correlationID }))
      return { context, data }
    }
    const initialSourceRevision = await sourceRevision('c')
    const initialSourceData = initialSourceRevision.data
    const initialSource = await payload.create({
      collection: 'sources',
      data: initialSourceData,
      overrideAccess: true,
      req: { context: initialSourceRevision.context } as never,
    })
    const artifact = await payload.create({
      collection: 'prompt-artifacts',
      data: { ...promptArtifactData(createUlid(), initialSource.id), source_version: initialSource.content_hash },
      overrideAccess: true,
    })
    const createVariant = (locale: 'de-DE' | 'fr-FR' | 'it-IT' | 'ja-JP') => payload.create({
      collection: 'locale-variants',
      data: localeVariantData(createUlid(), artifact.id, { locale, source_version: initialSource.content_hash }) as never,
      overrideAccess: true,
      req: {
        user: principalUsers.editor,
        context: { phase1ServerLocaleCommand: { actor: { id: editorStableID }, is_money_page: false } },
      } as never,
    })
    const transition = (
      id: number,
      userKey: 'editor' | 'reviewer' | 'publisher' | 'translateService',
      actorRole: string,
      from: string,
      to: string,
      revision: number,
      guard: Record<string, unknown>,
    ) => payload.update({
      collection: 'locale-variants',
      id,
      data: { workflow_state: to, revision } as never,
      req: {
        user: principalUsers[userKey],
        context: { phase1CanonicalCommand: {
          expected_revision: revision - 1,
          current_revision: revision - 1,
          correlation_id: createUlid(),
          at: new Date().toISOString(),
          from,
          to,
          actor: { type: userKey.endsWith('Service') ? 'service' : 'user', id: principalUsers[userKey]?.stable_id },
          actor_role: actorRole,
          reason_code: 'source_staleness_fixture',
          guard,
        } },
      } as never,
    })
    const machineDraft = await createVariant('de-DE')
    const review = await createVariant('it-IT')
    const approved = await createVariant('fr-FR')
    const published = await createVariant('ja-JP')
    await transition(machineDraft.id, 'translateService', 'translator_service', 'missing', 'machine_draft', 2, { protected_spans_valid: true })
    await transition(review.id, 'translateService', 'translator_service', 'missing', 'machine_draft', 2, { protected_spans_valid: true })
    await transition(review.id, 'editor', 'editor', 'machine_draft', 'review', 3, { qa_result_id: createUlid() })
    for (const variant of [approved, published]) {
      await transition(variant.id, 'translateService', 'translator_service', 'missing', 'machine_draft', 2, { protected_spans_valid: true })
      await transition(variant.id, 'editor', 'editor', 'machine_draft', 'review', 3, { qa_result_id: createUlid() })
      await transition(variant.id, 'reviewer', 'reviewer', 'review', 'approved', 4, {})
    }
    await transition(published.id, 'publisher', 'publisher', 'approved', 'published', 5, { approved_revision_unchanged: true })

    const nextSourceRevision = await sourceRevision('d')
    const nextSourceData = nextSourceRevision.data
    await payload.create({
      collection: 'sources',
      data: nextSourceData,
      overrideAccess: true,
      req: { context: nextSourceRevision.context } as never,
    })
    const [afterMachineDraft, afterReview, afterApproved, afterPublished] = await Promise.all([
      payload.findByID({ collection: 'locale-variants', id: machineDraft.id, overrideAccess: true }),
      payload.findByID({ collection: 'locale-variants', id: review.id, overrideAccess: true }),
      payload.findByID({ collection: 'locale-variants', id: approved.id, overrideAccess: true }),
      payload.findByID({ collection: 'locale-variants', id: published.id, overrideAccess: true }),
    ])

    expect(afterMachineDraft).toMatchObject({ entity_key: `prompt-artifact:${artifact.id}`, workflow_state: 'stale', revision: 3 })
    expect(afterReview).toMatchObject({ entity_key: `prompt-artifact:${artifact.id}`, workflow_state: 'stale', revision: 4 })
    expect(afterApproved).toMatchObject({ entity_key: `prompt-artifact:${artifact.id}`, workflow_state: 'stale', revision: 5 })
    expect(afterPublished).toMatchObject({ entity_key: `prompt-artifact:${artifact.id}`, workflow_state: 'stale', revision: 6 })
    await expect(transition(approved.id, 'publisher', 'publisher', 'approved', 'published', 5, { approved_revision_unchanged: true }))
      .rejects.toThrow(/canonical command revision conflict/i)
  })

  it('rolls back the appended source and every locale fanout when a later locale audit write fails', async () => {
    const providerRecordID = createUlid()
    const sourceRevision = async (fill: string) => {
      const bytes = new TextEncoder().encode(`source-staleness-rollback-${fill}`)
      const contentHash = `sha256:v1:${createHash('sha256').update(bytes).digest('hex')}`
      const ref: ObjectRef = {
        namespace: 'raw-evidence',
        bucket_class: 'private_raw',
        key: `sha256/${contentHash.slice(10, 12)}/${contentHash.slice(10)}`,
        content_hash: contentHash,
        version: 'v1',
        size_bytes: bytes.byteLength,
        mime_type: 'application/json',
        rights_state: 'first_party',
        deletion_state: 'active',
      }
      const correlationID = createUlid()
      const receipt = await objectStore.putForIngress({ principal: principals.ingestService, ref, bytes, field: 'raw_ref', actor_id: 'source-staleness-rollback-test', correlation_id: correlationID })
      return {
        data: {
          ...sourceData(createUlid()),
          provider_record_id: providerRecordID,
          content_hash: contentHash,
          raw_ref: ref,
        },
        context: withObjectAuthority({}, createObjectIngressCommand({ authority: createObjectAuthority(objectStore), receipt, field: 'raw_ref', actor_id: 'source-staleness-rollback-test', correlation_id: correlationID })),
      }
    }
    const transitionToMachineDraft = (id: number) => payload.update({
      collection: 'locale-variants',
      id,
      data: { workflow_state: 'machine_draft', revision: 2 } as never,
      req: {
        user: principalUsers.translateService,
        context: { phase1CanonicalCommand: {
          expected_revision: 1,
          current_revision: 1,
          correlation_id: createUlid(),
          at: new Date().toISOString(),
          from: 'missing',
          to: 'machine_draft',
          actor: { type: 'service', id: principalUsers.translateService?.stable_id },
          actor_role: 'translator_service',
          reason_code: 'source_staleness_rollback_fixture',
          guard: { protected_spans_valid: true },
        } },
      } as never,
    })

    const initialRevision = await sourceRevision('initial')
    const initialSource = await payload.create({
      collection: 'sources',
      data: initialRevision.data,
      overrideAccess: true,
      req: { context: initialRevision.context } as never,
    })
    const artifacts = await Promise.all(['first', 'second'].map((suffix, index) =>
      payload.create({
        collection: 'prompt-artifacts',
        data: {
          ...promptArtifactData(createUlid(), initialSource.id),
          kind: index === 0 ? 'prompt' : 'workflow',
          canonical_label: `source-staleness-rollback-${suffix}`,
          source_version: initialSource.content_hash,
        },
        overrideAccess: true,
      }),
    ))
    const variants = await Promise.all(artifacts.map((artifact) => payload.create({
      collection: 'locale-variants',
      data: localeVariantData(createUlid(), artifact.id, { source_version: initialSource.content_hash }) as never,
      overrideAccess: true,
      req: { user: principalUsers.editor, context: { phase1ServerLocaleCommand: { actor: { id: editorStableID }, is_money_page: false } } } as never,
    })))
    await Promise.all(variants.map((variant) => transitionToMachineDraft(variant.id)))

    const auditCount = async (stableID: string) => (await payload.find({
      collection: 'audit-events',
      where: { and: [{ event_type: { equals: 'locale-variants.update' } }, { entity_stable_id: { equals: stableID } }] },
      overrideAccess: true,
    })).totalDocs
    const auditCountsBefore = await Promise.all(variants.map((variant) => auditCount(variant.stable_id)))
    const nextRevision = await sourceRevision('next')
    forcedStalenessAuditFailureEntities.add(variants[1].stable_id)
    try {
      await expect(payload.create({
        collection: 'sources',
        data: nextRevision.data,
        overrideAccess: true,
        req: { context: nextRevision.context } as never,
      })).rejects.toThrow('forced immutable audit insert failure')
    } finally {
      forcedStalenessAuditFailureEntities.delete(variants[1].stable_id)
    }

    const [afterFirst, afterSecond, sourceAfterFault, ...auditCountsAfter] = await Promise.all([
      payload.findByID({ collection: 'locale-variants', id: variants[0].id, overrideAccess: true }),
      payload.findByID({ collection: 'locale-variants', id: variants[1].id, overrideAccess: true }),
      payload.find({ collection: 'sources', where: { content_hash: { equals: nextRevision.data.content_hash } }, overrideAccess: true }),
      ...variants.map((variant) => auditCount(variant.stable_id)),
    ])

    expect(afterFirst).toMatchObject({ workflow_state: 'machine_draft', revision: 2 })
    expect(afterSecond).toMatchObject({ workflow_state: 'machine_draft', revision: 2 })
    expect(sourceAfterFault.totalDocs).toBe(0)
    expect(auditCountsAfter).toEqual(auditCountsBefore)
  })

  it('returns only an approved exact locale, never draft or blocked locale content', async () => {
    const createVariant = async (suffix: string) => {
      const sourceVersion = `sha256:v1:${createHash('sha256').update(`exact-locale-${suffix}`).digest('hex')}`
      const artifact = await payload.create({
        collection: 'prompt-artifacts',
        data: { ...promptArtifactData(createUlid(), sourceID), source_version: sourceVersion },
        overrideAccess: true,
      })
      const variant = await payload.create({
      collection: 'locale-variants',
      data: localeVariantData(createUlid(), artifact.id, {
        locale: 'fr-FR',
        source_version: sourceVersion,
      }) as never,
      overrideAccess: true,
      req: {
        user: principalUsers.editor,
        context: { phase1ServerLocaleCommand: { actor: { id: editorStableID }, is_money_page: false } },
      } as never,
    })
      return { key: `prompt-artifact:${artifact.id}`, variant }
    }
    const transition = async (
      id: number,
      userKey: string,
      actorRole: string,
      from: string,
      to: string,
      revision: number,
      guard: Record<string, unknown>,
    ) => payload.update({
      collection: 'locale-variants',
      id,
      data: { workflow_state: to, revision } as never,
      req: {
        user: principalUsers[userKey],
        context: {
          phase1CanonicalCommand: {
            expected_revision: revision - 1,
            current_revision: revision - 1,
            correlation_id: createUlid(),
            at: new Date().toISOString(),
            from,
            to,
            actor: {
              type: userKey.endsWith('Service') ? 'service' : 'user',
              id: principalUsers[userKey]?.stable_id,
            },
            actor_role: actorRole,
            reason_code: `exact_${suffixFor(to)}`,
            guard,
          },
        },
      } as never,
    })
    const suffixFor = (state: string) => state.replaceAll('_', '-')
    const approved = await createVariant('approved')
    await transition(approved.variant.id, 'translateService', 'translator_service', 'missing', 'machine_draft', 2, { protected_spans_valid: true })
    await transition(approved.variant.id, 'editor', 'editor', 'machine_draft', 'review', 3, { qa_result_id: createUlid() })
    await transition(approved.variant.id, 'reviewer', 'reviewer', 'review', 'approved', 4, {})
    const draft = await createVariant('draft')
    await transition(draft.variant.id, 'translateService', 'translator_service', 'missing', 'machine_draft', 2, { protected_spans_valid: true })
    const blocked = await createVariant('blocked')
    await transition(blocked.variant.id, 'translateService', 'translator_service', 'missing', 'machine_draft', 2, { protected_spans_valid: true })
    await transition(blocked.variant.id, 'reviewer', 'reviewer', 'machine_draft', 'blocked', 3, { reason_code: 'qa_blocked' })

    const [approvedRead, draftRead, blockedRead] = await Promise.all([
      readExactApprovedLocale(payload, { user: editorUser } as never, approved.key, 'fr-FR'),
      readExactApprovedLocale(payload, { user: editorUser } as never, draft.key, 'fr-FR'),
      readExactApprovedLocale(payload, { user: editorUser } as never, blocked.key, 'fr-FR'),
    ])
    const exactRest = (key: string) => restGet(
      request(
        `http://localhost/api/locale-variants?locale=fr-FR&fallbackLocale=false&where[and][0][entity_key][equals]=${key}&where[and][1][locale][equals]=fr-FR&where[and][2][workflow_state][equals]=approved`,
        { method: 'GET' },
        editorToken,
      ),
      { params: Promise.resolve({ slug: ['locale-variants'] }) },
    )
    const exactGraphQL = (key: string) => graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `{ LocaleVariants(locale: fr_FR, fallbackLocale: none, where: { AND: [{ entity_key: { equals: \"${key}\" } }, { locale: { equals: fr_FR } }, { workflow_state: { equals: approved } }] }) { docs { id workflow_state } } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        editorToken,
      ),
    )
    const [approvedRest, draftRest, blockedRest, approvedGraphQL, draftGraphQL, blockedGraphQL] = await Promise.all([
      exactRest(approved.key), exactRest(draft.key), exactRest(blocked.key),
      exactGraphQL(approved.key), exactGraphQL(draft.key), exactGraphQL(blocked.key),
    ])
    const [approvedRestBody, draftRestBody, blockedRestBody, approvedGraphQLBody, draftGraphQLBody, blockedGraphQLBody] = await Promise.all([
      approvedRest.json() as Promise<{ docs?: Array<{ id: number; workflow_state: string }> }>,
      draftRest.json() as Promise<{ docs?: unknown[] }>,
      blockedRest.json() as Promise<{ docs?: unknown[] }>,
      approvedGraphQL.json() as Promise<{ data?: { LocaleVariants?: { docs?: Array<{ id: number; workflow_state: string }> } }; errors?: unknown[] }>,
      draftGraphQL.json() as Promise<{ data?: { LocaleVariants?: { docs?: unknown[] } }; errors?: unknown[] }>,
      blockedGraphQL.json() as Promise<{ data?: { LocaleVariants?: { docs?: unknown[] } }; errors?: unknown[] }>,
    ])

    expect(approvedRead).toMatchObject({ id: approved.variant.id, locale: 'fr-FR', workflow_state: 'approved' })
    expect(draftRead).toBeNull()
    expect(blockedRead).toBeNull()
    expect(approvedRestBody.docs).toEqual([expect.objectContaining({ id: approved.variant.id, workflow_state: 'approved' })])
    expect(draftRestBody.docs).toHaveLength(0)
    expect(blockedRestBody.docs).toHaveLength(0)
    expect(approvedGraphQLBody.errors).toBeUndefined()
    expect(approvedGraphQLBody.data?.LocaleVariants?.docs).toEqual([{ id: approved.variant.id, workflow_state: 'approved' }])
    expect(draftGraphQLBody.errors).toBeUndefined()
    expect(draftGraphQLBody.data?.LocaleVariants?.docs).toHaveLength(0)
    expect(blockedGraphQLBody.errors).toBeUndefined()
    expect(blockedGraphQLBody.data?.LocaleVariants?.docs).toHaveLength(0)
  })

  it('rejects original text and language replacement through local, REST, and GraphQL writes', async () => {
    await expect(payload.update({
      collection: 'prompt-artifacts',
      id: artifactID,
      data: { original_language: 'ja' },
      overrideAccess: true,
    })).rejects.toThrow('immutable')
    const rest = await restPatch(
      request(
        `http://localhost/api/prompt-artifacts/${artifactID}`,
        {
          body: JSON.stringify({ prompt: { original_text: 'forged translation' } }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        },
        editorToken,
      ),
      { params: Promise.resolve({ slug: ['prompt-artifacts', String(artifactID)] }) },
    )
    const graphQL = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `mutation { updatePromptArtifact(id: ${artifactID}, data: { original_language: \"ja\" }) { id } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        editorToken,
      ),
    )
    const [artifact, graphQLBody] = await Promise.all([
      payload.findByID({ collection: 'prompt-artifacts', id: artifactID, overrideAccess: true }),
      graphQL.json() as Promise<{ errors?: unknown[] }>,
    ])

    expect(rest.status).toBe(400)
    expect(graphQL.status).toBe(200)
    expect(graphQLBody.errors).toEqual(expect.arrayContaining([expect.anything()]))
    expect(artifact.original_language).toBe('en')
    expect(artifact.prompt?.original_text).toBe('synthetic original text')
  })

  it('denies a REST rights override and emits an immutable denied audit event', async () => {
    const before = await deniedAuditEvents()
    const response = await restPatch(
      request(
        `http://localhost/api/sources/${sourceID}`,
        {
          body: JSON.stringify({ rights_state: 'blocked' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        },
        editorToken,
      ),
      { params: Promise.resolve({ slug: ['sources', String(sourceID)] }) },
    )
    const after = await deniedAuditEvents()

    expect(response.status).toBe(403)
    expect(after.totalDocs).toBe(before.totalDocs + 1)
    expect(after.docs[0]).toMatchObject({ outcome: 'denied', event_type: 'sources.rights_override' })
  })

  it('runs the 11-principal local, REST, and GraphQL high-risk handler matrix with zero unauthorized successes', async () => {
    const principals = [
      'anonymous', 'admin', 'editor', 'translator', 'reviewer', 'publisher', 'legal',
      'ingestService', 'translateService', 'publishService', 'withdrawService',
    ] as const
    for (const principal of principals) {
      const token = principalTokens[principal]
      const before = await deniedAuditEvents()
      const local = await payload.update({
        collection: 'sources',
        id: sourceID,
        data: { rights_state: 'blocked' },
        req: { user: principalUsers[principal] } as never,
      }).then(
        () => ({ rejected: false }),
        (error) => ({ error, rejected: true }),
      )
      const rest = await restPatch(
        request(
          `http://localhost/api/sources/${sourceID}`,
          { body: JSON.stringify({ rights_state: 'blocked' }), headers: { 'content-type': 'application/json' }, method: 'PATCH' },
          token,
        ),
        { params: Promise.resolve({ slug: ['sources', String(sourceID)] }) },
      )
      const graphQL = await graphQLPost(
        request(
          'http://localhost/api/graphql',
          {
            body: JSON.stringify({ query: `mutation { updateSource(id: ${sourceID}, data: { rights_basis: \"matrix-${principal}\" }) { id } }` }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          },
          token,
        ),
      )
      const graphQLBody = (await graphQL.json()) as { errors?: unknown[] }
      const after = await deniedAuditEvents()
      // Policy may permit legal rights work, but public routes cannot manufacture
      // its trusted canonical command. All three generated entry points remain
      // negative controls and emit one immutable denied audit each.
      expect(local.rejected, principal).toBe(true)
      expect(rest.status).toBeGreaterThanOrEqual(400)
      expect(graphQLBody.errors, principal).toHaveLength(1)
      expect(after.totalDocs, principal).toBe(before.totalDocs + 3)
    }
  })

  it('accepts caller-owned Golden approval facts through GraphQL and rejects or overwrites spoofed server facts', async () => {
    const reviewer = principalUsers.reviewer
    const reviewerToken = principalTokens.reviewer
    const baseline = `sha256:v1:${'b'.repeat(64)}`
    const candidate = `sha256:v1:${'c'.repeat(64)}`
    const correlation = createUlid()
    const created = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `mutation { createGoldenReplacementApproval(data:{baseline_manifest_hash:${JSON.stringify(baseline)} candidate_manifest_hash:${JSON.stringify(candidate)} evaluator_version:"graphql-golden-v1" correlation_id:${JSON.stringify(correlation)}}) { id stable_id revision schema_version source_version status reviewer_actor_id reviewer_role approved_at audit_ref audit_outcome audit { correlation_id } } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        reviewerToken,
      ),
    )
    const createdBody = (await created.json()) as { data?: { createGoldenReplacementApproval?: Record<string, unknown> }; errors?: unknown[] }
    expect(createdBody.errors).toBeUndefined()
    expect(createdBody.data?.createGoldenReplacementApproval).toMatchObject({
      revision: 1,
      schema_version: 1,
      source_version: candidate,
      status: 'recorded',
      reviewer_actor_id: reviewer?.stable_id,
      reviewer_role: 'reviewer',
      audit_ref: `golden-replacement-approval:${correlation}`,
      audit_outcome: 'allowed',
      audit: { correlation_id: correlation },
    })
    const persistedCreated = await payload.findByID({
      collection: 'golden-replacement-approvals',
      id: Number(createdBody.data?.createGoldenReplacementApproval?.id),
      overrideAccess: true,
    })
    expect(persistedCreated.reviewer_user).toMatchObject({ id: reviewer?.id })

    const spoofedStableID = createUlid()
    const spoofCorrelation = createUlid()
    const overwritten = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `mutation { createGoldenReplacementApproval(data:{stable_id:${JSON.stringify(spoofedStableID)} revision:99 schema_version:99 source_version:"sha256:v1:${'d'.repeat(64)}" status:recorded baseline_manifest_hash:"sha256:v1:${'e'.repeat(64)}" candidate_manifest_hash:"sha256:v1:${'f'.repeat(64)}" evaluator_version:"graphql-golden-v2" reviewer_actor_id:"attacker" reviewer_role:reviewer correlation_id:${JSON.stringify(spoofCorrelation)} audit_ref:"attacker-ref" audit_outcome:allowed audit:{correlation_id:"attacker-correlation"}}) { id stable_id revision schema_version source_version reviewer_actor_id audit_ref audit { correlation_id } } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        reviewerToken,
      ),
    )
    const overwrittenBody = (await overwritten.json()) as { data?: { createGoldenReplacementApproval?: Record<string, unknown> }; errors?: unknown[] }
    expect(overwrittenBody.errors).toBeUndefined()
    expect(overwrittenBody.data?.createGoldenReplacementApproval).toMatchObject({
      revision: 1,
      schema_version: 1,
      source_version: `sha256:v1:${'f'.repeat(64)}`,
      reviewer_actor_id: reviewer?.stable_id,
      audit_ref: `golden-replacement-approval:${spoofCorrelation}`,
      audit: { correlation_id: spoofCorrelation },
    })
    const persistedOverwritten = await payload.findByID({
      collection: 'golden-replacement-approvals',
      id: Number(overwrittenBody.data?.createGoldenReplacementApproval?.id),
      overrideAccess: true,
    })
    expect(persistedOverwritten.reviewer_user).toMatchObject({ id: reviewer?.id })
    expect(overwrittenBody.data?.createGoldenReplacementApproval?.stable_id).not.toBe(spoofedStableID)

    const rejectedCorrelation = createUlid()
    const rejected = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `mutation { createGoldenReplacementApproval(data:{baseline_manifest_hash:"sha256:v1:${'1'.repeat(64)}" candidate_manifest_hash:"sha256:v1:${'2'.repeat(64)}" evaluator_version:"graphql-golden-v3" correlation_id:${JSON.stringify(rejectedCorrelation)} approved_at:"2020-01-01T00:00:00.000Z"}) { id } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        reviewerToken,
      ),
    )
    const rejectedBody = (await rejected.json()) as { data?: { createGoldenReplacementApproval?: unknown }; errors?: Array<{ message?: string }> }
    expect(rejectedBody.data?.createGoldenReplacementApproval).toBeNull()
    expect(rejectedBody.errors?.[0]?.message).toMatch(/approved_at.*server-derived/i)
    expect(await payload.find({ collection: 'golden-replacement-approvals', overrideAccess: true, where: { correlation_id: { equals: rejectedCorrelation } } })).toMatchObject({ totalDocs: 0 })
  })

  it('denies the equivalent GraphQL rights override through the same policy and audit boundary', async () => {
    const before = await deniedAuditEvents()
    const response = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `mutation { updateSource(id: ${sourceID}, data: { rights_state: blocked }) { id } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        editorToken,
      ),
    )
    const body = (await response.json()) as { errors?: unknown[] }
    const after = await deniedAuditEvents()

    expect(response.status).toBe(200)
    expect(body.errors).toHaveLength(1)
    expect(after.totalDocs).toBe(before.totalDocs + 1)
  })

  it('accepts server-assembled Local legal rights and license commands with canonical allowed audits', async () => {
    const legal = principalUsers.legal
    if (!legal) throw new Error('legal principal is required')
    const sourceSeed = sourceData(createUlid())
    const source = await payload.create({ collection: 'sources', data: sourceSeed, overrideAccess: true, req: { context: await trustedSourceContext(sourceSeed) } as never })
    const command = (revision: number, reasonCode: string) => ({
      expected_revision: revision - 1,
      current_revision: revision - 1,
      correlation_id: createUlid(),
      at: new Date().toISOString(),
      actor: { type: 'user', id: legal.stable_id },
      actor_role: 'legal',
      reason_code: reasonCode,
      guard: {},
    })
    const rights = await payload.update({
      collection: 'sources',
      id: source.id,
      data: { rights_state: 'blocked', revision: 2 } as never,
      overrideAccess: false,
      req: { user: legal, context: { phase1CanonicalCommand: command(2, 'rights_reviewed') } } as never,
    })
    const license = await payload.update({
      collection: 'sources',
      id: source.id,
      data: { rights_basis: 'synthetic legal approval', revision: 3 } as never,
      overrideAccess: false,
      req: { user: legal, context: { phase1CanonicalCommand: command(3, 'license_reviewed') } } as never,
    })
    const audits = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { and: [
        { entity_stable_id: { equals: source.stable_id } },
        { outcome: { equals: 'allowed' } },
      ] },
    })

    expect(rights.rights_state).toBe('blocked')
    expect(license.rights_basis).toBe('synthetic legal approval')
    expect(audits.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'sources.rights_override', reason_code: 'rights_reviewed', actor_stable_id: legal.stable_id, occurred_at: expect.any(String) }),
      expect.objectContaining({ event_type: 'sources.license_change', reason_code: 'license_reviewed', actor_stable_id: legal.stable_id, occurred_at: expect.any(String) }),
    ]))
  })

  it('executes identity escalation through real Local, REST, and GraphQL users handlers for all principals', async () => {
    const principalNames = [
      'anonymous', 'admin', 'editor', 'translator', 'reviewer', 'publisher', 'legal',
      'ingestService', 'translateService', 'publishService', 'withdrawService',
    ] as const
    const transports = ['local', 'rest', 'graphql'] as const
    let deniedCells = 0

    for (const principalName of principalNames) for (const transport of transports) {
      const target = await payload.create({
        collection: 'users',
        data: {
          email: `identity-target-${principalName}-${transport}-${createUlid()}@example.test`,
          password: 'phase1-local-test',
          stable_id: createUlid(),
          identity_kind: 'human',
          roles: ['editor'],
        },
        overrideAccess: true,
      })
      const beforeAudit = await payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: { and: [
          { entity_stable_id: { equals: target.stable_id } },
          { event_type: { equals: 'users.identity_escalation' } },
          { outcome: { equals: 'denied' } },
        ] },
      })
      const token = principalTokens[principalName]
      const user = principalUsers[principalName]
      let succeeded: boolean
      if (transport === 'local') {
        succeeded = await payload.update({
          collection: 'users',
          id: target.id,
          data: { roles: ['legal'] },
          overrideAccess: false,
          req: { user } as never,
        }).then(() => true, () => false)
      } else if (transport === 'rest') {
        const response = await restPatch(
          request(
            `http://localhost/api/users/${target.id}`,
            { body: JSON.stringify({ roles: ['legal'] }), headers: { 'content-type': 'application/json' }, method: 'PATCH' },
            token,
          ),
          { params: Promise.resolve({ slug: ['users', String(target.id)] }) },
        )
        succeeded = response.status < 300
      } else {
        const response = await graphQLPost(
          request(
            'http://localhost/api/graphql',
            {
              body: JSON.stringify({ query: `mutation { updateUser(id: ${target.id}, data: { roles: [legal] }) { id } }` }),
              headers: { 'content-type': 'application/json' },
              method: 'POST',
            },
            token,
          ),
        )
        const body = await response.json() as { errors?: unknown[] }
        succeeded = response.status === 200 && !body.errors?.length
      }
      const persisted = await payload.findByID({ collection: 'users', id: target.id, overrideAccess: true })
      const deniedAudit = await payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: { and: [
          { entity_stable_id: { equals: target.stable_id } },
          { event_type: { equals: 'users.identity_escalation' } },
          { outcome: { equals: 'denied' } },
        ] },
      })
      const expectAllowed = principalName === 'admin'
      expect(succeeded, `${principalName}/${transport}`).toBe(expectAllowed)
      if (expectAllowed) {
        expect(persisted.roles).toEqual(['legal'])
        expect(deniedAudit.totalDocs).toBe(beforeAudit.totalDocs)
      } else {
        deniedCells += 1
        expect(persisted.roles).toEqual(['editor'])
        expect(deniedAudit.totalDocs).toBe(beforeAudit.totalDocs + 1)
        expect(deniedAudit.docs[0]).toMatchObject({
          actor_stable_id: principalName === 'anonymous' ? 'anonymous' : user?.stable_id,
          entity_stable_id: target.stable_id,
          outcome: 'denied',
          reason_code: principalName === 'anonymous' ? 'anonymous_denied' : 'default_deny',
          event_type: 'users.identity_escalation',
          occurred_at: expect.any(String),
        })
        expect(JSON.stringify(deniedAudit.docs[0])).not.toMatch(/password|secret|prompt|private/i)
      }
    }
    expect(deniedCells).toBe(30)
  }, 60_000)

  it('denies and audits every all-principal direct rights, license, and deletion-complete handler cell exactly once', async () => {
    const principalNames = ['anonymous', 'admin', 'editor', 'translator', 'reviewer', 'publisher', 'legal', 'ingestService', 'translateService', 'publishService', 'withdrawService'] as const
    const transports = ['local', 'rest', 'graphql'] as const
    const cases = [
      { id: 'rights_override', eventType: 'sources.rights_override', collection: 'sources', mutation: () => ({ rights_state: 'blocked' }), create: () => sourceData(createUlid()) },
      { id: 'license_change', eventType: 'sources.license_change', collection: 'sources', mutation: () => ({ rights_basis: 'direct route legal text' }), create: () => sourceData(createUlid()) },
      { id: 'deletion_complete', eventType: 'deletion-requests.deletion_complete', collection: 'deletion-requests', mutation: () => ({ status: 'completed' }), create: () => ({ ...productionDeletionData(createUlid()), requested_by: editorID }) },
    ] as const
    let deniedCells = 0

    for (const testCase of cases) for (const principalName of principalNames) for (const transport of transports) {
      const createData = testCase.create()
      const target = await payload.create({
        collection: testCase.collection,
        data: createData as never,
        overrideAccess: true,
        ...(testCase.collection === 'sources' ? { req: { context: await trustedSourceContext(createData as ReturnType<typeof sourceData>) } as never } : {}),
      })
      const before = JSON.parse(JSON.stringify(target))
      const mutation = testCase.mutation()
      const token = principalTokens[principalName]
      const user = principalUsers[principalName]
      let succeeded: boolean
      if (transport === 'local') {
        succeeded = await payload.update({ collection: testCase.collection, id: target.id, data: mutation as never, overrideAccess: false, req: { user } as never }).then(() => true, () => false)
      } else if (transport === 'rest') {
        const response = await restPatch(request(`http://localhost/api/${testCase.collection}/${target.id}`, { body: JSON.stringify(mutation), headers: { 'content-type': 'application/json' }, method: 'PATCH' }, token), { params: Promise.resolve({ slug: [testCase.collection, String(target.id)] }) })
        succeeded = response.status < 300
      } else {
        const type = testCase.collection === 'sources' ? 'Source' : 'DeletionRequest'
        const fields = testCase.id === 'rights_override' ? 'rights_state: blocked' : testCase.id === 'license_change' ? 'rights_basis: "direct route legal text"' : 'status: completed'
        const response = await graphQLPost(request('http://localhost/api/graphql', { body: JSON.stringify({ query: `mutation { update${type}(id: ${target.id}, data: { ${fields} }) { id } }` }), headers: { 'content-type': 'application/json' }, method: 'POST' }, token))
        const body = await response.json() as { errors?: unknown[] }
        succeeded = response.status === 200 && !body.errors?.length
      }
      const [persisted, audits] = await Promise.all([
        payload.findByID({ collection: testCase.collection, id: target.id, overrideAccess: true }),
        payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
          { entity_stable_id: { equals: target.stable_id } },
          { event_type: { equals: testCase.eventType } },
          { outcome: { equals: 'denied' } },
        ] } }),
      ])
      expect(succeeded, `${testCase.id}/${principalName}/${transport}`).toBe(false)
      expect(persisted).toEqual(before)
      expect(audits.totalDocs, `${testCase.id}/${principalName}/${transport}`).toBe(1)
      expect(audits.docs[0]).toMatchObject({ actor_stable_id: principalName === 'anonymous' ? 'anonymous' : user?.stable_id, entity_stable_id: target.stable_id, event_type: testCase.eventType, outcome: 'denied', occurred_at: expect.any(String) })
      expect(JSON.stringify(audits.docs[0])).not.toMatch(/password|secret|prompt|private/i)
      deniedCells += 1
    }
    expect(deniedCells).toBe(99)
  }, 120_000)

  it('rejects a local API stable-ID mutation and records a denied audit event', async () => {
    const replacementID = createUlid()

    await expect(
      payload.update({
        collection: 'users',
        id: editorID,
        data: { stable_id: replacementID },
        overrideAccess: true,
      }),
    ).rejects.toThrow('stable_id is immutable')

    const [user, audits] = await Promise.all([
      payload.findByID({ collection: 'users', id: editorID, overrideAccess: true }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: {
          and: [
            { entity_stable_id: { equals: editorStableID } },
            { event_type: { equals: 'stable_id.immutable_denied' } },
            { outcome: { equals: 'denied' } },
          ],
        },
      }),
    ])
    expect(user.stable_id).toBe(editorStableID)
    expect(audits.totalDocs).toBe(1)
  })

  it('rejects immutable source IDs through REST and GraphQL with a denied audit for each path', async () => {
    const before = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { and: [
        { entity_stable_id: { equals: sourceStableID } },
        { event_type: { equals: 'stable_id.immutable_denied' } },
      ] },
    })
    const rest = await restPatch(
      request(
        `http://localhost/api/sources/${sourceID}`,
        { body: JSON.stringify({ stable_id: createUlid() }), headers: { 'content-type': 'application/json' }, method: 'PATCH' },
        editorToken,
      ),
      { params: Promise.resolve({ slug: ['sources', String(sourceID)] }) },
    )
    const graphQL = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({ query: `mutation { updateSource(id: ${sourceID}, data: { stable_id: \"${createUlid()}\" }) { id } }` }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        editorToken,
      ),
    )
    const after = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { and: [
        { entity_stable_id: { equals: sourceStableID } },
        { event_type: { equals: 'stable_id.immutable_denied' } },
        { outcome: { equals: 'denied' } },
      ] },
    })

    expect(rest.status).toBe(400)
    expect((await graphQL.json()) as { errors?: unknown[] }).toMatchObject({ errors: [expect.anything()] })
    expect(after.totalDocs).toBe(before.totalDocs + 2)
  })

  it('rejects an admin Money Page metadata bypass through local API, REST, and GraphQL and audits each denial', async () => {
    const before = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { and: [
        { entity_stable_id: { equals: localeVariantStableID } },
        { reason_code: { equals: 'locale_metadata_server_managed' } },
      ] },
    })
    await expect(payload.update({
      collection: 'locale-variants',
      id: localeVariantID,
      data: { is_money_page: false },
      overrideAccess: true,
    })).rejects.toThrow('server-managed')
    const rest = await restPatch(
      request(
        `http://localhost/api/locale-variants/${localeVariantID}`,
        { body: JSON.stringify({ is_money_page: false }), headers: { 'content-type': 'application/json' }, method: 'PATCH' },
        adminToken,
      ),
      { params: Promise.resolve({ slug: ['locale-variants', String(localeVariantID)] }) },
    )
    const graphQL = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({ query: `mutation { updateLocaleVariant(id: ${localeVariantID}, data: { is_money_page: false }) { id } }` }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        adminToken,
      ),
    )
    const [variant, after] = await Promise.all([
      payload.findByID({ collection: 'locale-variants', id: localeVariantID, overrideAccess: true }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: { and: [
          { entity_stable_id: { equals: localeVariantStableID } },
          { reason_code: { equals: 'locale_metadata_server_managed' } },
          { outcome: { equals: 'denied' } },
        ] },
      }),
    ])

    expect(rest.status).toBe(400)
    expect((await graphQL.json()) as { errors?: unknown[] }).toMatchObject({ errors: [expect.anything()] })
    expect(variant.is_money_page).toBe(true)
    expect(variant.last_content_editor_stable_id).toBe(editorStableID)
    expect(after.totalDocs).toBe(before.totalDocs + 3)
  })

  it('rejects forged Money Page metadata and a published state on local, REST, and GraphQL locale POSTs', async () => {
    const localStableID = createUlid()
    const restStableID = createUlid()
    const graphQLStableID = createUlid()
    const before = await deniedAuditEvents()

    await expect(payload.create({
      collection: 'locale-variants',
      data: localeVariantData(localStableID, artifactID, {
        is_money_page: true,
        last_content_editor_stable_id: editorStableID,
      }) as never,
      overrideAccess: true,
    })).rejects.toThrow('server-managed')
    const rest = await restPost(
      request(
        'http://localhost/api/locale-variants',
        {
          body: JSON.stringify(localeVariantData(restStableID, artifactID, {
            reviewed_by_stable_id: editorStableID,
          })),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        adminToken,
      ),
      { params: Promise.resolve({ slug: ['locale-variants'] }) },
    )
    const graphQL = await graphQLPost(
      request(
        'http://localhost/api/graphql',
        {
          body: JSON.stringify({
            query: `mutation { createLocaleVariant(data: {
              stable_id: \"${graphQLStableID}\"
              schema_version: 1
              revision: 1
              source_version: \"${localeSourceVersion}\"
              status: active
              entity: { relationTo: prompt_artifacts, value: ${artifactID} }
              entity_key: \"prompt-artifact:${artifactID}\"
              locale: ja_JP
              source_locale: en
              translation_model: \"local-test\"
              translation_prompt_version: \"1\"
              localized_fields: { title: \"synthetic translation\" }
              content_revision: 1
              workflow_state: published
            }) { id } }`,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        adminToken,
      ),
    )
    const [restBody, graphQLBody, after] = await Promise.all([
      rest.json() as Promise<{ errors?: unknown[] }>,
      graphQL.json() as Promise<{ errors?: unknown[] }>,
      deniedAuditEvents(),
    ])

    expect(rest.status).toBe(400)
    expect(restBody.errors).toBeDefined()
    expect(graphQL.status).toBe(200)
    expect(graphQLBody.errors).toHaveLength(1)
    expect(after.totalDocs).toBe(before.totalDocs + 3)
    expect(after.docs.filter((event) => event.entity_stable_id === localStableID)).toHaveLength(1)
    expect(after.docs.filter((event) => event.entity_stable_id === restStableID)).toHaveLength(1)
    expect(after.docs.filter((event) => event.entity_stable_id === graphQLStableID)).toHaveLength(1)
    expect(after.docs.map((event) => event.reason_code)).toEqual(expect.arrayContaining([
      'locale_metadata_server_managed',
      'canonical_command_required',
    ]))
  })

  it('executes real locale and page transition matrices through Local, REST, and GraphQL handlers', async () => {
    const principalNames = [
      'anonymous', 'admin', 'editor', 'translator', 'reviewer', 'publisher', 'legal',
      'ingestService', 'translateService', 'publishService', 'withdrawService',
    ] as const
    const transports = ['local', 'rest', 'graphql'] as const
    const localeRule = semanticMutationRule('locale_transition')
    const pageRule = semanticMutationRule('page_transition')
    const domains = [
      {
        id: 'locale',
        collection: localeRule.collection,
        eventType: `${localeRule.collection}.${localeRule.action}`,
        type: 'LocaleVariant',
        field: 'workflow_state',
        initial: 'missing',
        direct: 'machine_draft',
        create: async () => createIndependentLocaleVariant(),
        commandPermitted: new Set(['editor', 'translator', 'reviewer', 'publisher', 'legal', 'translateService', 'withdrawService']),
      },
      {
        id: 'page',
        collection: pageRule.collection,
        eventType: `${pageRule.collection}.${pageRule.action}`,
        type: 'PageRecord',
        field: 'index_state',
        initial: 'not_generated',
        direct: 'discoverable_noindex',
        create: async () => payload.create({
          collection: 'page-records',
          data: pageRecordData(createUlid(), artifactID) as never,
          overrideAccess: true,
        }),
        commandPermitted: new Set(['editor', 'reviewer', 'publisher', 'legal']),
      },
    ] as const

    let deniedCells = 0
    for (const domain of domains) for (const principalName of principalNames) for (const transport of transports) {
      const target = await domain.create()
      const before = JSON.parse(JSON.stringify(target))
      const token = principalTokens[principalName]
      const user = principalUsers[principalName]
      let succeeded: boolean
      if (transport === 'local') {
        succeeded = await payload.update({
          collection: domain.collection,
          id: target.id,
          data: { [domain.field]: domain.direct } as never,
          overrideAccess: false,
          req: { user } as never,
        }).then(() => true, () => false)
      } else if (transport === 'rest') {
        const response = await restPatch(
          request(
            `http://localhost/api/${domain.collection}/${target.id}`,
            { body: JSON.stringify({ [domain.field]: domain.direct }), headers: { 'content-type': 'application/json' }, method: 'PATCH' },
            token,
          ),
          { params: Promise.resolve({ slug: [domain.collection, String(target.id)] }) },
        )
        succeeded = response.status < 300
      } else {
        const graphqlValue = domain.direct.replaceAll('-', '_')
        const response = await graphQLPost(
          request(
            'http://localhost/api/graphql',
            {
              body: JSON.stringify({ query: `mutation { update${domain.type}(id: ${target.id}, data: { ${domain.field}: ${graphqlValue} }) { id } }` }),
              headers: { 'content-type': 'application/json' },
              method: 'POST',
            },
            token,
          ),
        )
        const body = await response.json() as { errors?: unknown[] }
        succeeded = response.status === 200 && !body.errors?.length
      }
      const [persisted, audits] = await Promise.all([
        payload.findByID({ collection: domain.collection, id: target.id, overrideAccess: true }),
        payload.find({
          collection: 'audit-events',
          overrideAccess: true,
          where: { and: [
            { entity_stable_id: { equals: target.stable_id } },
            { event_type: { equals: domain.eventType } },
            { outcome: { equals: 'denied' } },
          ] },
        }),
      ])
      const reason = principalName === 'anonymous'
        ? 'anonymous_denied'
        : domain.commandPermitted.has(principalName) ? 'canonical_command_required' : 'default_deny'
      expect(succeeded, `${domain.id}/${principalName}/${transport}`).toBe(false)
      expect(persisted, `${domain.id}/${principalName}/${transport}`).toEqual(before)
      expect(audits.totalDocs, `${domain.id}/${principalName}/${transport}`).toBe(1)
      expect(audits.docs[0]).toMatchObject({
        actor_stable_id: principalName === 'anonymous' ? 'anonymous' : user?.stable_id,
        entity_stable_id: target.stable_id,
        event_type: domain.eventType,
        outcome: 'denied',
        reason_code: reason,
        correlation_id: expect.any(String),
        occurred_at: expect.stringMatching(/Z$/),
      })
      expect(JSON.stringify({ prior_state: audits.docs[0]?.prior_state, new_state: audits.docs[0]?.new_state })).not.toMatch(/password|secret|prompt|private|raw/i)
      deniedCells += 1
    }
    expect(deniedCells).toBe(2 * 11 * 3)

    const locale = await domains[0].create()
    const localeCommand = async (
      userKey: 'translateService' | 'editor' | 'reviewer' | 'publisher',
      actorRole: 'translator_service' | 'editor' | 'reviewer' | 'publisher',
      to: string,
      reasonCode: string,
      guard: Record<string, unknown>,
    ) => {
      const current = await payload.findByID({ collection: 'locale-variants', id: locale.id, overrideAccess: true })
      return payload.update({
        collection: 'locale-variants',
        id: locale.id,
        data: { workflow_state: to, revision: current.revision + 1 } as never,
        overrideAccess: false,
        req: {
          user: principalUsers[userKey],
          context: { phase1CanonicalCommand: {
            expected_revision: current.revision,
            current_revision: current.revision,
            correlation_id: createUlid(),
            at: new Date().toISOString(),
            from: current.workflow_state,
            to,
            actor: { type: userKey.endsWith('Service') ? 'service' : 'user', id: principalUsers[userKey]?.stable_id },
            actor_role: actorRole,
            reason_code: reasonCode,
            guard,
          } },
        } as never,
      })
    }
    const localeMachineDraft = await localeCommand('translateService', 'translator_service', 'machine_draft', 'locale_machine_draft', { protected_spans_valid: true })
    const localeReview = await localeCommand('editor', 'editor', 'review', 'locale_review', { qa_result_id: createUlid() })
    const localeApproved = await localeCommand('reviewer', 'reviewer', 'approved', 'locale_approved', {})
    const localePublished = await localeCommand('publisher', 'publisher', 'published', 'locale_published', { approved_revision_unchanged: true })
    const localeAudits = await payload.find({
      collection: 'audit-events', overrideAccess: true,
      where: { and: [
        { entity_stable_id: { equals: locale.stable_id } },
        { event_type: { equals: domains[0].eventType } },
        { outcome: { equals: 'allowed' } },
      ] },
    })
    expect([localeMachineDraft.revision, localeReview.revision, localeApproved.revision, localePublished.revision]).toEqual([2, 3, 4, 5])
    expect(localePublished).toMatchObject({ workflow_state: 'published', revision: 5 })
    expect(localeAudits.totalDocs).toBe(4)
    expect(localeAudits.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason_code: 'locale_machine_draft', actor_stable_id: principalUsers.translateService?.stable_id, occurred_at: expect.stringMatching(/Z$/) }),
      expect.objectContaining({ reason_code: 'locale_review', actor_stable_id: principalUsers.editor?.stable_id, occurred_at: expect.stringMatching(/Z$/) }),
      expect.objectContaining({ reason_code: 'locale_approved', actor_stable_id: principalUsers.reviewer?.stable_id, occurred_at: expect.stringMatching(/Z$/) }),
      expect.objectContaining({ reason_code: 'locale_published', actor_stable_id: principalUsers.publisher?.stable_id, occurred_at: expect.stringMatching(/Z$/) }),
    ]))

    const localeIllegal = await domains[0].create()
    await expect(payload.update({
      collection: 'locale-variants', id: localeIllegal.id,
      data: { workflow_state: 'published', revision: 2 } as never,
      overrideAccess: false,
      req: { user: principalUsers.publisher, context: { phase1CanonicalCommand: {
        expected_revision: 1, current_revision: 1, correlation_id: createUlid(), at: new Date().toISOString(),
        from: 'missing', to: 'published', actor: { type: 'user', id: principalUsers.publisher?.stable_id }, actor_role: 'publisher', reason_code: 'illegal_jump', guard: { approved_revision_unchanged: true },
      } } } as never,
    })).rejects.toThrow('transition denied')
    const localeIllegalAudits = await payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
      { entity_stable_id: { equals: localeIllegal.stable_id } }, { event_type: { equals: domains[0].eventType } }, { outcome: { equals: 'denied' } },
    ] } })
    expect(localeIllegalAudits.docs).toEqual([expect.objectContaining({ reason_code: 'canonical_transition_denied', actor_stable_id: principalUsers.publisher?.stable_id })])
    const localeReplayBefore = await payload.findByID({ collection: 'locale-variants', id: locale.id, overrideAccess: true })
    await expect(payload.update({
      collection: 'locale-variants', id: locale.id, data: { workflow_state: 'machine_draft', revision: 2 } as never,
      overrideAccess: false,
      req: { user: principalUsers.translateService, context: { phase1CanonicalCommand: {
        expected_revision: 1, current_revision: 1, correlation_id: createUlid(), at: new Date().toISOString(),
        from: 'missing', to: 'machine_draft', actor: { type: 'service', id: principalUsers.translateService?.stable_id }, actor_role: 'translator_service', reason_code: 'replay', guard: { protected_spans_valid: true },
      } } } as never,
    })).rejects.toThrow('revision conflict')
    expect(await payload.findByID({ collection: 'locale-variants', id: locale.id, overrideAccess: true })).toEqual(localeReplayBefore)
    const localeReplayAudits = await payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
      { entity_stable_id: { equals: locale.stable_id } }, { event_type: { equals: domains[0].eventType } }, { outcome: { equals: 'denied' } },
    ] } })
    expect(localeReplayAudits.docs).toEqual([expect.objectContaining({ reason_code: 'canonical_command_conflict', actor_stable_id: principalUsers.translateService?.stable_id })])

    const edge = await payload.create({
      collection: 'edges',
      data: {
        stable_id: createUlid(), schema_version: 1, revision: 1, source_version: globalThis.crypto.randomUUID(), status: 'active',
        from: { relationTo: 'sources', value: sourceID }, from_key: `source:${sourceID}:${createUlid()}`,
        relation: 'supports', to: { relationTo: 'prompt-artifacts', value: artifactID }, to_key: `artifact:${artifactID}:${createUlid()}`,
        evidence: [sourceID], confidence: 0.9, review_state: 'approved',
      } as never,
      overrideAccess: true,
    })
    const page = await payload.create({
      collection: 'page-records',
      data: pageRecordData(createUlid(), artifactID, { approval_edge: edge.id, approval_evidence: [sourceID] }) as never,
      overrideAccess: true,
    })
    const pageCommand = async (
      userKey: 'editor' | 'reviewer' | 'publisher',
      actorRole: 'editor' | 'reviewer' | 'publisher',
      to: string,
      reasonCode: string,
      guard: Record<string, unknown>,
    ) => {
      const current = await payload.findByID({ collection: 'page-records', id: page.id, overrideAccess: true })
      return payload.update({
        collection: 'page-records', id: page.id,
        data: { index_state: to, revision: current.revision + 1 } as never,
        overrideAccess: false,
        req: { user: principalUsers[userKey], context: { phase1CanonicalCommand: {
          expected_revision: current.revision, current_revision: current.revision, correlation_id: createUlid(), at: new Date().toISOString(),
          from: current.index_state, to, actor: { type: 'user', id: principalUsers[userKey]?.stable_id }, actor_role: actorRole,
          reason_code: reasonCode, metrics_input_hash: `sha256:v1:${'b'.repeat(64)}`, guard,
        } } } as never,
      })
    }
    const pageDiscoverable = await pageCommand('editor', 'editor', 'discoverable_noindex', 'page_discoverable', { five_gates_recorded: true })
    const pageCandidate = await pageCommand('reviewer', 'reviewer', 'index_candidate', 'page_candidate', { five_gates_recorded: true, locale_and_rights_eligible: true })
    const pageIndexed = await pageCommand('publisher', 'publisher', 'indexable', 'page_indexable', { validators_passed: true })
    const pageAudits = await payload.find({
      collection: 'audit-events', overrideAccess: true,
      where: { and: [
        { entity_stable_id: { equals: page.stable_id } },
        { event_type: { equals: domains[1].eventType } },
        { outcome: { equals: 'allowed' } },
      ] },
    })
    expect([pageDiscoverable.revision, pageCandidate.revision, pageIndexed.revision]).toEqual([2, 3, 4])
    expect(pageIndexed).toMatchObject({ index_state: 'indexable', revision: 4 })
    expect(pageAudits.totalDocs).toBe(3)
    expect(pageAudits.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason_code: 'page_discoverable', actor_stable_id: principalUsers.editor?.stable_id, occurred_at: expect.stringMatching(/Z$/) }),
      expect.objectContaining({ reason_code: 'page_candidate', actor_stable_id: principalUsers.reviewer?.stable_id, occurred_at: expect.stringMatching(/Z$/) }),
      expect.objectContaining({ reason_code: 'page_indexable', actor_stable_id: principalUsers.publisher?.stable_id, occurred_at: expect.stringMatching(/Z$/), new_state: expect.objectContaining({ qualification_input_hash: `sha256:v1:${'a'.repeat(64)}`, metrics_input_hash: `sha256:v1:${'b'.repeat(64)}` }) }),
    ]))

    const pageIllegal = await domains[1].create()
    await expect(payload.update({
      collection: 'page-records', id: pageIllegal.id, data: { index_state: 'discoverable_noindex', revision: 2 } as never,
      overrideAccess: false,
      req: { user: principalUsers.editor, context: { phase1CanonicalCommand: {
        expected_revision: 1, current_revision: 1, correlation_id: createUlid(), at: new Date().toISOString(),
        from: 'not_generated', to: 'discoverable_noindex', actor: { type: 'user', id: principalUsers.editor?.stable_id }, actor_role: 'editor', reason_code: 'illegal_guard', metrics_input_hash: `sha256:v1:${'b'.repeat(64)}`, guard: { five_gates_recorded: false },
      } } } as never,
    })).rejects.toThrow('transition denied')
    const pageIllegalAudits = await payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
      { entity_stable_id: { equals: pageIllegal.stable_id } }, { event_type: { equals: domains[1].eventType } }, { outcome: { equals: 'denied' } },
    ] } })
    expect(pageIllegalAudits.docs).toEqual([expect.objectContaining({ reason_code: 'canonical_transition_denied', actor_stable_id: principalUsers.editor?.stable_id })])
    const pageReplayBefore = await payload.findByID({ collection: 'page-records', id: page.id, overrideAccess: true })
    await expect(payload.update({
      collection: 'page-records', id: page.id, data: { index_state: 'discoverable_noindex', revision: 2 } as never,
      overrideAccess: false,
      req: { user: principalUsers.editor, context: { phase1CanonicalCommand: {
        expected_revision: 1, current_revision: 1, correlation_id: createUlid(), at: new Date().toISOString(),
        from: 'not_generated', to: 'discoverable_noindex', actor: { type: 'user', id: principalUsers.editor?.stable_id }, actor_role: 'editor', reason_code: 'replay', metrics_input_hash: `sha256:v1:${'b'.repeat(64)}`, guard: { five_gates_recorded: true },
      } } } as never,
    })).rejects.toThrow('revision conflict')
    expect(await payload.findByID({ collection: 'page-records', id: page.id, overrideAccess: true })).toEqual(pageReplayBefore)
    const pageReplayAudits = await payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
      { entity_stable_id: { equals: page.stable_id } }, { event_type: { equals: domains[1].eventType } }, { outcome: { equals: 'denied' } },
    ] } })
    expect(pageReplayAudits.docs).toEqual([expect.objectContaining({ reason_code: 'canonical_command_conflict', actor_stable_id: principalUsers.editor?.stable_id })])
  }, 180_000)

  it('executes server-assembled local Money Page canonical controls with editor, reviewer, and publisher separation', async () => {
    const created = await createIndependentLocaleVariant({
      is_money_page: true,
      last_content_editor: editorID,
      last_content_editor_stable_id: editorStableID,
    })
    const stableID = created.stable_id
    const transition = async (
      userKey: string,
      actorRole: string,
      from: string,
      to: string,
      revision: number,
      guard: Record<string, unknown>,
    ) => payload.update({
      collection: 'locale-variants',
      id: created.id,
      data: { workflow_state: to, revision } as never,
      req: {
        user: principalUsers[userKey],
        context: {
          phase1CanonicalCommand: {
            expected_revision: revision - 1,
            current_revision: revision - 1,
            correlation_id: createUlid(),
            at: new Date().toISOString(),
            from,
            to,
            actor: {
              type: userKey.endsWith('Service') ? 'service' : 'user',
              id: principalUsers[userKey]?.stable_id,
            },
            actor_role: actorRole,
            reason_code: `matrix_${to}`,
            guard,
          },
        },
      } as never,
    })

    await transition('translateService', 'translator_service', 'missing', 'machine_draft', 2, { money_page: true, protected_spans_valid: true })
    await transition('editor', 'editor', 'machine_draft', 'review', 3, { money_page: true, qa_result_id: createUlid() })
    await transition('reviewer', 'reviewer', 'review', 'approved', 4, {
      money_page: true,
      last_content_editor_id: editorStableID,
    })
    await transition('publisher', 'publisher', 'approved', 'published', 5, {
      money_page: true,
      approved_revision_unchanged: true,
      reviewer_id: principalUsers.reviewer?.stable_id,
    })
    const [variant, audits] = await Promise.all([
      payload.findByID({ collection: 'locale-variants', id: created.id, overrideAccess: true }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: { and: [
          { entity_stable_id: { equals: stableID } },
          { event_type: { equals: 'locale-variants.locale_transition' } },
          { outcome: { equals: 'allowed' } },
        ] },
      }),
    ])

    expect(variant).toMatchObject({
      workflow_state: 'published',
      last_content_editor_stable_id: editorStableID,
      reviewed_by_stable_id: principalUsers.reviewer?.stable_id,
      reviewed_revision: 1,
    })
    expect(audits.totalDocs).toBe(4)
    expect(audits.docs.map((event) => event.reason_code)).toEqual(expect.arrayContaining([
      'matrix_machine_draft', 'matrix_review', 'matrix_approved', 'matrix_published',
    ]))
  })

  it('commits a source mutation and its immutable audit event together', async () => {
    const stableID = globalThis.crypto.randomUUID()
    const correlationID = globalThis.crypto.randomUUID()

    const sourceSeed = sourceData(stableID, correlationID)
    await payload.create({
      collection: 'sources',
      data: sourceSeed,
      overrideAccess: true,
      req: { context: await trustedSourceContext(sourceSeed) } as never,
    })

    const [sources, audits] = await Promise.all([
      payload.find({
        collection: 'sources',
        overrideAccess: true,
        where: { stable_id: { equals: stableID } },
      }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: { correlation_id: { equals: correlationID } },
      }),
    ])

    expect(sources.totalDocs).toBe(1)
    expect(audits.totalDocs).toBe(1)
    expect(audits.docs[0]).toMatchObject({
      correlation_id: correlationID,
      entity_stable_id: stableID,
      event_type: 'sources.create',
      outcome: 'allowed',
    })
  })

  it('denies an invented Local ObjectRef, leaves no source row, and records a redacted denied audit', async () => {
    const stableID = createUlid()
    const invented = sourceData(stableID)
    await expect(payload.create({
      collection: 'sources', data: invented, overrideAccess: false,
      req: { user: principalUsers.admin } as never,
    })).rejects.toThrow()
    const [sources, audits] = await Promise.all([
      payload.find({ collection: 'sources', overrideAccess: true, where: { stable_id: { equals: stableID } } }),
      payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
        { entity_stable_id: { equals: stableID } }, { event_type: { equals: 'sources.create' } }, { outcome: { equals: 'denied' } },
      ] } }),
    ])
    expect(sources.totalDocs).toBe(0)
    expect(audits.totalDocs).toBe(1)
    expect(JSON.stringify(audits.docs[0])).not.toMatch(/raw_ref|private|key/i)
  })

  it('allows exactly one concurrent duplicate source create and leaves no partial audit state', async () => {
    const stableID = globalThis.crypto.randomUUID()
    const tuple = {
      provider: 'first_party' as const,
      provider_record_id: globalThis.crypto.randomUUID(),
      content_hash: ingressHash,
    }
    const rawRef = ingressRef
    const firstData = { ...sourceData(stableID), ...tuple, raw_ref: rawRef }
    const secondData = { ...sourceData(globalThis.crypto.randomUUID()), ...tuple, raw_ref: rawRef }
    const [firstContext, secondContext] = await Promise.all([trustedSourceContext(firstData), trustedSourceContext(secondData)])
    const attempts = await Promise.allSettled([
      payload.create({ collection: 'sources', data: firstData, overrideAccess: true, req: { context: firstContext } as never }),
      payload.create({ collection: 'sources', data: secondData, overrideAccess: true, req: { context: secondContext } as never }),
    ])
    const sources = await payload.find({
      collection: 'sources',
      overrideAccess: true,
      where: { and: [
        { provider: { equals: tuple.provider } },
        { provider_record_id: { equals: tuple.provider_record_id } },
        { content_hash: { equals: tuple.content_hash } },
      ] },
    })
    const audits = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { entity_stable_id: { equals: sources.docs[0]?.stable_id ?? 'missing-source' } },
    })

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    expect(sources.totalDocs).toBe(1)
    expect(audits.docs.filter((event) => event.event_type === 'sources.create')).toHaveLength(1)
  })

  it('rolls back a source mutation when its immutable audit insert fails', async () => {
    const stableID = globalThis.crypto.randomUUID()
    const sourceSeed = sourceData(stableID, forcedAuditFailureCorrelationID)

    await expect(
      payload.create({
        collection: 'sources',
        data: sourceSeed,
        overrideAccess: true,
        req: { context: await trustedSourceContext(sourceSeed) } as never,
      }),
    ).rejects.toThrow('forced immutable audit insert failure')

    const [sources, audits] = await Promise.all([
      payload.find({
        collection: 'sources',
        overrideAccess: true,
        where: { stable_id: { equals: stableID } },
      }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: { correlation_id: { equals: forcedAuditFailureCorrelationID } },
      }),
    ])

    expect(sources.totalDocs).toBe(0)
    expect(audits.totalDocs).toBe(0)
  })

  it('rolls back user creation when its immutable audit insert fails', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: {
          email: `rollback-create-${globalThis.crypto.randomUUID()}@example.test`,
          password: 'phase1-local-test',
          stable_id: forcedUserCreateAuditFailureStableID,
          identity_kind: 'human',
          roles: ['editor'],
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow('forced immutable audit insert failure')

    const users = await payload.find({
      collection: 'users',
      overrideAccess: true,
      where: { stable_id: { equals: forcedUserCreateAuditFailureStableID } },
    })
    expect(users.totalDocs).toBe(0)
  })

  it('rolls back user deletion when its immutable audit insert fails', async () => {
    const user = await payload.create({
      collection: 'users',
      data: {
        email: `rollback-delete-${globalThis.crypto.randomUUID()}@example.test`,
        password: 'phase1-local-test',
        stable_id: forcedUserDeleteAuditFailureStableID,
        identity_kind: 'human',
        roles: ['editor'],
      },
      overrideAccess: true,
    })

    await expect(
      payload.delete({ collection: 'users', id: user.id, overrideAccess: true }),
    ).rejects.toThrow('forced immutable audit insert failure')

    await expect(
      payload.findByID({ collection: 'users', id: user.id, overrideAccess: true }),
    ).resolves.toMatchObject({ stable_id: forcedUserDeleteAuditFailureStableID })
    const audits = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: {
        and: [
          { entity_stable_id: { equals: forcedUserDeleteAuditFailureStableID } },
          { event_type: { equals: 'users.delete' } },
        ],
      },
    })
    expect(audits.totalDocs).toBe(0)
  })

  it('commits user deletion and its immutable audit event together', async () => {
    const stableID = createUlid()
    const user = await payload.create({
      collection: 'users',
      data: {
        email: `commit-delete-${globalThis.crypto.randomUUID()}@example.test`,
        password: 'phase1-local-test',
        stable_id: stableID,
        identity_kind: 'human',
        roles: ['editor'],
      },
      overrideAccess: true,
    })

    await payload.delete({ collection: 'users', id: user.id, overrideAccess: true })

    const [users, audits] = await Promise.all([
      payload.find({
        collection: 'users',
        overrideAccess: true,
        where: { stable_id: { equals: stableID } },
      }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: {
          and: [
            { entity_stable_id: { equals: stableID } },
            { event_type: { equals: 'users.delete' } },
          ],
        },
      }),
    ])
    expect(users.totalDocs).toBe(0)
    expect(audits.totalDocs).toBe(1)
    expect(audits.docs[0]).toMatchObject({ new_state: null, outcome: 'allowed' })
  })

  it('enforces the private dual-identity pointer CAS and rolls back a failed pointer audit', async () => {
    const singletonKey = 'active-publication'
    const publisher = principalUsers.publisher
    const publishService = principalUsers.publishService
    const editor = principalUsers.editor
    const ingestService = principalUsers.ingestService
    if (!publisher || !publishService || !editor || !ingestService) throw new Error('pointer principals are required')

    const command = (
      expected: { publish_version: number | null; previous_verified_version: number | null; revision: number },
      desired: { publish_version: number | null; previous_verified_version: number | null; revision: number },
      overrides: Record<string, unknown> = {},
    ) => ({
      singleton_key: singletonKey,
      expected_pointer: expected,
      desired_pointer: desired,
      reason_code: 'synthetic_pointer_foundation',
      correlation_id: createUlid(),
      publisher_principal_id: publisher.stable_id,
      publish_service_id: publishService.stable_id,
      ...overrides,
    })
    const localRequest = (pointerCommand: Record<string, unknown>, user = publisher) => ({
      user,
      context: { phase1PointerCommand: pointerCommand },
    })
    const bootstrapCommand = command(
      { publish_version: null, previous_verified_version: null, revision: 0 },
      { publish_version: null, previous_verified_version: null, revision: 0 },
    )

    const failedBootstrapCommand = command(
      { publish_version: null, previous_verified_version: null, revision: 0 },
      { publish_version: null, previous_verified_version: null, revision: 0 },
      { correlation_id: forcedPointerAuditFailureCorrelationID },
    )
    await expect(payload.create({
      collection: 'active-publication-pointers',
      data: {
        singleton_key: singletonKey,
        publish_version: null,
        previous_verified_version: null,
        revision: 0,
      } as never,
      overrideAccess: true,
      req: localRequest(failedBootstrapCommand) as never,
    })).rejects.toThrow('forced immutable audit insert failure')
    const [failedBootstrap, failedBootstrapAudits] = await Promise.all([
      payload.find({
        collection: 'active-publication-pointers',
        overrideAccess: true,
        where: { singleton_key: { equals: singletonKey } },
      }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: { correlation_id: { equals: forcedPointerAuditFailureCorrelationID } },
      }),
    ])
    expect(failedBootstrap.totalDocs).toBe(0)
    expect(failedBootstrapAudits.totalDocs).toBe(0)

    const bootstrap = await payload.create({
      collection: 'active-publication-pointers',
      data: {
        singleton_key: singletonKey,
        publish_version: null,
        previous_verified_version: null,
        revision: 0,
      } as never,
      overrideAccess: true,
      req: localRequest(bootstrapCommand) as never,
    })
    expect(bootstrap).toMatchObject({
      singleton_key: singletonKey,
      publish_version: null,
      previous_verified_version: null,
      revision: 0,
    })
    const bootstrapAudit = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { correlation_id: { equals: bootstrapCommand.correlation_id } },
    })
    expect(bootstrapAudit.docs).toHaveLength(1)
    expect(bootstrapAudit.docs[0]).toMatchObject({
      event_type: 'active-publication-pointers.publish',
      outcome: 'allowed',
      reason_code: 'synthetic_pointer_foundation',
      entity_stable_id: bootstrap.stable_id,
    })

    await expect(payload.update({
      collection: 'active-publication-pointers',
      id: bootstrap.id,
      data: { publish_version: 42, previous_verified_version: null, revision: 1 } as never,
      overrideAccess: true,
      req: { user: publisher } as never,
    })).rejects.toThrow(/private server command/i)
    const ordinaryLocalDenial = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: {
        and: [
          { entity_stable_id: { equals: bootstrap.stable_id } },
          { outcome: { equals: 'denied' } },
        ],
      },
    })
    expect(ordinaryLocalDenial.totalDocs).toBeGreaterThanOrEqual(1)
    expect(ordinaryLocalDenial.docs[0]).toMatchObject({ prior_state: { revision: 0 } })

    const replacementCommand = command(
      { publish_version: null, previous_verified_version: null, revision: 0 },
      { publish_version: 42, previous_verified_version: null, revision: 1 },
    )
    const replacement = await payload.update({
      collection: 'active-publication-pointers',
      id: bootstrap.id,
      data: replacementCommand.desired_pointer as never,
      overrideAccess: true,
      req: localRequest(replacementCommand) as never,
    })
    expect(replacement).toMatchObject({ publish_version: 42, previous_verified_version: null, revision: 1 })
    const replacementAudit = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { correlation_id: { equals: replacementCommand.correlation_id } },
    })
    expect(replacementAudit.docs).toHaveLength(1)
    expect(replacementAudit.docs[0]).toMatchObject({
      event_type: 'active-publication-pointers.publish',
      prior_state: { publish_version: null, previous_verified_version: null, revision: 0 },
      new_state: { publish_version: 42, previous_verified_version: null, revision: 1 },
    })

    const rejectedUpdate = async (pointerCommand: Record<string, unknown>, user = publisher) => {
      await expect(payload.update({
        collection: 'active-publication-pointers',
        id: bootstrap.id,
        data: pointerCommand.desired_pointer as never,
        overrideAccess: true,
        req: localRequest(pointerCommand, user) as never,
      })).rejects.toThrow(/version_conflict|canonical|pointer/i)
      await expect(payload.findByID({
        collection: 'active-publication-pointers', id: bootstrap.id, overrideAccess: true,
      })).resolves.toMatchObject({ publish_version: 42, previous_verified_version: null, revision: 1 })
    }

    await rejectedUpdate(replacementCommand) // replay
    await rejectedUpdate(command(
      { publish_version: 42, previous_verified_version: null, revision: 0 },
      { publish_version: 43, previous_verified_version: 42, revision: 1 },
    )) // stale revision
    await rejectedUpdate(command(
      { publish_version: 99, previous_verified_version: null, revision: 1 },
      { publish_version: 43, previous_verified_version: 42, revision: 2 },
    )) // current-triple mismatch
    await rejectedUpdate(command(
      { publish_version: 42, previous_verified_version: null, revision: 1 },
      { publish_version: 43, previous_verified_version: 42, revision: 2 },
      { publish_service_id: createUlid() },
    )) // missing service
    await rejectedUpdate(command(
      { publish_version: 42, previous_verified_version: null, revision: 1 },
      { publish_version: 43, previous_verified_version: 42, revision: 2 },
      { publish_service_id: ingestService.stable_id },
    )) // wrong service scope
    await rejectedUpdate(command(
      { publish_version: 42, previous_verified_version: null, revision: 1 },
      { publish_version: 43, previous_verified_version: 42, revision: 2 },
      { publisher_principal_id: editor.stable_id },
    ), editor) // wrong human role

    const rest = await restPatch(
      request(
        `http://localhost/api/active-publication-pointers/${bootstrap.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ publish_version: 43, previous_verified_version: 42, revision: 2 }),
          headers: { 'content-type': 'application/json' },
        },
        principalTokens.publisher,
      ),
      { params: Promise.resolve({ slug: ['active-publication-pointers', String(bootstrap.id)] }) },
    )
    const graphQL = await graphQLPost(request('http://localhost/api/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: `mutation { updateActivePublicationPointer(id: ${bootstrap.id}, data: { publish_version: 43 previous_verified_version: 42 revision: 2 }) { id } }`,
      }),
      headers: { 'content-type': 'application/json' },
    }, principalTokens.publisher))
    expect(rest.status).toBeGreaterThanOrEqual(400)
    expect(graphQL.status).toBeGreaterThanOrEqual(200)
    await expect(payload.findByID({
      collection: 'active-publication-pointers', id: bootstrap.id, overrideAccess: true,
    })).resolves.toMatchObject({ publish_version: 42, previous_verified_version: null, revision: 1 })

    await expect(payload.delete({
      collection: 'active-publication-pointers', id: bootstrap.id, overrideAccess: true,
      req: localRequest(command(
        { publish_version: 42, previous_verified_version: null, revision: 1 },
        { publish_version: null, previous_verified_version: null, revision: 2 },
      )) as never,
    })).rejects.toThrow(/pointer|delete/i)
    const deleteDenial = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: {
        and: [
          { entity_stable_id: { equals: String(bootstrap.id) } },
          { outcome: { equals: 'denied' } },
        ],
      },
    })
    expect(deleteDenial.totalDocs).toBeGreaterThanOrEqual(1)

    const failedAuditCommand = command(
      { publish_version: 42, previous_verified_version: null, revision: 1 },
      { publish_version: 43, previous_verified_version: 42, revision: 2 },
      { correlation_id: forcedPointerAuditFailureCorrelationID },
    )
    await expect(payload.update({
      collection: 'active-publication-pointers',
      id: bootstrap.id,
      data: failedAuditCommand.desired_pointer as never,
      overrideAccess: true,
      req: localRequest(failedAuditCommand) as never,
    })).rejects.toThrow('forced immutable audit insert failure')
    const [afterFault, faultAudits] = await Promise.all([
      payload.findByID({ collection: 'active-publication-pointers', id: bootstrap.id, overrideAccess: true }),
      payload.find({ collection: 'audit-events', overrideAccess: true, where: { correlation_id: { equals: forcedPointerAuditFailureCorrelationID } } }),
    ])
    expect(afterFault).toMatchObject({ publish_version: 42, previous_verified_version: null, revision: 1 })
    expect(faultAudits.totalDocs).toBe(0)
  })

  it('allows exactly one concurrent valid pointer command for the same persisted revision', async () => {
    const publisher = principalUsers.publisher
    const publishService = principalUsers.publishService
    if (!publisher || !publishService) throw new Error('pointer principals are required')

    const pointerResult = await payload.find({
      collection: 'active-publication-pointers',
      overrideAccess: true,
      where: { singleton_key: { equals: 'active-publication' } },
      limit: 1,
    })
    const pointer = pointerResult.docs[0]
    if (!pointer) throw new Error('pointer foundation must run before the CAS race')
    expect(pointer).toMatchObject({ publish_version: 42, previous_verified_version: null, revision: 1 })
    const deniedAuditsBefore = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: {
        and: [
          { entity_stable_id: { equals: pointer.stable_id } },
          { event_type: { equals: 'active-publication-pointers.publish' } },
          { outcome: { equals: 'denied' } },
          { reason_code: { equals: 'pointer_version_conflict' } },
        ],
      },
    })

    const expected = { publish_version: 42, previous_verified_version: null, revision: 1 }
    const desired = { publish_version: 43, previous_verified_version: 42, revision: 2 }
    const command = (correlation_id: string) => ({
      singleton_key: 'active-publication',
      expected_pointer: expected,
      desired_pointer: desired,
      reason_code: 'concurrent_pointer_cas',
      correlation_id,
      publisher_principal_id: publisher.stable_id,
      publish_service_id: publishService.stable_id,
    })
    const commands = [command(createUlid()), command(createUlid())]
    const correlations = commands.map(({ correlation_id }) => correlation_id)
    const pointerCollection = payload.config.collections.find(({ slug }) => slug === 'active-publication-pointers')
    if (!pointerCollection) throw new Error('active publication pointers collection is required')
    const existingBeforeChange = pointerCollection.hooks?.beforeChange ?? []
    let arrivals = 0
    let releaseBarrier: (() => void) | undefined
    const barrierReleased = new Promise<void>((resolve) => { releaseBarrier = resolve })
    const barrier: CollectionBeforeChangeHook = async ({ operation, req }) => {
      const correlationID = (req.context as Record<string, unknown> | undefined)?.phase1PointerCommand
      const commandCorrelation = typeof correlationID === 'object' && correlationID !== null
        ? (correlationID as Record<string, unknown>).correlation_id
        : undefined
      if (operation !== 'update' || !correlations.includes(String(commandCorrelation))) return
      arrivals += 1
      if (arrivals === commands.length) releaseBarrier?.()
      await barrierReleased
    }
    pointerCollection.hooks = { ...pointerCollection.hooks, beforeChange: [barrier, ...existingBeforeChange] }

    try {
      const outcomes = await Promise.allSettled(commands.map((pointerCommand) => payload.update({
        collection: 'active-publication-pointers',
        id: pointer.id,
        data: desired as never,
        overrideAccess: true,
        req: { user: publisher, context: { phase1PointerCommand: pointerCommand } } as never,
      })))
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toMatchObject({ status: 409, data: { code: 'version_conflict' } })
    } finally {
      pointerCollection.hooks = { ...pointerCollection.hooks, beforeChange: existingBeforeChange }
    }

    const [persisted, allowedAudits, deniedAudits] = await Promise.all([
      payload.findByID({ collection: 'active-publication-pointers', id: pointer.id, overrideAccess: true }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: {
          and: [
            { correlation_id: { in: correlations } },
            { event_type: { equals: 'active-publication-pointers.publish' } },
            { outcome: { equals: 'allowed' } },
          ],
        },
      }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        sort: '-createdAt',
        limit: 1,
        where: {
          and: [
            { entity_stable_id: { equals: pointer.stable_id } },
            { event_type: { equals: 'active-publication-pointers.publish' } },
            { outcome: { equals: 'denied' } },
            { reason_code: { equals: 'pointer_version_conflict' } },
          ],
        },
      }),
    ])
    expect(persisted).toMatchObject(desired)
    expect(allowedAudits.totalDocs).toBe(1)
    expect(deniedAudits.totalDocs).toBe(deniedAuditsBefore.totalDocs + 1)
    expect(allowedAudits.docs[0]).toMatchObject({
      prior_state: expected,
      new_state: desired,
      reason_code: 'concurrent_pointer_cas',
    })
    expect(deniedAudits.docs[0]).toMatchObject({
      actor_stable_id: publisher.stable_id,
      entity_stable_id: pointer.stable_id,
      event_type: 'active-publication-pointers.publish',
      outcome: 'denied',
      reason_code: 'pointer_version_conflict',
    })
  })

  it('denies and audits every all-principal direct publish handler cell exactly once', async () => {
    const pointer = await payload.find({
      collection: 'active-publication-pointers',
      overrideAccess: true,
      where: { singleton_key: { equals: 'active-publication' } },
      limit: 1,
    })
    const target = pointer.docs[0]
    if (!target) throw new Error('pointer foundation must run before publish matrix')
    const principalNames = ['anonymous', 'admin', 'editor', 'translator', 'reviewer', 'publisher', 'legal', 'ingestService', 'translateService', 'publishService', 'withdrawService'] as const
    const transports = ['local', 'rest', 'graphql'] as const
    let deniedCells = 0
    for (const principalName of principalNames) for (const transport of transports) {
      const before = JSON.parse(JSON.stringify(await payload.findByID({ collection: 'active-publication-pointers', id: target.id, overrideAccess: true })))
      const beforeAudits = await payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
        { entity_stable_id: { equals: target.stable_id } },
        { event_type: { equals: 'active-publication-pointers.publish' } },
        { outcome: { equals: 'denied' } },
      ] } })
      const token = principalTokens[principalName]
      const user = principalUsers[principalName]
      const mutation = { publish_version: 43, previous_verified_version: 42, revision: 2 }
      let succeeded: boolean
      if (transport === 'local') {
        succeeded = await payload.update({ collection: 'active-publication-pointers', id: target.id, data: mutation as never, overrideAccess: false, req: { user } as never }).then(() => true, () => false)
      } else if (transport === 'rest') {
        const response = await restPatch(request(`http://localhost/api/active-publication-pointers/${target.id}`, { body: JSON.stringify(mutation), headers: { 'content-type': 'application/json' }, method: 'PATCH' }, token), { params: Promise.resolve({ slug: ['active-publication-pointers', String(target.id)] }) })
        succeeded = response.status < 300
      } else {
        const response = await graphQLPost(request('http://localhost/api/graphql', { body: JSON.stringify({ query: `mutation { updateActivePublicationPointer(id: ${target.id}, data: { publish_version: 43 previous_verified_version: 42 revision: 2 }) { id } }` }), headers: { 'content-type': 'application/json' }, method: 'POST' }, token))
        const body = await response.json() as { errors?: unknown[] }
        succeeded = response.status === 200 && !body.errors?.length
      }
      const [persisted, audits] = await Promise.all([
        payload.findByID({ collection: 'active-publication-pointers', id: target.id, overrideAccess: true }),
        payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
          { entity_stable_id: { equals: target.stable_id } },
          { event_type: { equals: 'active-publication-pointers.publish' } },
          { outcome: { equals: 'denied' } },
        ] } }),
      ])
      expect(succeeded, `${principalName}/${transport}`).toBe(false)
      expect(persisted).toEqual(before)
      expect(audits.totalDocs, `${principalName}/${transport}`).toBe(beforeAudits.totalDocs + 1)
      expect(audits.docs[0]).toMatchObject({ actor_stable_id: principalName === 'anonymous' ? 'anonymous' : user?.stable_id, entity_stable_id: target.stable_id, event_type: 'active-publication-pointers.publish', outcome: 'denied', occurred_at: expect.any(String) })
      expect(JSON.stringify(audits.docs[0])).not.toMatch(/password|secret|prompt|private/i)
      deniedCells += 1
    }
    expect(deniedCells).toBe(33)
  }, 90_000)

  it('persists only trusted Local redirect/workflow records and keeps REST/GraphQL writes deny-by-default', async () => {
    const sourceVersion = `sha256:v1:${'c'.repeat(64)}`
    const nonce = createUlid()
    const spoofedStableID = createUlid()
    const redirectInput = {
      stable_id: spoofedStableID,
      schema_version: 99,
      revision: 99,
      source_version: sourceVersion,
      status: '301',
      locale: 'en',
      old_path: `/contract/${nonce}`,
      target_path: `/canonical/${nonce}`,
      reason_code: 'contract_test',
    }
    const workflowInput = {
      stable_id: spoofedStableID,
      schema_version: 99,
      revision: 99,
      source_version: sourceVersion,
      status: 'succeeded',
      job_type: 'publish',
      idempotency_key: `contract-${nonce}`,
      attempt: 1,
      input_ref: `private/input/${nonce}`,
      output_ref: `private/output/${nonce}`,
    }
    const trustedRequest = { user: principalUsers.publishService }

    const [redirect, workflow] = await Promise.all([
      payload.create({ collection: 'redirects', data: redirectInput as never, overrideAccess: true, req: trustedRequest as never }),
      payload.create({ collection: 'workflow-runs', data: workflowInput as never, overrideAccess: true, req: trustedRequest as never }),
    ])
    expect(redirect).toMatchObject({ schema_version: 1, revision: 1, old_path: redirectInput.old_path })
    expect(redirect.stable_id).not.toBe(spoofedStableID)
    expect(workflow).toMatchObject({ schema_version: 1, revision: 1, idempotency_key: workflowInput.idempotency_key, error_class: null })
    expect(workflow.stable_id).not.toBe(spoofedStableID)
    expect(redirect.audit).toMatchObject({
      created_by: { id: principalUsers.publishService?.id },
      updated_by: { id: principalUsers.publishService?.id },
    })
    const assertOrdinaryStatusDenial = async (
      collection: 'redirects' | 'workflow-runs',
      target: { id: number; stable_id: string },
      mutation: Record<string, unknown>,
      action: 'redirect_status_transition' | 'workflow_run_status_transition',
    ) => {
      const correlationID = createUlid()
      const before = JSON.parse(JSON.stringify(await payload.findByID({ collection, id: target.id, overrideAccess: true })))
      await expect(payload.update({
        collection,
        id: target.id,
        data: { ...mutation, audit: { correlation_id: correlationID } } as never,
        overrideAccess: false,
        req: { user: principalUsers.publisher } as never,
      })).rejects.toThrow()
      const [persisted, audits] = await Promise.all([
        payload.findByID({ collection, id: target.id, overrideAccess: true }),
        payload.find({
          collection: 'audit-events',
          overrideAccess: true,
          where: { and: [
            { entity_stable_id: { equals: target.stable_id } },
            { event_type: { equals: `${collection}.${action}` } },
            { correlation_id: { equals: correlationID } },
          ] },
        }),
      ])
      expect(persisted).toEqual(before)
      expect(audits.docs).toEqual([expect.objectContaining({
        actor_stable_id: principalUsers.publisher?.stable_id,
        entity_stable_id: target.stable_id,
        event_type: `${collection}.${action}`,
        correlation_id: correlationID,
        outcome: 'denied',
        reason_code: 'default_deny',
        occurred_at: expect.stringMatching(/Z$/),
      })])
      expect(JSON.stringify(audits.docs[0])).not.toMatch(/password|secret|prompt|private|raw/i)
    }
    await assertOrdinaryStatusDenial('redirects', redirect, { status: '410', target_path: null }, 'redirect_status_transition')
    await assertOrdinaryStatusDenial('workflow-runs', workflow, { status: 'failed', output_ref: null, error_class: 'ordinary_denial' }, 'workflow_run_status_transition')
    const updatedRedirect = await payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { source_version: `sha256:v1:${'d'.repeat(64)}` } as never,
      overrideAccess: true,
      req: { user: principalUsers.admin } as never,
    })
    expect(updatedRedirect).toMatchObject({
      source_version: `sha256:v1:${'d'.repeat(64)}`,
      revision: 1,
      audit: {
        created_by: { id: principalUsers.publishService?.id },
        updated_by: { id: principalUsers.admin?.id },
      },
    })
    const beforeProtectedUpdate = await payload.findByID({ collection: 'redirects', id: redirect.id, overrideAccess: true })
    const deniedAuditBefore = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { and: [
        { entity_stable_id: { equals: redirect.stable_id } },
        { outcome: { equals: 'denied' } },
      ] },
    })
    await expect(payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { audit: { correlation_id: createUlid() } } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toThrow(/audit/)
    await expect(payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { createdAt: '2000-01-01T00:00:00.000Z' } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toThrow(/createdAt/)
    await expect(payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { updatedAt: '2000-01-01T00:00:00.000Z' } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toThrow(/updatedAt/)
    await expect(payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { status: '410', target_path: null } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toMatchObject({ data: { code: 'version_conflict' } })
    const [afterProtectedUpdate, deniedAuditAfter] = await Promise.all([
      payload.findByID({ collection: 'redirects', id: redirect.id, overrideAccess: true }),
      payload.find({
        collection: 'audit-events',
        overrideAccess: true,
        where: { and: [
          { entity_stable_id: { equals: redirect.stable_id } },
          { outcome: { equals: 'denied' } },
        ] },
      }),
    ])
    expect(afterProtectedUpdate).toEqual(beforeProtectedUpdate)
    expect(deniedAuditAfter.totalDocs).toBe(deniedAuditBefore.totalDocs + 4)
    const redirectStateCommand = {
      kind: 'redirect',
      stable_id: redirect.stable_id,
      expected: { status: '301', revision: 1 },
      desired: { status: '410', revision: 2 },
      reason_code: 'permanent_deletion',
      correlation_id: createUlid(),
      actor: { id: principalUsers.publisher?.stable_id, type: 'user' },
    }
    const mismatchedRedirectCommand = {
      ...redirectStateCommand,
      desired: { status: '410', revision: 3 },
      correlation_id: createUlid(),
    }
    await expect(payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { status: '410', target_path: null } as never,
      overrideAccess: true,
      req: { user: principalUsers.publisher, context: { phase1RecordStateCommand: mismatchedRedirectCommand } } as never,
    })).rejects.toMatchObject({ data: { code: 'version_conflict' } })
    await expect(payload.findByID({ collection: 'redirects', id: redirect.id, overrideAccess: true })).resolves.toEqual(beforeProtectedUpdate)
    const transitionedRedirect = await payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { status: '410', target_path: null } as never,
      overrideAccess: true,
      req: { user: principalUsers.publisher, context: { phase1RecordStateCommand: redirectStateCommand } } as never,
    })
    expect(transitionedRedirect).toMatchObject({
      status: '410',
      target_path: null,
      revision: 2,
      audit: {
        updated_by: { id: principalUsers.publisher?.id },
        correlation_id: redirectStateCommand.correlation_id,
      },
    })
    const beforeRedirectReplay = await payload.findByID({ collection: 'redirects', id: redirect.id, overrideAccess: true })
    await expect(payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { status: '301', target_path: `/replay/${nonce}` } as never,
      overrideAccess: true,
      req: { user: principalUsers.publisher, context: { phase1RecordStateCommand: redirectStateCommand } } as never,
    })).rejects.toMatchObject({ data: { code: 'version_conflict' } })
    await expect(payload.findByID({ collection: 'redirects', id: redirect.id, overrideAccess: true })).resolves.toEqual(beforeRedirectReplay)
    const stateAudits = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { correlation_id: { equals: redirectStateCommand.correlation_id } },
    })
    expect(stateAudits.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: 'redirects.state_transition',
        outcome: 'allowed',
        reason_code: 'permanent_deletion',
        actor_stable_id: principalUsers.publisher?.stable_id,
      }),
    ]))
    await expect(payload.update({
      collection: 'redirects',
      id: redirect.id,
      data: { status: '301', target_path: `/uncommanded/${nonce}` } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toMatchObject({ data: { code: 'version_conflict' } })
    await expect(payload.update({
      collection: 'workflow-runs',
      id: workflow.id,
      data: { status: 'failed', output_ref: null } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toMatchObject({ data: { code: 'version_conflict' } })
    const workflowStateCommand = {
      kind: 'workflowRun',
      stable_id: workflow.stable_id,
      expected: { status: 'succeeded', revision: 1 },
      desired: { status: 'failed', revision: 2 },
      reason_code: 'worker_failed',
      correlation_id: createUlid(),
      actor: { id: principalUsers.publisher?.stable_id, type: 'user' },
    }
    const transitionedWorkflow = await payload.update({
      collection: 'workflow-runs',
      id: workflow.id,
      data: { status: 'failed', output_ref: null, error_class: 'worker_failed' } as never,
      overrideAccess: true,
      req: { user: principalUsers.publisher, context: { phase1RecordStateCommand: workflowStateCommand } } as never,
    })
    expect(transitionedWorkflow).toMatchObject({
      status: 'failed',
      output_ref: null,
      error_class: 'worker_failed',
      revision: 2,
      audit: {
        updated_by: { id: principalUsers.publisher?.id },
        correlation_id: workflowStateCommand.correlation_id,
      },
    })
    await expect(payload.update({
      collection: 'workflow-runs',
      id: workflow.id,
      data: { status: 'succeeded', output_ref: `private/replay/${nonce}`, error_class: null } as never,
      overrideAccess: true,
      req: { user: principalUsers.publisher, context: { phase1RecordStateCommand: workflowStateCommand } } as never,
    })).rejects.toMatchObject({ data: { code: 'version_conflict' } })
    const workflowStateAudits = await payload.find({
      collection: 'audit-events',
      overrideAccess: true,
      where: { correlation_id: { equals: workflowStateCommand.correlation_id } },
    })
    expect(workflowStateAudits.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: 'workflow-runs.state_transition',
        outcome: 'allowed',
        reason_code: 'worker_failed',
        actor_stable_id: principalUsers.publisher?.stable_id,
      }),
    ]))

    await expect(payload.create({
      collection: 'redirects',
      data: { ...redirectInput, old_path: 'not-a-path' } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toThrow(/old_path/)
    await expect(payload.create({
      collection: 'redirects',
      data: { ...redirectInput, old_path: `/gone/${nonce}`, status: '410', target_path: `/still-here/${nonce}` } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toThrow(/target_path/)
    await expect(payload.create({
      collection: 'workflow-runs',
      data: { ...workflowInput, idempotency_key: `failed-${nonce}`, status: 'failed', output_ref: null } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toThrow(/error_class/)
    await expect(payload.create({
      collection: 'redirects',
      data: { ...redirectInput, old_path: `/unknown/${nonce}`, unexpected: true } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toThrow(/unexpected/)
    await expect(payload.create({
      collection: 'workflow-runs',
      data: { ...workflowInput, idempotency_key: `audit-spoof-${nonce}`, audit: { correlation_id: createUlid() } } as never,
      overrideAccess: true,
      req: trustedRequest as never,
    })).rejects.toThrow(/audit/)

    const rest = await restPost(
      request(`http://localhost/api/redirects`, {
        method: 'POST',
        body: JSON.stringify({ ...redirectInput, old_path: `/rest/${nonce}` }),
        headers: { 'content-type': 'application/json' },
      }, principalTokens.publishService),
      { params: Promise.resolve({ slug: ['redirects'] }) },
    )
    const graphQL = await graphQLPost(request('http://localhost/api/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: `mutation { createWorkflowRun(data:{stable_id:${JSON.stringify(spoofedStableID)} schema_version:99 revision:99 source_version:${JSON.stringify(sourceVersion)} status:succeeded job_type:publish idempotency_key:${JSON.stringify(`graphql-${nonce}`)} attempt:1 input_ref:${JSON.stringify(`private/input/${nonce}`)} output_ref:${JSON.stringify(`private/output/${nonce}`)}}) { id } }`,
      }),
      headers: { 'content-type': 'application/json' },
    }, principalTokens.publishService))
    const beforeDeniedTransportUpdates = await Promise.all([
      payload.findByID({ collection: 'redirects', id: redirect.id, overrideAccess: true }),
      payload.findByID({ collection: 'workflow-runs', id: workflow.id, overrideAccess: true }),
    ])
    const restStatusCorrelationID = createUlid()
    const restUpdate = await restPatch(
      request(`http://localhost/api/redirects/${redirect.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: '301',
          target_path: `/rest-spoof/${nonce}`,
          createdAt: '2000-01-01T00:00:00.000Z',
          audit: { correlation_id: restStatusCorrelationID },
        }),
        headers: { 'content-type': 'application/json' },
      }, principalTokens.publishService),
      { params: Promise.resolve({ slug: ['redirects', String(redirect.id)] }) },
    )
    const restWorkflowStatusCorrelationID = createUlid()
    const restWorkflowUpdate = await restPatch(
      request(`http://localhost/api/workflow-runs/${workflow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'succeeded',
          output_ref: `private/rest-spoof/${nonce}`,
          error_class: null,
          audit: { correlation_id: restWorkflowStatusCorrelationID },
        }),
        headers: { 'content-type': 'application/json' },
      }, principalTokens.publishService),
      { params: Promise.resolve({ slug: ['workflow-runs', String(workflow.id)] }) },
    )
    const graphQLStatusCorrelationID = createUlid()
    const graphQLUpdate = await graphQLPost(request('http://localhost/api/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: `mutation { updateWorkflowRun(id: ${workflow.id}, data:{ status:succeeded output_ref:${JSON.stringify(`private/graphql-spoof/${nonce}`)} error_class:null audit:{ correlation_id:${JSON.stringify(graphQLStatusCorrelationID)} } }) { id } }`,
      }),
      headers: { 'content-type': 'application/json' },
    }, principalTokens.publishService))
    const graphQLRedirectStatusCorrelationID = createUlid()
    const graphQLRedirectUpdate = await graphQLPost(request('http://localhost/api/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: `mutation { updateRedirect(id: ${redirect.id}, data:{ status:_301 target_path:${JSON.stringify(`/graphql-spoof/${nonce}`)} audit:{ correlation_id:${JSON.stringify(graphQLRedirectStatusCorrelationID)} } }) { id } }`,
      }),
      headers: { 'content-type': 'application/json' },
    }, principalTokens.publishService))
    expect(rest.status).toBeGreaterThanOrEqual(400)
    expect(graphQL.status).toBeGreaterThanOrEqual(200)
    expect(restUpdate.status).toBeGreaterThanOrEqual(400)
    expect(restWorkflowUpdate.status).toBeGreaterThanOrEqual(400)
    expect(graphQLUpdate.status).toBeGreaterThanOrEqual(200)
    expect(graphQLRedirectUpdate.status).toBeGreaterThanOrEqual(200)
    const graphQLUpdateBody = await graphQLUpdate.json() as { errors?: unknown[] }
    const graphQLRedirectUpdateBody = await graphQLRedirectUpdate.json() as { errors?: unknown[] }
    expect(graphQLUpdateBody.errors?.length).toBeGreaterThan(0)
    expect(graphQLRedirectUpdateBody.errors?.length).toBeGreaterThan(0)
    const [restRecords, workflowRecords, restStatusAudits, restWorkflowStatusAudits, graphQLStatusAudits, graphQLRedirectStatusAudits] = await Promise.all([
      payload.find({ collection: 'redirects', overrideAccess: true, where: { old_path: { equals: `/rest/${nonce}` } } }),
      payload.find({ collection: 'workflow-runs', overrideAccess: true, where: { idempotency_key: { equals: `graphql-${nonce}` } } }),
      payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
        { entity_stable_id: { equals: redirect.stable_id } },
        { event_type: { equals: 'redirects.redirect_status_transition' } },
        { correlation_id: { equals: restStatusCorrelationID } },
      ] } }),
      payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
        { entity_stable_id: { equals: workflow.stable_id } },
        { event_type: { equals: 'workflow-runs.workflow_run_status_transition' } },
        { correlation_id: { equals: restWorkflowStatusCorrelationID } },
      ] } }),
      payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
        { entity_stable_id: { equals: workflow.stable_id } },
        { event_type: { equals: 'workflow-runs.workflow_run_status_transition' } },
        { correlation_id: { equals: graphQLStatusCorrelationID } },
      ] } }),
      payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
        { entity_stable_id: { equals: redirect.stable_id } },
        { event_type: { equals: 'redirects.redirect_status_transition' } },
        { correlation_id: { equals: graphQLRedirectStatusCorrelationID } },
      ] } }),
    ])
    expect(restRecords.totalDocs).toBe(0)
    expect(workflowRecords.totalDocs).toBe(0)
    expect(restStatusAudits.docs).toEqual([expect.objectContaining({
      actor_stable_id: principalUsers.publishService?.stable_id,
      entity_stable_id: redirect.stable_id,
      event_type: 'redirects.redirect_status_transition',
      correlation_id: restStatusCorrelationID,
      outcome: 'denied',
      reason_code: 'default_deny',
      occurred_at: expect.stringMatching(/Z$/),
    })])
    expect(restWorkflowStatusAudits.docs).toEqual([expect.objectContaining({
      actor_stable_id: principalUsers.publishService?.stable_id,
      entity_stable_id: workflow.stable_id,
      event_type: 'workflow-runs.workflow_run_status_transition',
      correlation_id: restWorkflowStatusCorrelationID,
      outcome: 'denied',
      reason_code: 'default_deny',
      occurred_at: expect.stringMatching(/Z$/),
    })])
    expect(graphQLStatusAudits.docs).toEqual([expect.objectContaining({
      actor_stable_id: principalUsers.publishService?.stable_id,
      entity_stable_id: workflow.stable_id,
      event_type: 'workflow-runs.workflow_run_status_transition',
      correlation_id: graphQLStatusCorrelationID,
      outcome: 'denied',
      reason_code: 'default_deny',
      occurred_at: expect.stringMatching(/Z$/),
    })])
    expect(graphQLRedirectStatusAudits.docs).toEqual([expect.objectContaining({
      actor_stable_id: principalUsers.publishService?.stable_id,
      entity_stable_id: redirect.stable_id,
      event_type: 'redirects.redirect_status_transition',
      correlation_id: graphQLRedirectStatusCorrelationID,
      outcome: 'denied',
      reason_code: 'default_deny',
      occurred_at: expect.stringMatching(/Z$/),
    })])
    expect(JSON.stringify(restStatusAudits.docs[0])).not.toMatch(/password|secret|prompt|private|raw/i)
    expect(JSON.stringify(restWorkflowStatusAudits.docs[0])).not.toMatch(/password|secret|prompt|private|raw/i)
    expect(JSON.stringify(graphQLStatusAudits.docs[0])).not.toMatch(/password|secret|prompt|private|raw/i)
    expect(JSON.stringify(graphQLRedirectStatusAudits.docs[0])).not.toMatch(/password|secret|prompt|private|raw/i)
    await expect(payload.findByID({ collection: 'redirects', id: redirect.id, overrideAccess: true })).resolves.toEqual(beforeDeniedTransportUpdates[0])
    await expect(payload.findByID({ collection: 'workflow-runs', id: workflow.id, overrideAccess: true })).resolves.toEqual(beforeDeniedTransportUpdates[1])
  })

  it('rolls back a canonical localized-content revision when its dedicated audit fails', async () => {
    const created = await createIndependentLocaleVariant()
    const stableID = created.stable_id
    const before = await payload.findByID({ collection: 'locale-variants', id: created.id, overrideAccess: true })
    process.env.PHASE1_FAIL_LOCALE_CONTENT_AUDIT = 'true'
    try {
      await expect(payload.update({
        collection: 'locale-variants', id: created.id, data: { localized_fields: { title: 'changed legal terms' } } as never,
        req: { user: principalUsers.editor, context: { phase1LocaleContentCommand: { expected_revision: before.revision, expected_content_revision: before.content_revision, actor_id: editorStableID, correlation_id: createUlid(), at: new Date().toISOString(), reason_code: 'content_corrected', localized_fields: { title: 'changed legal terms' }, risk_classes: [] } } } as never,
      })).rejects.toThrow('injected localized_content_revised audit failure')
    } finally { delete process.env.PHASE1_FAIL_LOCALE_CONTENT_AUDIT }
    expect(await payload.findByID({ collection: 'locale-variants', id: created.id, overrideAccess: true })).toEqual(before)
    const audits = await payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [{ entity_stable_id: { equals: stableID } }, { event_type: { equals: 'locale-variants.localized_content_revised' } }] } })
    expect(audits.totalDocs).toBe(0)
  })

  it('keeps REST and GraphQL localized-content commands atomic when their specialized audit fails', async () => {
    const createVariant = () => createIndependentLocaleVariant()
    const assertNoPartialRevision = async (created: Awaited<ReturnType<typeof createVariant>>, before: Record<string, unknown>) => {
      expect(await payload.findByID({ collection: 'locale-variants', id: created.id, overrideAccess: true })).toEqual(before)
      const audits = await payload.find({ collection: 'audit-events', overrideAccess: true, where: { and: [
        { entity_stable_id: { equals: created.stable_id } },
        { event_type: { equals: 'locale-variants.localized_content_revised' } },
      ] } })
      expect(audits.totalDocs).toBe(0)
    }

    const restVariant = await createVariant()
    const restBefore = await payload.findByID({ collection: 'locale-variants', id: restVariant.id, overrideAccess: true })
    process.env.PHASE1_FAIL_LOCALE_CONTENT_AUDIT = 'true'
    try {
      const response = await restPost(request('http://localhost/api/locale-content-command', {
        body: JSON.stringify({ id: restVariant.id, expected_revision: restBefore.revision, expected_content_revision: restBefore.content_revision, correlation_id: createUlid(), reason_code: 'content_corrected', localized_fields: { title: 'REST changed price' } }),
        headers: { 'content-type': 'application/json' }, method: 'POST',
      }, editorToken), { params: Promise.resolve({ slug: ['locale-content-command'] }) })
      expect(response.status).toBeGreaterThanOrEqual(400)
      await assertNoPartialRevision(restVariant, restBefore as never)
    } finally { delete process.env.PHASE1_FAIL_LOCALE_CONTENT_AUDIT }
    const restSuccess = await restPost(request('http://localhost/api/locale-content-command', {
      body: JSON.stringify({ id: restVariant.id, expected_revision: restBefore.revision, expected_content_revision: restBefore.content_revision, correlation_id: createUlid(), reason_code: 'content_corrected', localized_fields: { title: 'REST changed price' } }),
      headers: { 'content-type': 'application/json' }, method: 'POST',
    }, editorToken), { params: Promise.resolve({ slug: ['locale-content-command'] }) })
    expect(restSuccess.status).toBe(200)
    expect((await payload.findByID({ collection: 'locale-variants', id: restVariant.id, overrideAccess: true })).content_revision).toBe(restBefore.content_revision + 1)

    const graphVariant = await createVariant()
    const graphBefore = await payload.findByID({ collection: 'locale-variants', id: graphVariant.id, overrideAccess: true })
    process.env.PHASE1_FAIL_LOCALE_CONTENT_AUDIT = 'true'
    try {
      const response = await graphQLPost(request('http://localhost/api/graphql', {
        body: JSON.stringify({ query: `mutation { localeContentCommand(input: { id: ${graphVariant.id}, expectedRevision: ${graphBefore.revision}, expectedContentRevision: ${graphBefore.content_revision}, correlationId: ${JSON.stringify(createUlid())}, reasonCode: "content_corrected", localizedFields: "{\\\"title\\\":\\\"GraphQL changed legal terms\\\"}" }) { id } }` }),
        headers: { 'content-type': 'application/json' }, method: 'POST',
      }, editorToken))
      const body = await response.json() as { errors?: unknown[] }
      expect(response.status).toBe(200)
      expect(body.errors).toHaveLength(1)
      await assertNoPartialRevision(graphVariant, graphBefore as never)
    } finally { delete process.env.PHASE1_FAIL_LOCALE_CONTENT_AUDIT }
    const graphSuccess = await graphQLPost(request('http://localhost/api/graphql', {
      body: JSON.stringify({ query: `mutation { localeContentCommand(input: { id: ${graphVariant.id}, expectedRevision: ${graphBefore.revision}, expectedContentRevision: ${graphBefore.content_revision}, correlationId: ${JSON.stringify(createUlid())}, reasonCode: "content_corrected", localizedFields: "{\\\"title\\\":\\\"GraphQL changed legal terms\\\"}" }) { id content_revision } }` }),
      headers: { 'content-type': 'application/json' }, method: 'POST',
    }, editorToken))
    const graphSuccessBody = await graphSuccess.json() as { data?: { localeContentCommand?: { content_revision?: number } }; errors?: unknown[] }
    expect(graphSuccess.status).toBe(200)
    expect(graphSuccessBody.errors).toBeUndefined()
    expect(graphSuccessBody.data?.localeContentCommand?.content_revision).toBe(graphBefore.content_revision + 1)
  })
})
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
