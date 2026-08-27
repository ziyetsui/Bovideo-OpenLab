import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { eq } from 'drizzle-orm'
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
type PayloadRowLockQuery = Readonly<{
  for: (strength: 'update') => Promise<readonly PayloadDocument[]>
}>
type PayloadRowLockTransaction = Readonly<{
  select: (selection: PayloadDocument) => Readonly<{
    from: (table: PayloadDocument) => Readonly<{
      where: (condition: unknown) => PayloadRowLockQuery
    }>
  }>
}>
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
    sessions?: Readonly<Record<string, Readonly<{ db: PayloadRowLockTransaction }>>>
    tableNameMap?: ReadonlyMap<string, string>
    tables?: Readonly<Record<string, PayloadDocument>>
  }>
}>

export type LocalProjectionPublishArgs = Readonly<{
  locale: ApplicationLocale
  concurrency: number
  promoteXPreviewMedia: boolean
  reviewedMediaManifest: string | undefined
  reviewedTaxonomyManifest?: string | undefined
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
  reviewedTaxonomyNodeCount: number
  linkedTaxonomyArtifactCount: number
  durationMs: number
}>

export type ReviewedTaxonomyAssignment = Readonly<{
  nodeType: 'model' | 'use_case' | 'style'
  stableKey: string
  label: string
  description: string | undefined
  promotionState: 'reviewed' | 'qualified'
  targetSourceVersions: readonly string[]
  expectedArtifactCount: number
}>

export type ReviewedTaxonomyManifest = Readonly<{
  schemaVersion: 1
  reviewID: string
  reviewedAt: string
  evidenceRefs: readonly string[]
  assignments: readonly ReviewedTaxonomyAssignment[]
  sourceHash: string
}>

const hash = (value: string): string => `sha256:v1:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const asRecord = (value: unknown): PayloadDocument => typeof value === 'object' && value !== null ? value as PayloadDocument : {}
const asID = (value: unknown): string | number | undefined => typeof value === 'string' || typeof value === 'number' ? value : undefined
const records = (value: unknown): readonly PayloadDocument[] => Array.isArray(value) ? value.map(asRecord) : []
const relationshipID = (value: unknown): string | number | undefined => {
  const direct = asID(value)
  return direct ?? asID(asRecord(value).id)
}
const relationshipIDs = (value: unknown): readonly (string | number)[] => Array.isArray(value)
  ? value.flatMap((entry) => {
      const id = relationshipID(entry)
      return id === undefined ? [] : [id]
    })
  : []
const stableTaxonomyID = (value: string): string => {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16]!, 16) % 4]!
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
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
  let reviewedTaxonomyManifest: string | undefined
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
    if (argument === '--reviewed-taxonomy-manifest') {
      const value = argumentsAfterCommand[index + 1]?.trim()
      if (!value) throw new Error('--reviewed-taxonomy-manifest requires a JSON path')
      reviewedTaxonomyManifest = value
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
  return Object.freeze({ locale: parsedLocale.data, concurrency, promoteXPreviewMedia, reviewedMediaManifest, reviewedTaxonomyManifest })
}

const reviewedTaxonomyError = (reason: string): Error => new Error(`reviewed taxonomy manifest is invalid: ${reason}`)
const manifestString = (value: unknown, field: string, maximum = 512): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) throw reviewedTaxonomyError(field)
  return value
}
const manifestKeys = (value: PayloadDocument, allowed: readonly string[], required: readonly string[], field: string): void => {
  const keys = Object.keys(value)
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)))
    throw reviewedTaxonomyError(field)
}

/** Parses an explicit operator review artifact. Prompt prose, labels and paths are
 * never used to invent taxonomy during projection generation. */
export const loadReviewedTaxonomyManifest = async (manifestPath: string): Promise<ReviewedTaxonomyManifest> => {
  const bytes = await readFile(manifestPath)
  if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) throw reviewedTaxonomyError('file size')
  let raw: unknown
  try { raw = JSON.parse(bytes.toString('utf8')) } catch { throw reviewedTaxonomyError('JSON') }
  const manifest = asRecord(raw)
  manifestKeys(manifest, ['schema_version', 'review_id', 'reviewed_at', 'evidence_refs', 'assignments'], ['schema_version', 'review_id', 'reviewed_at', 'evidence_refs', 'assignments'], 'top-level fields')
  if (manifest.schema_version !== 1) throw reviewedTaxonomyError('schema_version')
  const reviewID = manifestString(manifest.review_id, 'review_id', 128)
  if (!/^[A-Za-z0-9._:-]+$/.test(reviewID)) throw reviewedTaxonomyError('review_id')
  const reviewedAt = manifestString(manifest.reviewed_at, 'reviewed_at', 64)
  if (new Date(reviewedAt).toISOString() !== reviewedAt) throw reviewedTaxonomyError('reviewed_at')
  if (!Array.isArray(manifest.evidence_refs) || manifest.evidence_refs.length === 0 || manifest.evidence_refs.length > 50)
    throw reviewedTaxonomyError('evidence_refs')
  const evidenceRefs = manifest.evidence_refs.map((value) => manifestString(value, 'evidence_refs', 512))
  if (!Array.isArray(manifest.assignments) || manifest.assignments.length === 0 || manifest.assignments.length > 50)
    throw reviewedTaxonomyError('assignments')
  const seenKeys = new Set<string>()
  const assignments = manifest.assignments.map((value): ReviewedTaxonomyAssignment => {
    const assignment = asRecord(value)
    manifestKeys(assignment, ['node_type', 'stable_key', 'label', 'description', 'promotion_state', 'target_source_versions', 'expected_artifact_count'], ['node_type', 'stable_key', 'label', 'promotion_state', 'target_source_versions', 'expected_artifact_count'], 'assignment fields')
    const nodeType = assignment.node_type
    if (nodeType !== 'model' && nodeType !== 'use_case' && nodeType !== 'style') throw reviewedTaxonomyError('node_type')
    const stableKey = manifestString(assignment.stable_key, 'stable_key', 160)
    if (!new RegExp(`^${nodeType}:[a-z0-9]+(?:-[a-z0-9]+)*$`).test(stableKey) || seenKeys.has(stableKey)) throw reviewedTaxonomyError('stable_key')
    seenKeys.add(stableKey)
    const label = manifestString(assignment.label, 'label', 160).trim()
    const description = assignment.description === undefined ? undefined : manifestString(assignment.description, 'description', 1000).trim()
    const promotionState = assignment.promotion_state
    if (promotionState !== 'reviewed' && promotionState !== 'qualified') throw reviewedTaxonomyError('promotion_state')
    if (!Array.isArray(assignment.target_source_versions) || assignment.target_source_versions.length === 0 || assignment.target_source_versions.length > 100)
      throw reviewedTaxonomyError('target_source_versions')
    const targetSourceVersions = assignment.target_source_versions.map((candidate) => manifestString(candidate, 'target_source_versions', 80))
    if (targetSourceVersions.some((candidate) => !/^sha256:v1:[0-9a-f]{64}$/.test(candidate)) || new Set(targetSourceVersions).size !== targetSourceVersions.length)
      throw reviewedTaxonomyError('target_source_versions')
    const expectedArtifactCount = assignment.expected_artifact_count
    if (!Number.isSafeInteger(expectedArtifactCount) || Number(expectedArtifactCount) < 1 || Number(expectedArtifactCount) > 10_000)
      throw reviewedTaxonomyError('expected_artifact_count')
    return Object.freeze({ nodeType, stableKey, label, description, promotionState, targetSourceVersions: Object.freeze(targetSourceVersions), expectedArtifactCount: Number(expectedArtifactCount) })
  })
  return Object.freeze({
    schemaVersion: 1, reviewID, reviewedAt, evidenceRefs: Object.freeze(evidenceRefs), assignments: Object.freeze(assignments),
    sourceHash: `sha256:v1:${createHash('sha256').update(bytes).digest('hex')}`,
  })
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

/**
 * Payload's public bulk update first resolves matching IDs and then performs an
 * ID-only adapter update, so a revision predicate is not a database CAS. The
 * PostgreSQL adapter session is the actual transaction used by Local API calls.
 * The PromptArtifact collection hook forces relationship-only Local/API writes
 * through the parent row. Match Payload's parent-then-relationships lock order:
 * existing-row deletes/replacements wait on the second lock, while inserts wait
 * because their foreign-key check takes KEY SHARE against the parent FOR UPDATE.
 */
const lockPromptArtifactForUpdate = async (
  payload: PayloadLocalAPI,
  transactionID: PayloadTransactionID | undefined,
  artifactID: string | number,
): Promise<void> => {
  if (transactionID === undefined) return
  const database = payload.db
  const transaction = database?.sessions?.[String(transactionID)]?.db
  const tableName = database?.tableNameMap?.get('prompt_artifacts')
  const relationshipTableName = database?.tableNameMap?.get('prompt_artifacts_rels')
  const table = tableName === undefined ? undefined : database?.tables?.[tableName]
  const relationshipTable = relationshipTableName === undefined ? undefined : database?.tables?.[relationshipTableName]
  if (transaction === undefined || table === undefined || table.id === undefined ||
    relationshipTable === undefined || relationshipTable.id === undefined || relationshipTable.parent === undefined)
    throw new Error('Payload PostgreSQL transaction row-lock primitives are unavailable')
  const rows = await transaction
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id as never, artifactID as never))
    .for('update')
  if (rows.length !== 1) throw new Error(`reviewed taxonomy artifact is missing while locking ${artifactID}`)
  await transaction
    .select({ id: relationshipTable.id })
    .from(relationshipTable)
    .where(eq(relationshipTable.parent as never, artifactID as never))
    .for('update')
}

export const applyReviewedTaxonomyManifest = async (
  payload: PayloadLocalAPI,
  manifest: ReviewedTaxonomyManifest,
  concurrency: number,
  requestFactory?: (transactionID?: PayloadTransactionID) => object,
): Promise<Readonly<{ createdNodeCount: number; updatedNodeCount: number; linkedArtifactCount: number }>> => {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency must be an integer from 1 to 16')
  const reviewCorrelationID = stableTaxonomyID(`reviewed-taxonomy-correlation:${manifest.reviewID}:${manifest.sourceHash}`)
  const eventIDFor = (stableKey: string): string => stableTaxonomyID(`reviewed-taxonomy-event:${manifest.reviewID}:${manifest.sourceHash}:${stableKey}`)
  const artifactWhere = (assignment: ReviewedTaxonomyAssignment) => ({ and: [
    { kind: { equals: 'prompt' } },
    { source_version: { in: assignment.targetSourceVersions } },
  ] })
  const assertedArtifacts = (assignment: ReviewedTaxonomyAssignment, result: Readonly<{ docs: PayloadDocument[]; totalDocs?: number }>): readonly PayloadDocument[] => {
    const actualCount = typeof result.totalDocs === 'number' ? result.totalDocs : result.docs.length
    if (actualCount !== assignment.expectedArtifactCount || result.docs.length !== assignment.expectedArtifactCount)
      throw new Error(`reviewed taxonomy artifact count mismatch for ${assignment.stableKey}: expected ${assignment.expectedArtifactCount}, received ${actualCount}`)
    return result.docs
  }
  const evidenceIDs = (artifacts: readonly PayloadDocument[], stableKey: string): readonly (string | number)[] => Object.freeze([
    ...new Set(artifacts.map((artifact) => relationshipID(artifact.source)).map((id) => {
      if (id === undefined) throw new Error(`reviewed taxonomy source id is missing for ${stableKey}`)
      return id
    })),
  ])
  type AssignmentPlan = {
    assignment: ReviewedTaxonomyAssignment
    artifacts: readonly PayloadDocument[]
    node: PayloadDocument | undefined
    eventExists: boolean
    eventID: string
    finalPromotion: 'reviewed' | 'qualified'
    evidenceRefs: readonly (string | number)[]
    complete: boolean
    wasExisting: boolean
  }
  const plans: AssignmentPlan[] = []
  for (const assignment of manifest.assignments) {
    const eventID = eventIDFor(assignment.stableKey)
    const [nodes, artifactsResult, auditEvents] = await Promise.all([
      payload.find({ collection: 'taxonomy-nodes', depth: 0, limit: 2, overrideAccess: true, where: { stable_key: { equals: assignment.stableKey } } }),
      payload.find({ collection: 'prompt-artifacts', depth: 0, limit: 10_000, overrideAccess: true, where: artifactWhere(assignment), sort: 'id' }),
      payload.find({ collection: 'audit-events', depth: 0, limit: 2, overrideAccess: true, where: { event_id: { equals: eventID } } }),
    ])
    const artifacts = assertedArtifacts(assignment, artifactsResult)
    if (nodes.docs.length > 1) throw new Error(`duplicate taxonomy node ${assignment.stableKey}`)
    const node = nodes.docs[0]
    if (node !== undefined && (node.node_type !== assignment.nodeType || node.label !== assignment.label))
      throw new Error(`conflicting taxonomy node ${assignment.stableKey}`)
    const nodeID = node === undefined ? undefined : asID(node.id)
    if (node !== undefined && nodeID === undefined) throw new Error(`taxonomy node id is missing for ${assignment.stableKey}`)
    const targetEvidence = evidenceIDs(artifacts, assignment.stableKey)
    const finalPromotion = node?.promotion_state === 'qualified' ? 'qualified' : assignment.promotionState
    const relationshipField = assignment.nodeType === 'model' ? 'model_refs' : 'taxonomy_refs'
    const complete = node !== undefined && nodeID !== undefined &&
      node.source_version === manifest.sourceHash && node.status === 'active' &&
      (typeof node.description === 'string' ? node.description : undefined) === assignment.description &&
      node.promotion_state === finalPromotion && Number(node.inventory_count) === assignment.expectedArtifactCount &&
      targetEvidence.every((id) => relationshipIDs(node.evidence_refs).includes(id)) &&
      artifacts.every((artifact) => relationshipIDs(artifact[relationshipField]).includes(nodeID)) &&
      auditEvents.docs.length === 1
    plans.push({ assignment, artifacts, node, eventExists: auditEvents.docs.length === 1, eventID, finalPromotion, evidenceRefs: targetEvidence, complete, wasExisting: node !== undefined })
  }

  const linkedArtifactCount = new Set(plans.flatMap((plan) => plan.artifacts.map((artifact) => String(artifact.id)))).size
  if (plans.every((plan) => plan.complete))
    return Object.freeze({ createdNodeCount: 0, updatedNodeCount: 0, linkedArtifactCount })

  // Every node in this manifest becomes a non-consumable candidate before any
  // relationship batch commits. A failed ingress can therefore never leak a
  // partially linked reviewed Entity into a later publication.
  await withPayloadTransaction(payload, async (transactionID) => {
    for (const plan of plans) {
      const req = requestFactory?.(transactionID)
      if (plan.node === undefined) {
        plan.node = await payload.create({
          collection: 'taxonomy-nodes', overrideAccess: true, ...(req === undefined ? {} : { req }),
          data: {
            stable_id: stableTaxonomyID(`reviewed-taxonomy:${plan.assignment.stableKey}`), schema_version: 1, revision: 1,
            source_version: manifest.sourceHash, status: 'active', node_type: plan.assignment.nodeType, stable_key: plan.assignment.stableKey,
            label: plan.assignment.label, description: plan.assignment.description, promotion_state: 'candidate',
            evidence_refs: plan.evidenceRefs, inventory_count: plan.assignment.expectedArtifactCount,
            audit: { correlation_id: reviewCorrelationID },
          },
        })
      } else {
        plan.node = await payload.update({
          collection: 'taxonomy-nodes', id: plan.node.id, overrideAccess: true, ...(req === undefined ? {} : { req }),
          data: {
            source_version: manifest.sourceHash, status: 'active', description: plan.assignment.description,
            promotion_state: 'candidate', evidence_refs: [...new Set([...relationshipIDs(plan.node.evidence_refs), ...plan.evidenceRefs])],
            inventory_count: plan.assignment.expectedArtifactCount, audit: { correlation_id: reviewCorrelationID },
          },
        })
      }
    }
  })

  type ArtifactTarget = { id: string | number; modelNodeIDs: Set<string | number>; taxonomyNodeIDs: Set<string | number> }
  const targets = new Map<string, ArtifactTarget>()
  for (const plan of plans) {
    const nodeID = asID(plan.node?.id)
    if (nodeID === undefined) throw new Error(`taxonomy node id is missing for ${plan.assignment.stableKey}`)
    for (const artifact of plan.artifacts) {
      const artifactID = asID(artifact.id)
      if (artifactID === undefined) throw new Error(`reviewed taxonomy artifact id is missing for ${plan.assignment.stableKey}`)
      const target = targets.get(String(artifactID)) ?? { id: artifactID, modelNodeIDs: new Set(), taxonomyNodeIDs: new Set() }
      if (plan.assignment.nodeType === 'model') target.modelNodeIDs.add(nodeID)
      else target.taxonomyNodeIDs.add(nodeID)
      targets.set(String(artifactID), target)
    }
  }

  await mapWithConcurrency(batchesOf([...targets.values()], 50), concurrency, async (batch) =>
    withPayloadTransaction(payload, async (transactionID) => {
      for (const target of batch) {
        await lockPromptArtifactForUpdate(payload, transactionID, target.id)
        const readReq = requestFactory?.(transactionID)
        const current = await payload.findByID({ collection: 'prompt-artifacts', id: target.id, depth: 0, overrideAccess: true, ...(readReq === undefined ? {} : { req: readReq }) })
        const modelRefs = new Set(relationshipIDs(current.model_refs))
        const taxonomyRefs = new Set(relationshipIDs(current.taxonomy_refs))
        const before = modelRefs.size + taxonomyRefs.size
        for (const id of target.modelNodeIDs) modelRefs.add(id)
        for (const id of target.taxonomyNodeIDs) taxonomyRefs.add(id)
        if (before === modelRefs.size + taxonomyRefs.size) continue
        const revision = Number(current.revision)
        const updatedAt = typeof current.updatedAt === 'string' ? current.updatedAt : undefined
        if (!Number.isSafeInteger(revision) || revision < 1 || updatedAt === undefined)
          throw new Error(`reviewed taxonomy artifact concurrency metadata is missing for ${target.id}`)
        const updateReq = requestFactory?.(transactionID)
        const updated = await payload.update({
          collection: 'prompt-artifacts', id: target.id, overrideAccess: true, ...(updateReq === undefined ? {} : { req: updateReq }),
          data: {
            model_refs: [...modelRefs], taxonomy_refs: [...taxonomyRefs], revision: revision + 1,
            audit: { correlation_id: reviewCorrelationID },
          },
        })
        if (asID(updated.id) !== target.id) throw new Error(`reviewed taxonomy artifact update failed for ${target.id}`)
      }
    }))

  // Promotion and the immutable review events commit together. Until this
  // transaction succeeds every staged node remains a candidate and is ignored
  // by the projector.
  await withPayloadTransaction(payload, async (transactionID) => {
    for (const plan of plans) {
      const req = requestFactory?.(transactionID)
      const verification = await payload.find({
        collection: 'prompt-artifacts', depth: 0, limit: 10_000, overrideAccess: true,
        where: artifactWhere(plan.assignment), sort: 'id', ...(req === undefined ? {} : { req }),
      })
      const verifiedArtifacts = assertedArtifacts(plan.assignment, verification)
      const nodeID = asID(plan.node?.id)
      if (nodeID === undefined) throw new Error(`taxonomy node id is missing for ${plan.assignment.stableKey}`)
      const relationshipField = plan.assignment.nodeType === 'model' ? 'model_refs' : 'taxonomy_refs'
      if (!verifiedArtifacts.every((artifact) => relationshipIDs(artifact[relationshipField]).includes(nodeID)))
        throw new Error(`reviewed taxonomy relationship verification failed for ${plan.assignment.stableKey}`)
      const currentNode = await payload.findByID({ collection: 'taxonomy-nodes', id: nodeID, depth: 0, overrideAccess: true, ...(req === undefined ? {} : { req }) })
      plan.node = await payload.update({
        collection: 'taxonomy-nodes', id: nodeID, overrideAccess: true, ...(requestFactory === undefined ? {} : { req: requestFactory(transactionID) }),
        data: {
          source_version: manifest.sourceHash, status: 'active', description: plan.assignment.description,
          promotion_state: plan.finalPromotion,
          evidence_refs: [...new Set([...relationshipIDs(currentNode.evidence_refs), ...evidenceIDs(verifiedArtifacts, plan.assignment.stableKey)])],
          inventory_count: plan.assignment.expectedArtifactCount, audit: { correlation_id: reviewCorrelationID },
        },
      })
      if (!plan.eventExists) {
        const auditRequest = requestFactory?.(transactionID)
        const user = asRecord(asRecord(auditRequest).user)
        const actorStableID = typeof user.stable_id === 'string' ? user.stable_id : 'taxonomy-review-service'
        await payload.create({
          collection: 'audit-events', overrideAccess: true, ...(auditRequest === undefined ? {} : { req: auditRequest }),
          data: {
            event_id: plan.eventID, stable_id: plan.eventID, schema_version: 1, revision: 1,
            source_version: manifest.sourceHash, status: 'recorded', actor_user: null, actor_type: 'service',
            actor_stable_id: actorStableID, actor_service: actorStableID, correlation_id: reviewCorrelationID,
            causation_id: null, event_type: 'taxonomy.review.accepted', entity_type: 'taxonomy-nodes',
            entity_stable_id: plan.node.stable_id, outcome: 'allowed', prior_state: null,
            new_state: {
              review_id: manifest.reviewID, reviewed_at: manifest.reviewedAt, evidence_refs: manifest.evidenceRefs,
              manifest_hash: manifest.sourceHash, stable_key: plan.assignment.stableKey,
              promotion_state: plan.finalPromotion, expected_artifact_count: plan.assignment.expectedArtifactCount,
            },
            reason_code: 'reviewed_taxonomy_manifest', occurred_at: manifest.reviewedAt,
          },
        })
      }
    }
  })
  return Object.freeze({
    createdNodeCount: plans.filter((plan) => !plan.wasExisting).length,
    updatedNodeCount: plans.filter((plan) => plan.wasExisting).length,
    linkedArtifactCount,
  })
}

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
    const reviewedTaxonomy = input.reviewedTaxonomyManifest === undefined
      ? undefined
      : await loadReviewedTaxonomyManifest(input.reviewedTaxonomyManifest)
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
    const taxonomyResult = reviewedTaxonomy === undefined
      ? { createdNodeCount: 0, updatedNodeCount: 0, linkedArtifactCount: 0 }
      : await applyReviewedTaxonomyManifest(payload, reviewedTaxonomy, input.concurrency, publicationRequest)
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
      reviewedTaxonomyNodeCount: taxonomyResult.createdNodeCount + taxonomyResult.updatedNodeCount,
      linkedTaxonomyArtifactCount: taxonomyResult.linkedArtifactCount,
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
