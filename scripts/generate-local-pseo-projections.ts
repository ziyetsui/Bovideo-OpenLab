import { createHash, randomUUID } from 'node:crypto'
import { getPayload } from 'payload'
import { pathToFileURL } from 'node:url'

import { createUlid } from '../src/access/ulid'
import { createWorkflowRunTransitionRequest } from '../src/collections/canonical-payload-contract'
import { applicationLocaleSchema, type ApplicationLocale } from '../src/contracts/locale'
import { buildInternalNoindexProjections, type ImportedProjectionArtifact, type ImportedProjectionEntity } from '../src/page/local-internal-projector'
import { createInternalProjectionPublicationRequest } from '../src/publication/payload-projection-command'
import { buildPublicationProjectionBindings } from '../src/publication/projection-bindings'

type PayloadDocument = Record<string, unknown>
type PayloadLocalAPI = Readonly<{
  find: (input: Record<string, unknown>) => Promise<Readonly<{ docs: PayloadDocument[]; totalDocs?: number }>>
  findByID: (input: Record<string, unknown>) => Promise<PayloadDocument>
  create: (input: Record<string, unknown>) => Promise<PayloadDocument>
  update: (input: Record<string, unknown>) => Promise<PayloadDocument>
  destroy: () => Promise<void>
  db?: Readonly<{ pool?: unknown }>
}>

export type LocalProjectionPublishArgs = Readonly<{ locale: ApplicationLocale }>
export type LocalProjectionPublicationResult = Readonly<{
  publishVersion: number
  projectionIDs: readonly string[]
  routes: readonly string[]
  pointerRevision: number
}>

const hash = (value: string): string => `sha256:v1:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const asRecord = (value: unknown): PayloadDocument => typeof value === 'object' && value !== null ? value as PayloadDocument : {}
const asID = (value: unknown): string | number | undefined => typeof value === 'string' || typeof value === 'number' ? value : undefined
const records = (value: unknown): readonly PayloadDocument[] => Array.isArray(value) ? value.map(asRecord) : []

/**
 * Only already-reviewed taxonomy relationships may become an internal entity
 * route. A raw prompt label, an unpopulated relationship, or a candidate node
 * is not sufficient evidence for a route.
 */
const entityRefsFromPayloadDocument = (document: PayloadDocument): readonly ImportedProjectionEntity[] => {
  const entities = new Map<string, ImportedProjectionEntity>()
  for (const reference of [...records(document.model_refs), ...records(document.taxonomy_refs)]) {
    const id = typeof reference.stable_id === 'string' ? reference.stable_id : undefined
    const kind = reference.node_type
    const stableKey = typeof reference.stable_key === 'string' ? reference.stable_key : undefined
    const label = typeof reference.label === 'string' ? reference.label.trim() : ''
    const promotionState = reference.promotion_state
    if (!id || !stableKey || !label ||
      (kind !== 'model' && kind !== 'use_case' && kind !== 'style') ||
      (promotionState !== 'reviewed' && promotionState !== 'qualified') ||
      !stableKey.startsWith(`${kind}:`)) continue
    const entity: ImportedProjectionEntity = { id, kind, stableKey, label, promotionState }
    const existing = entities.get(`${kind}\u0000${stableKey}`)
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(entity))
      throw new Error(`conflicting taxonomy entity relationship ${stableKey}`)
    entities.set(`${kind}\u0000${stableKey}`, entity)
  }
  return Object.freeze([...entities.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind, 'en-US') || left.stableKey.localeCompare(right.stableKey, 'en-US')))
}

export const parseLocalProjectionPublishArgs = (argumentsAfterCommand = process.argv.slice(2)): LocalProjectionPublishArgs => {
  let locale: string = 'en'
  for (let index = 0; index < argumentsAfterCommand.length; index += 1) {
    const argument = argumentsAfterCommand[index]
    if (argument === '--' && index === 0) continue
    if (argument === '--locale') {
      const candidate = argumentsAfterCommand[index + 1]
      if (!candidate) throw new Error('--locale requires a supported locale')
      locale = candidate
      index += 1
      continue
    }
    throw new Error(`unknown local projection publication argument: ${argument}`)
  }
  const parsedLocale = applicationLocaleSchema.safeParse(locale)
  if (!parsedLocale.success) throw new Error(`unsupported locale: ${locale}`)
  return Object.freeze({ locale: parsedLocale.data })
}

export const artifactsFromPayload = async (payload: PayloadLocalAPI, locale: ApplicationLocale): Promise<readonly ImportedProjectionArtifact[]> => {
  const result = await payload.find({
    collection: 'prompt-artifacts', depth: 1, limit: 10_000, overrideAccess: true,
    where: { kind: { equals: 'prompt' } }, sort: 'id',
  })
  const artifacts = result.docs.flatMap((document): ImportedProjectionArtifact[] => {
    const prompt = asRecord(document.prompt)
    const source = asRecord(document.source)
    const stableID = typeof document.stable_id === 'string' ? document.stable_id : undefined
    const sourceID = typeof source.stable_id === 'string' ? source.stable_id : undefined
    const sourceVersion = typeof source.source_version === 'string' ? source.source_version : undefined
    const originalText = typeof prompt.original_text === 'string' ? prompt.original_text.trim() : ''
    const observedAt = typeof source.captured_at === 'string' ? source.captured_at : undefined
    const title = typeof document.canonical_label === 'string' ? document.canonical_label.trim() : ''
    const mediaType = asRecord(document.outcome).media_type
    if (!stableID || !sourceID || !sourceVersion || !originalText || !observedAt || !title) return []
    return [{
      id: stableID,
      sourceID,
      sourceVersion,
      title,
      text: originalText,
      mediaType: mediaType === 'image' || mediaType === 'video' ? mediaType : 'unresolved',
      observedAt,
      canonicalURL: typeof source.canonical_url === 'string' ? source.canonical_url : undefined,
      entityRefs: entityRefsFromPayloadDocument(document),
    }]
  })
  if (artifacts.length === 0) throw new Error(`no imported prompt artifacts are available for ${locale} projection publication`)
  return Object.freeze(artifacts)
}

const findOrCreatePublisherAuthorities = async (payload: PayloadLocalAPI): Promise<Readonly<{ publisher: PayloadDocument; publishService: PayloadDocument }>> => {
  const users = await payload.find({ collection: 'users', limit: 200, depth: 0, overrideAccess: true })
  const find = (kind: string, field: 'roles' | 'service_scopes', value: string): PayloadDocument | undefined => users.docs.find((user) =>
    user.identity_kind === kind && Array.isArray(user[field]) && user[field].length === 1 && user[field][0] === value)
  const publisher = find('human', 'roles', 'publisher') ?? await payload.create({
    collection: 'users', overrideAccess: true,
    data: { email: `local-publisher-${randomUUID()}@internal.invalid`, password: randomUUID(), stable_id: createUlid(), identity_kind: 'human', roles: ['publisher'], service_scopes: [] },
  })
  const publishService = find('service', 'service_scopes', 'publish') ?? await payload.create({
    collection: 'users', overrideAccess: true,
    data: { email: `local-publish-service-${randomUUID()}@internal.invalid`, password: randomUUID(), stable_id: createUlid(), identity_kind: 'service', roles: [], service_scopes: ['publish'] },
  })
  return Object.freeze({ publisher, publishService })
}

const terminalWorkflow = async (payload: PayloadLocalAPI, run: PayloadDocument, outputRef: string): Promise<void> => {
  const id = asID(run.id)
  const stableID = typeof run.stable_id === 'string' ? run.stable_id : undefined
  const revision = typeof run.revision === 'number' ? run.revision : undefined
  const status = typeof run.status === 'string' ? run.status : undefined
  if (id === undefined || stableID === undefined || revision === undefined || status === undefined) throw new Error('projection workflow run is malformed')
  await payload.update({
    collection: 'workflow-runs', id, overrideAccess: true,
    data: { status: 'succeeded', output_ref: outputRef, error_class: null },
    req: createWorkflowRunTransitionRequest({ stable_id: stableID, expected: { status, revision }, status: 'succeeded', reason_code: 'local_projection_published', correlation_id: createUlid() }),
  })
}

export const nextLocalProjectionPublishVersion = (input: Readonly<{ snapshotVersions: readonly unknown[]; workflowKeys: readonly unknown[] }>): number => {
  const versions = [
    ...input.snapshotVersions.filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0),
    ...input.workflowKeys.flatMap((value) => {
      const match = typeof value === 'string' ? /^local-projection:(\d+):/.exec(value) : null
      const version = match === null ? undefined : Number(match[1])
      return version !== undefined && Number.isSafeInteger(version) && version > 0 ? [version] : []
    }),
  ]
  return (versions.length === 0 ? 0 : Math.max(...versions)) + 1
}

const nextPublishVersion = async (payload: PayloadLocalAPI): Promise<number> => {
  const [snapshots, workflows] = await Promise.all([
    payload.find({ collection: 'publication-snapshots', limit: 10_000, depth: 0, overrideAccess: true }),
    payload.find({ collection: 'workflow-runs', limit: 10_000, depth: 0, overrideAccess: true, where: { job_type: { equals: 'project_page' } } }),
  ])
  return nextLocalProjectionPublishVersion({
    snapshotVersions: snapshots.docs.map((snapshot) => snapshot.publish_version),
    workflowKeys: workflows.docs.map((workflow) => workflow.idempotency_key),
  })
}

const activePointer = async (payload: PayloadLocalAPI): Promise<PayloadDocument | undefined> => {
  const result = await payload.find({ collection: 'active-publication-pointers', limit: 1, depth: 0, overrideAccess: true, where: { singleton_key: { equals: 'active-publication' } } })
  return result.docs[0]
}

export const planLocalPointerActivation = (pointer: PayloadDocument | undefined, publishVersion: number) => {
  const current = pointer === undefined
    ? { publish_version: null, previous_verified_version: null, revision: 0 }
    : {
        publish_version: typeof pointer.publish_version === 'number' ? pointer.publish_version : null,
        previous_verified_version: typeof pointer.previous_verified_version === 'number' ? pointer.previous_verified_version : null,
        revision: Number(pointer.revision),
      }
  return Object.freeze({
    ...(pointer === undefined ? { bootstrap: current } : {}),
    expected: current,
    desired: { publish_version: publishVersion, previous_verified_version: current.publish_version, revision: current.revision + 1 },
  })
}

const pointerCommand = (input: Readonly<{
  expected: { publish_version: number | null; previous_verified_version: number | null; revision: number }
  desired: { publish_version: number | null; previous_verified_version: number | null; revision: number }
  publisher: PayloadDocument
  publishService: PayloadDocument
}>) => ({
  singleton_key: 'active-publication', expected_pointer: input.expected, desired_pointer: input.desired,
  reason_code: 'local_internal_projection_publication', correlation_id: createUlid(),
  publisher_principal_id: input.publisher.stable_id, publish_service_id: input.publishService.stable_id,
})

/**
 * Builds four immutable noindex projections, persists a versioned route manifest,
 * then advances the existing dual-authorized active-publication pointer.
 */
export const publishLocalPseoProjections = async (input: LocalProjectionPublishArgs, api?: PayloadLocalAPI): Promise<LocalProjectionPublicationResult> => {
  const payload = api ?? await getPayload({ config: (await import('../src/payload.config')).createPayloadConfig() }) as unknown as PayloadLocalAPI
  try {
    const [artifacts, authorities, currentPointer] = await Promise.all([
      artifactsFromPayload(payload, input.locale), findOrCreatePublisherAuthorities(payload), activePointer(payload),
    ])
    const publishVersion = await nextPublishVersion(payload)
    const projections = buildInternalNoindexProjections({ locale: input.locale, publishVersion, artifacts })
    const projectionVersion = hash(projections.map((projection) => projection.projection_id).join('|'))
    const publicationRequest = createInternalProjectionPublicationRequest({ correlationId: randomUUID(), user: authorities.publishService })
    const persisted: PayloadDocument[] = []
    for (const projection of projections) {
      const workflow = await payload.create({
        collection: 'workflow-runs', overrideAccess: true, req: publicationRequest,
        data: { source_version: projection.dependency_hash, job_type: 'project_page', idempotency_key: `local-projection:${publishVersion}:${projection.projection_id}`, attempt: 0, input_ref: `private/local-internal/input/${projection.projection_id}`, output_ref: null, error_class: null },
      })
      const stored = await payload.create({
        collection: 'page-projections', overrideAccess: true,
        data: {
          projection_id: projection.projection_id, page_id: projection.page_id, locale: projection.locale, family: projection.family,
          state: projection.state, projection: { page: projection.page, navigation: projection.navigation, slots: projection.slots },
          dependency_hash: projection.dependency_hash, content_hash: projection.content_hash, link_hash: projection.link_hash,
          schema_hash: projection.schema_hash, renderer_version: projection.renderer_version,
          validation_report_ref: projection.validation_report_ref, workflow_run: workflow.id,
        },
        req: publicationRequest,
      })
      persisted.push(stored)
      await terminalWorkflow(payload, workflow, `private/local-internal/projections/${projection.projection_id}`)
    }
    for (const binding of buildPublicationProjectionBindings({ publishVersion, projections })) {
      const stored = persisted.find((projection) => projection.projection_id === binding.projection)
      if (stored?.id === undefined) throw new Error('persisted projection id is missing')
      await payload.create({ collection: 'publication-projections', overrideAccess: true, req: publicationRequest, data: { ...binding, projection: stored.id } })
    }
    await payload.create({
      collection: 'publication-snapshots', overrideAccess: true, req: publicationRequest,
      data: {
        source_version: projectionVersion, publish_version: publishVersion,
        route_manifest_ref: `private/local-internal/routes/${publishVersion}`,
        sitemap_manifest_ref: `private/local-internal/sitemap/${publishVersion}`,
        github_manifest_ref: `private/local-internal/github/${publishVersion}`,
        content_tree_hash: projectionVersion,
        previous_verified_version: typeof currentPointer?.publish_version === 'number' ? currentPointer.publish_version : undefined,
        validation_report_ref: `private/local-internal/validation/${publishVersion}`,
      },
    })
    const pointerPlan = planLocalPointerActivation(currentPointer, publishVersion)
    let pointer = currentPointer
    if (pointer === undefined) {
      const bootstrapCommand = pointerCommand({ expected: pointerPlan.bootstrap!, desired: pointerPlan.bootstrap!, ...authorities })
      pointer = await payload.create({
        collection: 'active-publication-pointers', overrideAccess: true,
        req: { user: authorities.publisher, context: { phase1PointerCommand: bootstrapCommand } },
        data: { singleton_key: 'active-publication', ...pointerPlan.bootstrap },
      })
    }
    const command = pointerCommand({ expected: pointerPlan.expected, desired: pointerPlan.desired, ...authorities })
    pointer = await payload.update({
      collection: 'active-publication-pointers', id: pointer.id, overrideAccess: true,
      req: { user: authorities.publisher, context: { phase1PointerCommand: command } }, data: pointerPlan.desired,
    })
    return Object.freeze({ publishVersion, projectionIDs: Object.freeze(projections.map((projection) => projection.projection_id)), routes: Object.freeze(projections.map((projection) => projection.page.route)), pointerRevision: Number(pointer.revision) })
  } finally {
    if (api === undefined) await payload.destroy()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await publishLocalPseoProjections(parseLocalProjectionPublishArgs())
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}
