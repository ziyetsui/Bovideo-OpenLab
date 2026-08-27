import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, lstat, readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { principals } from '@/access/principals'
import { createWorkflowRunTransitionRequest } from '@/collections/canonical-payload-contract'
import { createObjectAuthority, createObjectIngressCommand, withObjectAuthority } from '@/storage/payload-object-authority'
import { LocalObjectStore } from '@/storage/local-object-store'
import type { ObjectRef } from '@/storage/object-ref'

type SnapshotDocument = Record<string, unknown> & { id: number | string }

/** The small Payload surface needed by the streaming importer. */
export type SnapshotImportPayload = Readonly<{
  find: (input: { collection: string; where?: unknown; limit?: number; overrideAccess?: boolean }) => Promise<{ docs: SnapshotDocument[] }>
  create: (input: { collection: string; data: Record<string, unknown>; overrideAccess?: boolean; req?: unknown }) => Promise<SnapshotDocument>
  update: (input: { collection: string; id: number | string; data: Record<string, unknown>; overrideAccess?: boolean; req?: unknown }) => Promise<SnapshotDocument>
}>

export type SnapshotImportResult = Readonly<{
  manifestHash: string
  /** Private content-addressed index retaining every file from this snapshot. */
  snapshotEvidenceRef: ObjectRef | null
  created: Readonly<{ sources: number; artifacts: number; mediaEvidence: number }>
  skipped: Readonly<{ sources: number; artifacts: number; mediaEvidence: number }>
  dryRun: boolean
}>

/** The caller must recover the created run when both terminal CAS attempts fail. */
export class SnapshotImportTerminalizationError extends Error {
  readonly importError: unknown
  readonly terminalizationError: unknown

  constructor(importError: unknown, terminalizationError: unknown) {
    super('snapshot import failed and durable workflow terminalization failed')
    this.name = 'SnapshotImportTerminalizationError'
    this.importError = importError
    this.terminalizationError = terminalizationError
  }
}

/** The importer has no lease receipt and must not terminalize another worker's active run. */
export class SnapshotImportLeaseConflictError extends Error {
  readonly code = 'snapshot_import_workflow_lease_conflict' as const

  constructor() {
    super('snapshot import terminalization encountered an active workflow lease')
    this.name = 'SnapshotImportLeaseConflictError'
  }
}

type ImportInput = Readonly<{
  snapshotDir: string
  payload?: SnapshotImportPayload
  correlationId: string
  dryRun?: boolean
  /** Optional durable private store used by real Payload source writes. */
  rawEvidenceStore?: LocalObjectStore
}>

type NormalizedPost = Readonly<{
  tweet_id: string
  created_at: string
  url: string
  language: string
  text: string
  prompt_text: string | null
  author_handle: string | null
}>

type MediaReference = Readonly<{
  tweet_id: string
  provider_media_id: string
  media_type: 'image' | 'video'
  width: number | null
  height: number | null
  duration_ms: number | null
  remote_url: string
  thumbnail_url: string | null
  observed_at: string
  sensitive_content_state: 'unknown' | 'allowed' | 'restricted' | 'blocked'
}>

const NORMALIZED_POST_FIELDS = new Set([
  'run_id', 'tweet_id', 'conversation_id', 'created_at', 'author_id', 'author_name', 'author_handle',
  'author_followers', 'url', 'language', 'text', 'prompt_text', 'prompt_location', 'likes', 'comments',
  'bookmarks', 'reposts', 'quotes', 'views', 'metrics_observed_at', 'query_hits', 'raw_ref',
  'missing_reasons', 'is_higgsfield_relevant', 'has_prompt_payload', 'topic_like_percentile',
  'topic_bookmark_percentile', 'topic_comment_percentile', 'creator_like_median', 'creator_lift',
  'creator_lift_percentile', 'save_like_ratio', 'save_rate', 'value_score', 'high_like_status',
  'high_value_status', 'absolute_scale_tag', 'rejection_reason',
])

const sha256 = (value: string | Uint8Array): string => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`
const hashFile = async (filename: string): Promise<string> => await new Promise((resolve, reject) => {
  const digest = createHash('sha256')
  const stream = createReadStream(filename)
  stream.on('data', (chunk: string | Uint8Array) => { digest.update(chunk) })
  stream.once('error', reject)
  stream.once('end', () => resolve(`sha256:v1:${digest.digest('hex')}`))
})
const stableID = (seed: string): string => {
  const value = createHash('sha256').update(seed).digest('hex')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`
}
/** X status identifiers are provider-neutral semantic facts. */
export const semanticKeyForXStatus = (tweetID: string): string => `x-status:${tweetID}`
const asRecord = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
const nonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`invalid snapshot ${field}`)
  return value
}
const nullableString = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null
const isoTimestamp = (value: unknown, field: string): string => {
  const source = nonEmptyString(value, field)
  const date = new Date(source)
  if (Number.isNaN(date.valueOf())) throw new Error(`invalid snapshot ${field}`)
  return date.toISOString()
}
const nullablePositiveInteger = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`invalid snapshot ${field}`)
  return value as number
}
const nullableNonnegativeInteger = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`invalid snapshot ${field}`)
  return value as number
}
const validURL = (value: unknown, field: string): string => {
  const url = nonEmptyString(value, field)
  try { new URL(url) } catch { throw new Error(`invalid snapshot ${field}`) }
  return url
}
const canonicalRawRef = (contentHash: string, sizeBytes = 0, mimeType = 'application/json'): ObjectRef => ({
  namespace: 'raw-evidence', bucket_class: 'private_raw',
  key: `sha256/${contentHash.slice(10, 12)}/${contentHash.slice(10)}`,
  content_hash: contentHash, version: 'v1', size_bytes: sizeBytes, mime_type: mimeType,
  rights_state: 'metadata_only', deletion_state: 'active',
})

const normalizedPost = (value: unknown): NormalizedPost => {
  const row = asRecord(value)
  if (Object.keys(row).some((field) => !NORMALIZED_POST_FIELDS.has(field))) throw new Error('invalid snapshot normalized post field')
  return {
    tweet_id: nonEmptyString(row.tweet_id, 'tweet_id'),
    created_at: isoTimestamp(row.created_at, 'created_at'),
    url: validURL(row.url, 'url'),
    language: typeof row.language === 'string' && row.language.trim() ? row.language.trim() : 'und',
    text: nonEmptyString(row.text, 'text'),
    prompt_text: nullableString(row.prompt_text),
    author_handle: nullableString(row.author_handle),
  }
}

const fixtureMediaReference = (value: unknown): MediaReference => {
  const row = asRecord(value)
  const state = row.sensitive_content_state ?? 'unknown'
  if (!['unknown', 'allowed', 'restricted', 'blocked'].includes(String(state))) throw new Error('invalid snapshot sensitive_content_state')
  return {
    tweet_id: nonEmptyString(row.tweet_id, 'media tweet_id'),
    provider_media_id: nonEmptyString(row.provider_media_id, 'provider_media_id'),
    media_type: row.media_type === 'image' || row.media_type === 'video' ? row.media_type : (() => { throw new Error('invalid snapshot media_type') })(),
    width: nullablePositiveInteger(row.width, 'media width'),
    height: nullablePositiveInteger(row.height, 'media height'),
    duration_ms: nullableNonnegativeInteger(row.duration_ms, 'media duration_ms'),
    remote_url: validURL(row.remote_url, 'media remote_url'),
    thumbnail_url: row.thumbnail_url === null || row.thumbnail_url === undefined ? null : validURL(row.thumbnail_url, 'media thumbnail_url'),
    observed_at: isoTimestamp(row.observed_at, 'media observed_at'),
    sensitive_content_state: state as MediaReference['sensitive_content_state'],
  }
}

const mediaFromTwitter241RawPost = (value: unknown): readonly MediaReference[] => {
  const row = asRecord(value)
  const tweetID = nonEmptyString(row.tweet_id, 'raw tweet_id')
  const raw = asRecord(row.raw)
  const legacy = asRecord(raw.legacy)
  const entities = asRecord(legacy.extended_entities)
  const observed = isoTimestamp(legacy.created_at, 'raw created_at')
  const items = Array.isArray(entities.media) ? entities.media : []
  return items.map((item) => {
    const media = asRecord(item)
    const type = media.type === 'video' || media.type === 'animated_gif' ? 'video' : media.type === 'photo' ? 'image' : undefined
    if (!type) throw new Error('invalid raw media type')
    const original = asRecord(media.original_info)
    const videoInfo = asRecord(media.video_info)
    const variants = Array.isArray(videoInfo.variants) ? videoInfo.variants.map(asRecord) : []
    const bestVideo = variants
      .filter((variant) => variant.content_type === 'video/mp4' && typeof variant.url === 'string')
      .sort((left, right) => Number(right.bitrate ?? 0) - Number(left.bitrate ?? 0))[0]
    const remoteURL = type === 'video' && bestVideo ? bestVideo.url : media.media_url_https
    return fixtureMediaReference({
      tweet_id: tweetID,
      provider_media_id: media.id_str ?? media.media_key,
      media_type: type,
      width: original.width ?? null,
      height: original.height ?? null,
      duration_ms: type === 'video' ? videoInfo.duration_millis ?? null : null,
      remote_url: remoteURL,
      thumbnail_url: type === 'video' ? media.media_url_https ?? null : null,
      observed_at: observed,
      sensitive_content_state: legacy.possibly_sensitive === true ? 'restricted' : 'unknown',
    })
  })
}

const legacyPublicSearchPost = (value: unknown): NormalizedPost => {
  const row = asRecord(value)
  return {
    tweet_id: nonEmptyString(row.tweet_id, 'legacy tweet_id'),
    created_at: isoTimestamp(row.created_at, 'legacy created_at'),
    url: validURL(row.url, 'legacy url'),
    language: typeof row.language === 'string' && row.language.trim() ? row.language.trim() : 'und',
    text: nonEmptyString(row.text, 'legacy text'),
    prompt_text: nullableString(row.prompt_text),
    author_handle: nullableString(row.author_handle),
  }
}

const mediaFromLegacyPublicSearchRawPost = (value: unknown): readonly MediaReference[] => {
  const row = asRecord(value)
  const tweetID = nonEmptyString(row.tweet_id, 'legacy raw tweet_id')
  const syndication = asRecord(row.syndication)
  const observed = isoTimestamp(syndication.created_at, 'legacy raw created_at')
  const items = Array.isArray(syndication.mediaDetails) ? syndication.mediaDetails : []
  return items.map((item, index) => {
    const media = asRecord(item)
    const type = media.type === 'video' || media.type === 'animated_gif' ? 'video' : media.type === 'photo' ? 'image' : undefined
    if (!type) throw new Error('invalid legacy raw media type')
    const original = asRecord(media.original_info)
    const videoInfo = asRecord(media.video_info)
    const variants = Array.isArray(videoInfo.variants) ? videoInfo.variants.map(asRecord) : []
    const bestVideo = variants
      .filter((variant) => variant.content_type === 'video/mp4' && typeof variant.url === 'string')
      .sort((left, right) => Number(right.bitrate ?? 0) - Number(left.bitrate ?? 0))[0]
    const remoteURL = type === 'video' && bestVideo ? bestVideo.url : media.media_url_https
    return fixtureMediaReference({
      tweet_id: tweetID,
      provider_media_id: `legacy-public-search:${tweetID}:${index}`,
      media_type: type,
      width: original.width ?? null,
      height: original.height ?? null,
      duration_ms: type === 'video' ? videoInfo.duration_millis ?? null : null,
      remote_url: remoteURL,
      thumbnail_url: type === 'video' ? media.media_url_https ?? null : null,
      observed_at: observed,
      sensitive_content_state: syndication.possibly_sensitive === true ? 'restricted' : 'unknown',
    })
  })
}

const MAX_SNAPSHOT_RECORD_BYTES = 1024 * 1024

/** Repairs CR/LF only in the compact normalized export's top-level `text` value. */
const parseSnapshotRecord = (raw: Uint8Array, bodyLength: number, allowLegacyTextControls: boolean): unknown => {
  let inString = false
  let escaped = false
  let depth = 0
  let rootExpectingKey = false
  let readingRootKey = false
  let awaitingRootKeyColon = false
  let rootTextValueExpected = false
  let repairingTextValue = false
  let rootKeyBytes: number[] = []
  const repaired: number[] = []
  for (let index = 0; index < bodyLength; index += 1) {
    const byte = raw[index]!
    if (inString && !escaped && byte < 0x20) {
      if (!allowLegacyTextControls || !repairingTextValue || (byte !== 0x0a && byte !== 0x0d)) throw new Error('invalid JSONL control character')
      repaired.push(0x5c, byte === 0x0a ? 0x6e : 0x72)
      continue
    }
    repaired.push(byte)
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (byte === 0x5c) { escaped = true; continue }
      if (byte === 0x22) {
        inString = false
        if (readingRootKey) {
          rootExpectingKey = false
          awaitingRootKeyColon = true
          readingRootKey = false
        }
        repairingTextValue = false
      } else if (readingRootKey) {
        rootKeyBytes.push(byte)
      }
      continue
    }
    if (byte === 0x7b || byte === 0x5b) {
      depth += 1
      if (depth === 1 && byte === 0x7b) rootExpectingKey = true
      continue
    }
    if (byte === 0x7d || byte === 0x5d) { depth -= 1; continue }
    if (byte === 0x2c && depth === 1) {
      rootExpectingKey = true
      awaitingRootKeyColon = false
      rootTextValueExpected = false
      continue
    }
    if (byte === 0x3a && depth === 1 && awaitingRootKeyColon) {
      const rootKey = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(rootKeyBytes))
      rootTextValueExpected = rootKey === 'text'
      awaitingRootKeyColon = false
      continue
    }
    if (byte === 0x22) {
      inString = true
      escaped = false
      readingRootKey = depth === 1 && rootExpectingKey
      if (readingRootKey) rootKeyBytes = []
      repairingTextValue = depth === 1 && rootTextValueExpected
      rootTextValueExpected = false
    }
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(repaired))) } catch { throw new Error('invalid JSONL record') }
}

/**
 * Bounded byte reader for JSONL.  It permits the observed CR/LF-in-string
 * legacy defect, but rejects control bytes elsewhere and pretty-printed JSON.
 * `raw` includes the physical LF or CRLF delimiter for exact evidence hashing.
 */
async function* readJsonLines(filename: string, allowLegacyTextControls = false): AsyncGenerator<{ value: unknown; raw: Uint8Array }> {
  let record: number[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let pendingCarriageReturn = false
  for await (const chunk of createReadStream(filename)) {
    for (const byte of chunk) {
      if (pendingCarriageReturn) {
        if (byte !== 0x0a) throw new Error('invalid JSONL record delimiter')
        record.push(byte)
        if (depth !== 0 || inString) throw new Error('invalid JSONL record')
        const raw = Uint8Array.from(record)
        yield { value: parseSnapshotRecord(raw, raw.byteLength - 2, allowLegacyTextControls), raw }
        record = []; depth = 0; pendingCarriageReturn = false
        continue
      }
      if (record.length === 0) {
        if (byte === 0x0a) continue
        if (byte !== 0x7b) throw new Error('invalid JSONL record start')
        depth = 1
        record.push(byte)
        continue
      }
      record.push(byte)
      if (record.length > MAX_SNAPSHOT_RECORD_BYTES) throw new Error('snapshot record exceeds maximum size')
      if (inString) {
        if (escaped) escaped = false
        else if (byte === 0x5c) escaped = true
        else if (byte === 0x22) inString = false
        else if (byte < 0x20 && byte !== 0x0a && byte !== 0x0d) throw new Error('invalid JSONL control character')
        continue
      }
      if (byte === 0x22) { inString = true; continue }
      if (byte === 0x7b || byte === 0x5b) { depth += 1; continue }
      if (byte === 0x7d || byte === 0x5d) {
        depth -= 1
        if (depth < 0) throw new Error('invalid JSONL nesting')
        continue
      }
      if (byte === 0x0d) { pendingCarriageReturn = true; continue }
      if (byte === 0x0a) {
        if (depth !== 0) throw new Error('invalid JSONL record')
        const raw = Uint8Array.from(record)
        yield { value: parseSnapshotRecord(raw, raw.byteLength - 1, allowLegacyTextControls), raw }
        record = []; depth = 0
        continue
      }
      if (byte < 0x20) throw new Error('invalid JSONL control character')
    }
  }
  if (pendingCarriageReturn) throw new Error('invalid JSONL record')
  if (record.length > 0) {
    if (depth !== 0 || inString) throw new Error('invalid JSONL record')
    const raw = Uint8Array.from(record)
    yield { value: parseSnapshotRecord(raw, raw.byteLength, allowLegacyTextControls), raw }
  }
}

const findOne = async (payload: SnapshotImportPayload, collection: string, clauses: Record<string, unknown>): Promise<SnapshotDocument | undefined> => {
  const result = await payload.find({ collection, where: { and: Object.entries(clauses).map(([field, value]) => ({ [field]: { equals: value } })) }, limit: 1, overrideAccess: true })
  return result.docs[0]
}

type VerifiedSnapshot = Readonly<{ manifestHash: string; filenames: readonly string[] }>

const listSnapshotFiles = async (snapshotDir: string): Promise<readonly string[]> => {
  const entries = await readdir(snapshotDir, { withFileTypes: true })
  const names: string[] = []
  for (const entry of entries) {
    if (entry.name.includes('/') || entry.name.includes('\\')) throw new Error('invalid snapshot filename')
    const filename = join(snapshotDir, entry.name)
    const stat = await lstat(filename)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`snapshot contains a non-file entry ${entry.name}`)
    names.push(entry.name)
  }
  if (!names.includes('manifest.json')) throw new Error('snapshot manifest is missing')
  return Object.freeze(names.sort())
}

const manifestHashAndVerification = async (snapshotDir: string, requiredInputs: readonly string[], filenames: readonly string[], allowObservedInputFingerprint = false): Promise<VerifiedSnapshot> => {
  const filename = join(snapshotDir, 'manifest.json')
  const bytes = await readFile(filename)
  const manifest = asRecord(JSON.parse(bytes.toString('utf8')))
  const hashes = asRecord(manifest.output_sha256)
  if (Object.keys(hashes).length === 0) {
    if (!allowObservedInputFingerprint) throw new Error('snapshot manifest has no output hashes')
    const observedInputs = await Promise.all(filenames.map(async (relativePath) => Object.freeze({ relativePath, hash: await hashFile(join(snapshotDir, relativePath)) })))
    return Object.freeze({ manifestHash: sha256(JSON.stringify({ manifest: sha256(bytes), observed_inputs: observedInputs })), filenames })
  }
  for (const requiredInput of requiredInputs) {
    if (typeof hashes[requiredInput] !== 'string') throw new Error(`manifest missing required input ${requiredInput}`)
  }
  for (const [relativePath, expected] of Object.entries(hashes)) {
    if (relativePath.includes('/') || relativePath.includes('\\') || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error('invalid snapshot manifest output hash')
    const actual = await hashFile(join(snapshotDir, relativePath))
    if (actual !== `sha256:v1:${expected}`) throw new Error(`manifest hash mismatch for ${relativePath}`)
  }
  const declared = Object.keys(hashes).sort()
  const actual = filenames.filter((name) => name !== 'manifest.json')
  if (declared.length !== actual.length || declared.some((name, index) => name !== actual[index]))
    throw new Error('snapshot manifest does not list every snapshot input')
  return Object.freeze({ manifestHash: sha256(bytes), filenames })
}

const SNAPSHOT_EVIDENCE_CHUNK_BYTES = 8 * 1024 * 1024
// The restricted raw-evidence namespace intentionally accepts only a small
// MIME allowlist. CSV and Markdown remain opaque evidence bytes, represented
// as text/plain rather than widening that storage policy.
const rawEvidenceMimeType = (filename: string): string => filename.endsWith('.json') || filename.endsWith('.jsonl') ? 'application/json' : 'text/plain'
const rawEvidenceURI = (ref: ObjectRef): string => `raw-evidence://${ref.key}`

type SnapshotEvidenceFile = Readonly<{
  filename: string
  content_hash: string
  size_bytes: number
  chunks: readonly ObjectRef[]
}>

/**
 * Stores every regular file in a verified snapshot as immutable private raw
 * evidence. Files larger than the ObjectRef limit are chunked; the index is
 * the durable reconstruction map and is what the workflow run references.
 */
const persistSnapshotEvidence = async (input: Readonly<{ snapshotDir: string; filenames: readonly string[]; manifestHash: string; store: LocalObjectStore }>): Promise<ObjectRef> => {
  const files: SnapshotEvidenceFile[] = []
  for (const filename of input.filenames) {
    const chunks: ObjectRef[] = []
    const digest = createHash('sha256')
    let sizeBytes = 0
    for await (const chunk of createReadStream(join(input.snapshotDir, filename), { highWaterMark: SNAPSHOT_EVIDENCE_CHUNK_BYTES })) {
      const bytes = new Uint8Array(chunk)
      const chunkHash = sha256(bytes)
      const ref = canonicalRawRef(chunkHash, bytes.byteLength, rawEvidenceMimeType(filename))
      await input.store.write({ principal: principals.ingestService, ref, bytes })
      chunks.push(ref)
      digest.update(bytes)
      sizeBytes += bytes.byteLength
    }
    files.push(Object.freeze({ filename, content_hash: `sha256:v1:${digest.digest('hex')}`, size_bytes: sizeBytes, chunks: Object.freeze(chunks) }))
  }
  const indexBytes = Buffer.from(JSON.stringify({ format_version: 1, manifest_hash: input.manifestHash, files }), 'utf8')
  const indexRef = canonicalRawRef(sha256(indexBytes), indexBytes.byteLength, 'application/json')
  await input.store.write({ principal: principals.ingestService, ref: indexRef, bytes: indexBytes })
  return indexRef
}

const requiredFile = async (snapshotDir: string, filename: string): Promise<string> => {
  const path = join(snapshotDir, filename)
  await access(path)
  return path
}

type SnapshotLayout = Readonly<{
  normalizedPath: string
  mediaInput: Readonly<{ filename: 'media_refs.jsonl' | 'raw_posts.jsonl' | 'raw_hydration.jsonl'; path: string; kind: 'fixture' | 'twitter241' | 'legacy_public_search' }>
  normalize: (value: unknown) => NormalizedPost
  allowLegacyTextControls: boolean
  provider: 'twitter241' | 'x_public_search'
}>

const selectedTwitter241MediaInput = async (snapshotDir: string): Promise<SnapshotLayout['mediaInput']> => {
  const fixturePath = join(snapshotDir, 'media_refs.jsonl')
  try {
    await access(fixturePath)
    return { filename: 'media_refs.jsonl', path: fixturePath, kind: 'fixture' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { filename: 'raw_posts.jsonl', path: await requiredFile(snapshotDir, 'raw_posts.jsonl'), kind: 'twitter241' }
  }
}

const selectSnapshotLayout = async (snapshotDir: string): Promise<SnapshotLayout> => {
  try {
    return Object.freeze({
      normalizedPath: await requiredFile(snapshotDir, 'normalized_posts.jsonl'),
      mediaInput: await selectedTwitter241MediaInput(snapshotDir),
      normalize: normalizedPost,
      allowLegacyTextControls: true,
      provider: 'twitter241',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return Object.freeze({
      normalizedPath: await requiredFile(snapshotDir, 'records.jsonl'),
      mediaInput: Object.freeze({ filename: 'raw_hydration.jsonl', path: await requiredFile(snapshotDir, 'raw_hydration.jsonl'), kind: 'legacy_public_search' }),
      normalize: legacyPublicSearchPost,
      allowLegacyTextControls: false,
      provider: 'x_public_search',
    })
  }
}

const importResultRef = (manifestHash: string): string => `private/import-results/${manifestHash.slice('sha256:v1:'.length)}`

const terminalImportRun = async (
  payload: SnapshotImportPayload,
  run: SnapshotDocument,
  status: 'succeeded' | 'failed',
  manifestHash: string,
): Promise<void> => {
  let candidate = run
  let terminalizationError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (candidate.status === status) return
    const expectedStatus = typeof candidate.status === 'string' ? candidate.status : 'queued'
    const expectedRevision = typeof candidate.revision === 'number' && Number.isInteger(candidate.revision) ? candidate.revision : 1
    const stableID = typeof candidate.stable_id === 'string' ? candidate.stable_id : globalThis.crypto.randomUUID()
    try {
      await payload.update({
        collection: 'workflow-runs', id: candidate.id, overrideAccess: true,
        data: status === 'succeeded'
          ? { status, output_ref: importResultRef(manifestHash), error_class: null }
          : { status, output_ref: null, error_class: 'import_failed' },
        req: createWorkflowRunTransitionRequest({
          stable_id: stableID, expected: { status: expectedStatus, revision: expectedRevision }, status,
          reason_code: status === 'succeeded' ? 'snapshot_import_succeeded' : 'snapshot_import_failed', correlation_id: globalThis.crypto.randomUUID(),
        }),
      })
      return
    } catch (error) {
      terminalizationError = error
      const persisted = await findOne(payload, 'workflow-runs', { id: run.id })
      if (persisted?.status === status) return
      if (persisted === undefined || persisted.status !== 'queued') {
        if (persisted?.status === 'running') throw new SnapshotImportLeaseConflictError()
        throw error
      }
      candidate = persisted
    }
  }
  throw terminalizationError
}

async function* readMediaReferences(input: SnapshotLayout['mediaInput']): AsyncGenerator<MediaReference> {
  for await (const row of readJsonLines(input.path)) {
    if (input.kind === 'fixture') yield fixtureMediaReference(row.value)
    else if (input.kind === 'twitter241') for (const media of mediaFromTwitter241RawPost(row.value)) yield media
    else for (const media of mediaFromLegacyPublicSearchRawPost(row.value)) yield media
  }
}

/**
 * Imports a verified local snapshot without copying its private source or media
 * bytes into the worktree.  A dry run fully hashes and parses the snapshot but
 * deliberately makes no Payload calls.
 */
export const importHiggsfieldSnapshot = async (input: ImportInput): Promise<SnapshotImportResult> => {
  if (!input.snapshotDir.trim()) throw new Error('snapshotDir is required')
  if (!input.correlationId.trim()) throw new Error('correlationId is required')
  if (!input.dryRun && !input.rawEvidenceStore) throw new Error('rawEvidenceStore is required unless dryRun is true')
  if (!input.dryRun && !input.payload) throw new Error('payload is required unless dryRun is true')

  const layout = await selectSnapshotLayout(input.snapshotDir)
  const snapshotFiles = await listSnapshotFiles(input.snapshotDir)
  const verifiedSnapshot = await manifestHashAndVerification(
    input.snapshotDir,
    [basename(layout.normalizedPath), layout.mediaInput.filename],
    snapshotFiles,
    layout.provider === 'x_public_search',
  )
  const manifestHash = verifiedSnapshot.manifestHash
  const sourcesByTweet = new Map<string, SnapshotDocument>()
  const created = { sources: 0, artifacts: 0, mediaEvidence: 0 }
  const skipped = { sources: 0, artifacts: 0, mediaEvidence: 0 }

  // Fully validate the two verified streams before the workflow ledger or any
  // Payload row can be created. Only compact source identities are retained.
  const normalizedTweetIDs = new Set<string>()
  for await (const row of readJsonLines(layout.normalizedPath, layout.allowLegacyTextControls)) {
    const post = layout.normalize(row.value)
    if (normalizedTweetIDs.has(post.tweet_id)) throw new Error(`duplicate normalized source ${post.tweet_id}`)
    normalizedTweetIDs.add(post.tweet_id)
  }
  for await (const media of readMediaReferences(layout.mediaInput)) {
    if (!normalizedTweetIDs.has(media.tweet_id)) throw new Error(`orphan media reference ${media.tweet_id}`)
  }

  if (input.dryRun) return Object.freeze({ manifestHash, snapshotEvidenceRef: null, created: Object.freeze(created), skipped: Object.freeze(skipped), dryRun: true })

  const rawAuthority = createObjectAuthority(input.rawEvidenceStore!)
  const snapshotEvidenceRef = await persistSnapshotEvidence({
    snapshotDir: input.snapshotDir, filenames: verifiedSnapshot.filenames, manifestHash, store: input.rawEvidenceStore!,
  })
  let workflowRun: SnapshotDocument | undefined
  {
    const payload = input.payload!
    workflowRun = await findOne(payload, 'workflow-runs', { job_type: 'ingest', idempotency_key: `higgsfield-snapshot:${manifestHash}` })
    if (workflowRun && workflowRun.source_version !== manifestHash) throw new Error('workflow run source_version conflict')
    if (workflowRun && workflowRun.input_ref !== rawEvidenceURI(snapshotEvidenceRef)) {
      workflowRun = await payload.update({
        collection: 'workflow-runs', id: workflowRun.id, overrideAccess: true,
        data: { input_ref: rawEvidenceURI(snapshotEvidenceRef) },
      })
    }
  if (!workflowRun) workflowRun = await payload.create({
      collection: 'workflow-runs', overrideAccess: true,
      data: { source_version: manifestHash, job_type: 'ingest', idempotency_key: `higgsfield-snapshot:${manifestHash}`, attempt: 0, input_ref: rawEvidenceURI(snapshotEvidenceRef), output_ref: null, error_class: null },
    })
  }

  try {
  for await (const row of readJsonLines(layout.normalizedPath, layout.allowLegacyTextControls)) {
    const post = layout.normalize(row.value)
    const contentHash = sha256(row.raw)
    let source: SnapshotDocument | undefined
    let semanticAlias = false
    const payload = input.payload!
    source = await findOne(payload, 'sources', { provider: layout.provider, provider_record_id: post.tweet_id, content_hash: contentHash })
    if (source) {
      if (source.source_version !== manifestHash) {
        source = await payload.update({ collection: 'sources', id: source.id, overrideAccess: true, data: { source_version: manifestHash } })
      }
      skipped.sources += 1
    }
    else {
      source = await findOne(payload, 'sources', { semantic_key: semanticKeyForXStatus(post.tweet_id) })
      if (source) {
        semanticAlias = true
        const existingObservation = await findOne(payload, 'source-observations', {
          provider: layout.provider, provider_record_id: post.tweet_id, content_hash: contentHash,
        })
        if (!existingObservation) {
          const rawRef = canonicalRawRef(contentHash, row.raw.byteLength)
          const receipt = await input.rawEvidenceStore!.putForIngress({
            principal: principals.ingestService, ref: rawRef, bytes: row.raw, field: 'raw_ref',
            actor_id: 'higgsfield-snapshot-import', correlation_id: input.correlationId,
          })
          await payload.create({
            collection: 'source-observations', overrideAccess: true,
            data: {
              stable_id: stableID(`source-observation:${layout.provider}:${post.tweet_id}:${contentHash}`),
              schema_version: 1, revision: 1, source_version: manifestHash,
              source_ref: source.id, workflow_run: workflowRun!.id, provider: layout.provider,
              provider_record_id: post.tweet_id, canonical_url: post.url, raw_ref: rawRef,
              captured_at: post.created_at, content_hash: contentHash,
            },
            req: { context: withObjectAuthority({}, createObjectIngressCommand({
              authority: rawAuthority, receipt, field: 'raw_ref', actor_id: 'higgsfield-snapshot-import', correlation_id: input.correlationId,
            })) },
          })
        }
        skipped.sources += 1
      }
      else {
        const rawRef = canonicalRawRef(contentHash, row.raw.byteLength)
        const receipt = await input.rawEvidenceStore!.putForIngress({
          principal: principals.ingestService, ref: rawRef, bytes: row.raw, field: 'raw_ref',
          actor_id: 'higgsfield-snapshot-import', correlation_id: input.correlationId,
        })
        source = await payload.create({
          collection: 'sources', overrideAccess: true,
          data: {
            stable_id: stableID(`source:${post.tweet_id}:${contentHash}`), schema_version: 1, revision: 1,
            source_version: manifestHash, status: 'active', provider: layout.provider, provider_record_id: post.tweet_id,
            semantic_key: semanticKeyForXStatus(post.tweet_id), canonical_url: post.url, raw_ref: rawRef, captured_at: post.created_at,
            content_hash: contentHash, rights_state: 'metadata_only', deletion_state: 'active',
          },
          req: { context: withObjectAuthority({}, createObjectIngressCommand({
            authority: rawAuthority, receipt, field: 'raw_ref', actor_id: 'higgsfield-snapshot-import', correlation_id: input.correlationId,
          })) },
        })
        created.sources += 1
      }
    }
    sourcesByTweet.set(post.tweet_id, source)

    if (post.prompt_text === null) continue
    const artifactStableID = stableID(`artifact:${post.tweet_id}:${contentHash}`)
    const artifactsForSource = await payload.find({
      collection: 'prompt-artifacts', where: { and: [{ source: { equals: source.id } }, { kind: { equals: 'prompt' } }] }, limit: 100, overrideAccess: true,
    })
    let artifact = artifactsForSource.docs.find((candidate) => asRecord(candidate.prompt).original_text === post.prompt_text)
    if (artifact) {
      if (!semanticAlias && artifact.source_version !== manifestHash) {
        artifact = await payload.update({ collection: 'prompt-artifacts', id: artifact.id, overrideAccess: true, data: { source_version: manifestHash } })
      }
      skipped.artifacts += 1
    }
    else {
      await payload.create({
        collection: 'prompt-artifacts', overrideAccess: true,
        data: {
          stable_id: artifactStableID, schema_version: 1, revision: 1,
          source_version: manifestHash, status: 'draft', kind: 'prompt',
          canonical_label: post.author_handle ? `@${post.author_handle} prompt` : `X prompt ${post.tweet_id}`,
          prompt: { original_text: post.prompt_text }, original_language: post.language,
          outcome: { media_type: 'unresolved' }, source: source.id,
          rights_state: 'metadata_only', safety_state: 'pending', evidence_state: 'verified',
        },
      })
      created.artifacts += 1
    }
  }

  const importMedia = async (media: MediaReference): Promise<void> => {
    const source = sourcesByTweet.get(media.tweet_id)
    if (!source) throw new Error(`orphan media reference ${media.tweet_id}`)
    const payload = input.payload!
    const contentHash = sha256(JSON.stringify(media))
    let providerMediaID = media.provider_media_id
    // The same status may be collected by a fallback provider under a different
    // media ID. Canonical-source plus remote URL is the provider-neutral media
    // identity; the raw source observation still retains the fallback bytes.
    let existing = await findOne(payload, 'media-evidence', { source_ref: source.id, remote_url: media.remote_url })
    if (!existing) existing = await findOne(payload, 'media-evidence', { provider: 'x', provider_media_id: providerMediaID })
    // X may reuse the same media object in multiple posts. A MediaEvidence row
    // belongs to one source, so preserve the first provider identity and give
    // later incompatible observations a stable source-qualified identity.
    if (existing && existing.content_hash !== contentHash) {
      providerMediaID = `x-observation:${media.provider_media_id}:${media.tweet_id}`
      existing = await findOne(payload, 'media-evidence', { provider: 'x', provider_media_id: providerMediaID })
    }
    if (existing) {
      if (existing.content_hash !== contentHash) throw new Error(`media evidence conflict for ${providerMediaID}`)
      if (existing.source_version !== manifestHash || existing.workflow_run !== workflowRun!.id) {
        await payload.update({
          collection: 'media-evidence', id: existing.id, overrideAccess: true,
          data: { source_version: manifestHash, workflow_run: workflowRun!.id },
        })
      }
      skipped.mediaEvidence += 1
      return
    }
    await payload.create({
      collection: 'media-evidence', overrideAccess: true,
      data: {
        media_evidence_id: stableID(`media:${providerMediaID}:${contentHash}`),
        source_ref: source.id, source_version: manifestHash, workflow_run: workflowRun!.id,
        provider: 'x', provider_media_id: providerMediaID, media_type: media.media_type,
        width: media.width, height: media.height, duration_ms: media.duration_ms,
        remote_url: media.remote_url, thumbnail_url: media.thumbnail_url, observed_at: media.observed_at,
        rights_state: 'metadata_only', sensitive_content_state: media.sensitive_content_state,
        content_hash: contentHash, visibility: 'private_evidence', delivery_target: 'private_reference',
        preview_noindex: true, attribution_url: null,
      },
    })
    created.mediaEvidence += 1
  }

  for await (const media of readMediaReferences(layout.mediaInput)) await importMedia(media)
  await terminalImportRun(input.payload!, workflowRun!, 'succeeded', manifestHash)
  } catch (error) {
    try {
      await terminalImportRun(input.payload!, workflowRun!, 'failed', manifestHash)
    } catch (terminalizationError) {
      throw new SnapshotImportTerminalizationError(error, terminalizationError)
    }
    throw error
  }

  return Object.freeze({ manifestHash, snapshotEvidenceRef, created: Object.freeze(created), skipped: Object.freeze(skipped), dryRun: false })
}
