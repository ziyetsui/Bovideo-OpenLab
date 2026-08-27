import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { getPayload } from 'payload'
import { pathToFileURL } from 'node:url'

import { createUlid } from '../src/access/ulid'
import { createWorkflowRunTransitionRequest } from '../src/collections/canonical-payload-contract'
import { applicationLocaleSchema, type ApplicationLocale } from '../src/contracts/locale'
import { mediaEvidenceSchema, type MediaEvidence } from '../src/contracts/projection'
import { buildInternalNoindexProjections, type ImportedProjectionArtifact, type ImportedProjectionEntity } from '../src/page/local-internal-projector'
import { createInternalProjectionPublicationRequest } from '../src/publication/payload-projection-command'
import { buildPublicationProjectionBindings } from '../src/publication/projection-bindings'

type PayloadDocument = Record<string, unknown>
type PayloadTransactionID = string | number
type PayloadLocalAPI = Readonly<{
  find: (input: Record<string, unknown>) => Promise<Readonly<{ docs: PayloadDocument[]; totalDocs?: number }>>
  findByID: (input: Record<string, unknown>) => Promise<PayloadDocument>
  create: (input: Record<string, unknown>) => Promise<PayloadDocument>
  update: (input: Record<string, unknown>) => Promise<PayloadDocument>
  destroy: () => Promise<void>
  db?: Readonly<{
    pool?: unknown
    beginTransaction?: () => Promise<PayloadTransactionID | null>
    commitTransaction?: (id: PayloadTransactionID) => Promise<void>
    rollbackTransaction?: (id: PayloadTransactionID) => Promise<void>
  }>
}>

export type LocalProjectionPublishArgs = Readonly<{
  locale: ApplicationLocale
  concurrency: number
  promoteXPreviewMedia: boolean
  reviewedMediaManifest: string | undefined
}>
export type LocalProjectionPublicationResult = Readonly<{
  publishVersion: number
  projectionIDs: readonly string[]
  routes: readonly string[]
  pointerRevision: number
  artifactCount: number
  projectionCount: number
  bindingCount: number
  promotedMediaCount: number
  durationMs: number
}>

const hash = (value: string): string => `sha256:v1:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const asRecord = (value: unknown): PayloadDocument => typeof value === 'object' && value !== null ? value as PayloadDocument : {}
const asID = (value: unknown): string | number | undefined => typeof value === 'string' || typeof value === 'number' ? value : undefined
const records = (value: unknown): readonly PayloadDocument[] => Array.isArray(value) ? value.map(asRecord) : []
const relationshipID = (value: unknown): string | number | undefined => {
  const direct = asID(value)
  return direct ?? asID(asRecord(value).id)
}

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
  let concurrency = 8
  let promoteXPreviewMedia = false
  let reviewedMediaManifest: string | undefined
  for (let index = 0; index < argumentsAfterCommand.length; index += 1) {
    const argument = argumentsAfterCommand[index]
    if (argument === '--' && index === 0) continue
    if (argument === '--promote-x-preview-media') {
      promoteXPreviewMedia = true
      continue
    }
    if (argument === '--reviewed-media-manifest') {
      const value = argumentsAfterCommand[index + 1]?.trim()
      if (!value) throw new Error('--reviewed-media-manifest requires a JSONL path')
      reviewedMediaManifest = value
      index += 1
      continue
    }
    if (argument === '--concurrency') {
      const value = Number(argumentsAfterCommand[index + 1])
      if (!Number.isSafeInteger(value) || value < 1 || value > 16) throw new Error('--concurrency requires an integer from 1 to 16')
      concurrency = value
      index += 1
      continue
    }
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
  if (parsedLocale.data !== 'en') throw new Error('local source projection publication supports --locale en only; other locales resolve through the reviewed locale overlay or a translated LocaleVariant')
  if (reviewedMediaManifest !== undefined && !promoteXPreviewMedia)
    throw new Error('--reviewed-media-manifest requires --promote-x-preview-media')
  return Object.freeze({ locale: parsedLocale.data, concurrency, promoteXPreviewMedia, reviewedMediaManifest })
}

const mediaEvidenceFromDocument = (document: PayloadDocument): MediaEvidence | undefined => {
  const sourceRef = relationshipID(document.source_ref)
  if (sourceRef === undefined) return undefined
  const parsed = mediaEvidenceSchema.safeParse({
    media_evidence_id: document.media_evidence_id,
    source_ref: sourceRef,
    provider: document.provider,
    provider_media_id: document.provider_media_id,
    media_type: document.media_type,
    width: document.width ?? null,
    height: document.height ?? null,
    duration_ms: document.duration_ms ?? null,
    remote_url: document.remote_url,
    thumbnail_url: document.thumbnail_url ?? null,
    observed_at: document.observed_at,
    rights_state: document.rights_state,
    sensitive_content_state: document.sensitive_content_state,
    content_hash: document.content_hash,
    visibility: document.visibility,
    delivery_target: document.delivery_target,
    preview_noindex: document.preview_noindex,
    attribution_url: document.attribution_url ?? null,
  })
  return parsed.success ? parsed.data : undefined
}

const eligibleProjectedMedia = (documents: readonly PayloadDocument[]): ReadonlyMap<string, readonly MediaEvidence[]> => {
  const bySource = new Map<string, MediaEvidence[]>()
  for (const document of documents) {
    const media = mediaEvidenceFromDocument(document)
    if (media === undefined || media.sensitive_content_state !== 'allowed' || media.rights_state === 'blocked' || media.rights_state === 'revoked') continue
    if (media.visibility !== 'internal_preview' && media.visibility !== 'public') continue
    const key = String(media.source_ref)
    const group = bySource.get(key) ?? []
    if (!group.some((candidate) => candidate.remote_url === media.remote_url)) group.push(media)
    bySource.set(key, group)
  }
  return new Map([...bySource].map(([key, media]) => [key, Object.freeze(media
    .sort((left, right) => left.provider_media_id.localeCompare(right.provider_media_id, 'en-US'))
    .slice(0, 4))]))
}

export const artifactsFromPayload = async (payload: PayloadLocalAPI, locale: ApplicationLocale): Promise<readonly ImportedProjectionArtifact[]> => {
  const [result, mediaResult] = await Promise.all([
    payload.find({
      collection: 'prompt-artifacts', depth: 1, limit: 10_000, overrideAccess: true,
      where: { kind: { equals: 'prompt' } }, sort: 'id',
    }),
    payload.find({ collection: 'media-evidence', depth: 1, limit: 10_000, overrideAccess: true, sort: 'provider_media_id' }),
  ])
  const mediaBySource = eligibleProjectedMedia(mediaResult.docs)
  const artifacts = result.docs.flatMap((document): ImportedProjectionArtifact[] => {
    const prompt = asRecord(document.prompt)
    const source = asRecord(document.source)
    const stableID = typeof document.stable_id === 'string' ? document.stable_id : undefined
    const sourceID = typeof source.stable_id === 'string' ? source.stable_id : undefined
    const sourceVersion = typeof source.source_version === 'string' ? source.source_version : undefined
    const sourcePayloadID = relationshipID(source)
    const originalText = typeof prompt.original_text === 'string' ? prompt.original_text : ''
    const observedAt = typeof source.captured_at === 'string' ? source.captured_at : undefined
    const title = typeof document.canonical_label === 'string' ? document.canonical_label.trim() : ''
    const explicitMediaType = asRecord(document.outcome).media_type
    if (!stableID || !sourceID || !sourceVersion || !originalText.trim() || !observedAt || !title) return []
    const media = sourcePayloadID === undefined ? [] : mediaBySource.get(String(sourcePayloadID)) ?? []
    const mediaType = explicitMediaType === 'image' || explicitMediaType === 'video'
      ? explicitMediaType
      : media[0]?.media_type ?? 'unresolved'
    return [{
      id: stableID,
      sourceID,
      sourceVersion,
      title,
      text: originalText,
      originalLanguage: typeof document.original_language === 'string' ? document.original_language : 'en',
      mediaType,
      media,
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

const terminalWorkflow = async (
  payload: PayloadLocalAPI,
  run: PayloadDocument,
  outputRef: string,
  publicationCarrier?: Record<string, unknown>,
): Promise<void> => {
  const id = asID(run.id)
  const stableID = typeof run.stable_id === 'string' ? run.stable_id : undefined
  const revision = typeof run.revision === 'number' ? run.revision : undefined
  const status = typeof run.status === 'string' ? run.status : undefined
  if (id === undefined || stableID === undefined || revision === undefined || status === undefined) throw new Error('projection workflow run is malformed')
  const transitionCarrier = createWorkflowRunTransitionRequest({ stable_id: stableID, expected: { status, revision }, status: 'succeeded', reason_code: 'local_projection_published', correlation_id: createUlid() })
  await payload.update({
    collection: 'workflow-runs', id, overrideAccess: true,
    data: { status: 'succeeded', output_ref: outputRef, error_class: null },
    req: publicationCarrier === undefined ? transitionCarrier : {
      ...publicationCarrier,
      ...transitionCarrier,
      context: { ...asRecord(publicationCarrier.context), ...asRecord(transitionCarrier.context) },
    },
  })
}

/** Runs bounded lanes, stops scheduling after the first error, and waits for every
 * active lane before surfacing that error. This prevents background writes from
 * outliving a failed publication call. */
export const mapWithConcurrency = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  worker: (value: Input, index: number) => Promise<Output>,
): Promise<readonly Output[]> => {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency must be an integer from 1 to 16')
  const results: Output[] = new Array(values.length)
  let nextIndex = 0
  let firstError: unknown
  const lane = async (): Promise<void> => {
    while (firstError === undefined) {
      const index = nextIndex
      if (index >= values.length) return
      nextIndex += 1
      try {
        results[index] = await worker(values[index]!, index)
      } catch (error) {
        firstError = error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, lane))
  if (firstError !== undefined) throw firstError
  return Object.freeze(results)
}

const batchesOf = <Value>(values: readonly Value[], size: number): readonly (readonly Value[])[] => {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('batch size must be a positive integer')
  return Object.freeze(Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    Object.freeze(values.slice(index * size, (index + 1) * size))))
}

/** Uses Payload's adapter transaction when available, and remains compatible
 * with injected/local API test doubles that intentionally omit transaction APIs. */
const withPayloadTransaction = async <Result>(
  payload: PayloadLocalAPI,
  work: (transactionID: PayloadTransactionID | undefined) => Promise<Result>,
): Promise<Result> => {
  const database = payload.db
  if (database?.beginTransaction === undefined || database.commitTransaction === undefined || database.rollbackTransaction === undefined)
    return work(undefined)
  // Payload's PostgreSQL adapter methods read adapter state through `this`.
  // Calling through the database object is therefore a correctness requirement.
  const transactionID = await database.beginTransaction()
  if (transactionID === null) return work(undefined)
  try {
    const result = await work(transactionID)
    await database.commitTransaction(transactionID)
    return result
  } catch (error) {
    await database.rollbackTransaction(transactionID)
    throw error
  }
}

const inTransaction = <Carrier extends object>(carrier: Carrier, transactionID: PayloadTransactionID | undefined): Carrier & { transactionID?: PayloadTransactionID } =>
  transactionID === undefined ? carrier : { ...carrier, transactionID }

const isXCDNURL = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'twimg.com' || hostname.endsWith('.twimg.com')
  } catch { return false }
}

/** Reads an explicit review artifact without copying its URLs into logs. Only
 * rows whose provider safety flag is exactly false contribute X CDN URLs. */
export const loadReviewedXMediaAllowlist = async (manifestPath: string): Promise<ReadonlySet<string>> => {
  const urls = new Set<string>()
  const lines = createInterface({ input: createReadStream(manifestPath, { encoding: 'utf8' }), crlfDelay: Infinity })
  let rowCount = 0
  for await (const line of lines) {
    if (!line.trim()) continue
    rowCount += 1
    if (rowCount > 100_000 || Buffer.byteLength(line, 'utf8') > 1024 * 1024) throw new Error('reviewed media manifest exceeds safety limits')
    let value: unknown
    try { value = JSON.parse(line) } catch { throw new Error(`invalid reviewed media manifest JSON at row ${rowCount}`) }
    const row = asRecord(value)
    if (row.possibly_sensitive !== false) continue
    for (const media of records(row.media)) {
      const video = asRecord(media.video)
      for (const candidate of [
        media.thumb_url,
        media.remote_url,
        media.media_url_https,
        video.mp4_low,
        video.mp4_high,
        video.m3u8,
        ...records(video.variants).map((variant) => variant.url),
      ])
        if (isXCDNURL(candidate)) urls.add(candidate)
    }
  }
  if (urls.size === 0) throw new Error('reviewed media manifest contains no explicitly safe X CDN media')
  return urls
}

export const promoteEligibleXPreviewMedia = async (
  payload: PayloadLocalAPI,
  concurrency: number,
  reviewedURLs: ReadonlySet<string> = new Set(),
  requestFactory?: (transactionID?: PayloadTransactionID) => object,
): Promise<number> => {
  const result = await payload.find({ collection: 'media-evidence', depth: 1, limit: 10_000, overrideAccess: true, sort: 'provider_media_id' })
  const candidates = result.docs.flatMap((document) => {
    const source = asRecord(document.source_ref)
    const remoteURL = typeof document.remote_url === 'string' ? document.remote_url : undefined
    const attributionURL = typeof source.canonical_url === 'string' ? source.canonical_url : undefined
    const reviewedUnknown = document.sensitive_content_state === 'unknown' &&
      typeof document.remote_url === 'string' && reviewedURLs.has(document.remote_url) &&
      typeof document.thumbnail_url === 'string' && reviewedURLs.has(document.thumbnail_url)
    if (document.provider !== 'x' || document.visibility !== 'private_evidence' ||
      (document.sensitive_content_state !== 'allowed' && !reviewedUnknown) || document.rights_state === 'blocked' || document.rights_state === 'revoked' ||
      remoteURL === undefined || attributionURL === undefined) return []
    if (!isXCDNURL(remoteURL)) return []
    const id = asID(document.id)
    return id === undefined ? [] : [{ id, attributionURL, reviewedUnknown }]
  })
  await mapWithConcurrency(batchesOf(candidates, 50), concurrency, async (batch) =>
    withPayloadTransaction(payload, async (transactionID) => {
      for (const candidate of batch) await payload.update({
        collection: 'media-evidence', id: candidate.id, overrideAccess: true,
        ...(requestFactory === undefined ? {} : { req: requestFactory(transactionID) }),
        data: {
          ...(candidate.reviewedUnknown ? { sensitive_content_state: 'allowed' } : {}),
          visibility: 'internal_preview', delivery_target: 'x_cdn', preview_noindex: true,
          attribution_url: candidate.attributionURL,
        },
      })
    }))
  return candidates.length
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
 * Builds the complete immutable noindex page graph, persists a versioned route manifest,
 * then advances the existing dual-authorized active-publication pointer.
 */
export const publishLocalPseoProjections = async (input: LocalProjectionPublishArgs, api?: PayloadLocalAPI): Promise<LocalProjectionPublicationResult> => {
  const startedAt = Date.now()
  const payload = api ?? await getPayload({ config: (await import('../src/payload.config')).createPayloadConfig() }) as unknown as PayloadLocalAPI
  try {
    const correlationId = randomUUID()
    const reviewedURLs = input.reviewedMediaManifest === undefined
      ? new Set<string>()
      : await loadReviewedXMediaAllowlist(input.reviewedMediaManifest)
    const [authorities, currentPointer] = await Promise.all([
      findOrCreatePublisherAuthorities(payload), activePointer(payload),
    ])
    const publicationRequest = (transactionID?: PayloadTransactionID) => inTransaction(
      createInternalProjectionPublicationRequest({ correlationId, user: authorities.publishService }),
      transactionID,
    )
    const promotedMediaCount = input.promoteXPreviewMedia
      ? await promoteEligibleXPreviewMedia(payload, input.concurrency, reviewedURLs, publicationRequest)
      : 0
    const artifacts = await artifactsFromPayload(payload, input.locale)
    const publishVersion = await nextPublishVersion(payload)
    const projections = buildInternalNoindexProjections({ locale: input.locale, publishVersion, artifacts })
    const projectionVersion = hash(projections.map((projection) => projection.projection_id).join('|'))
    const persisted = (await mapWithConcurrency(batchesOf(projections, 25), input.concurrency, async (batch) =>
      withPayloadTransaction(payload, async (transactionID): Promise<readonly PayloadDocument[]> => {
        const storedBatch: PayloadDocument[] = []
        for (const projection of batch) {
          const workflow = await payload.create({
            collection: 'workflow-runs', overrideAccess: true, req: publicationRequest(transactionID),
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
            req: publicationRequest(transactionID),
          })
          await terminalWorkflow(payload, workflow, `private/local-internal/projections/${projection.projection_id}`, publicationRequest(transactionID))
          storedBatch.push(stored)
        }
        return Object.freeze(storedBatch)
      }))).flat()
    const bindings = buildPublicationProjectionBindings({ publishVersion, projections })
    await mapWithConcurrency(batchesOf(bindings, 50), input.concurrency, async (batch): Promise<void> =>
      withPayloadTransaction(payload, async (transactionID) => {
        for (const binding of batch) {
          const stored = persisted.find((projection) => projection.projection_id === binding.projection)
          if (stored?.id === undefined) throw new Error('persisted projection id is missing')
          await payload.create({ collection: 'publication-projections', overrideAccess: true, req: publicationRequest(transactionID), data: { ...binding, projection: stored.id } })
        }
      }))
    const pointerPlan = planLocalPointerActivation(currentPointer, publishVersion)
    const pointer = await withPayloadTransaction(payload, async (transactionID) => {
      await payload.create({
        collection: 'publication-snapshots', overrideAccess: true, req: publicationRequest(transactionID),
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
      let releasePointer = currentPointer
      if (releasePointer === undefined) {
        const bootstrapCommand = pointerCommand({ expected: pointerPlan.bootstrap!, desired: pointerPlan.bootstrap!, ...authorities })
        releasePointer = await payload.create({
          collection: 'active-publication-pointers', overrideAccess: true,
          req: inTransaction({ user: authorities.publisher, context: { phase1PointerCommand: bootstrapCommand } }, transactionID),
          data: { singleton_key: 'active-publication', ...pointerPlan.bootstrap },
        })
      }
      const command = pointerCommand({ expected: pointerPlan.expected, desired: pointerPlan.desired, ...authorities })
      return payload.update({
        collection: 'active-publication-pointers', id: releasePointer.id, overrideAccess: true,
        req: inTransaction({ user: authorities.publisher, context: { phase1PointerCommand: command } }, transactionID), data: pointerPlan.desired,
      })
    })
    return Object.freeze({
      publishVersion,
      projectionIDs: Object.freeze(projections.map((projection) => projection.projection_id)),
      routes: Object.freeze(projections.map((projection) => projection.page.route)),
      pointerRevision: Number(pointer.revision),
      artifactCount: artifacts.length,
      projectionCount: projections.length,
      bindingCount: bindings.length,
      promotedMediaCount,
      durationMs: Date.now() - startedAt,
    })
  } finally {
    if (api === undefined) await payload.destroy()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await publishLocalPseoProjections(parseLocalProjectionPublishArgs())
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}
