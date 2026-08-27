import { hashPublicationTree, stableJson, type PublicationTreeFile } from '@/publication/manifest'

/**
 * The public mirror is intentionally a closed world.  Adding a field to a
 * Payload collection does not make it public; it must first be added here and
 * pass the rights policy below.
 */
export const PUBLIC_RELEASE_ALLOW_LIST = Object.freeze([
  'id', 'slug', 'locale', 'page_type', 'title', 'description', 'canonical',
  'category', 'source_hash', 'source_url', 'rights', 'prompt', 'body', 'media_refs', 'media',
] as const)

export type PublicReleaseRights = 'first_party' | 'redistribution_licensed' | 'metadata_only' | 'display_licensed' | 'unknown' | 'blocked' | 'revoked'
export type PublicReleaseStatus = 'approved' | 'candidate' | 'rejected' | 'withdrawn' | string

export type PublicReleaseMedia = Readonly<{
  ref: string
  kind: 'image' | 'video'
  sha256?: `sha256:v1:${string}`
}>

/** Input is deliberately wider than the output so callers can pass a raw
 * Payload row.  Unknown properties are never copied to the public tree. */
export type PublicReleaseRecord = Readonly<{
  id: string
  status: PublicReleaseStatus
  rights: PublicReleaseRights | string
  slug?: string
  locale?: string
  page_type?: 'hub' | 'gallery' | 'entity' | 'detail' | string
  title?: string
  description?: string
  canonical?: string
  category?: string
  source_hash?: string
  source_url?: string
  prompt?: string
  body?: string
  media_refs?: readonly string[]
  media?: readonly PublicReleaseMedia[]
  [key: string]: unknown
}>

export type PublicReleaseFinding = Readonly<{
  id: string
  reason_code:
    | 'unsafe_id'
    | 'not_approved'
    | 'rights_not_permitted'
    | 'metadata_only_content'
    | 'forbidden_input_field'
    | 'secret_or_private_content'
    | 'invalid_source_hash'
    | 'invalid_source_url'
    | 'invalid_public_url'
    | 'invalid_media'
}> 

export type PublicReleasePoisonScan = Readonly<{
  total: number
  blocked: number
  passed: number
  findings: readonly PublicReleaseFinding[]
  status: 'PASS' | 'FAIL'
}>

export type PublicReleaseManifest = Readonly<{
  schema_version: 'p4-public-release-v1'
  release_version: number
  tree_hash: `sha256:p2l-v1:${string}`
  files: readonly PublicationTreeFile[]
  included_ids: readonly string[]
  excluded: readonly PublicReleaseFinding[]
  poison_scan: PublicReleasePoisonScan
}>

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/
const HASH = /^sha256:v1:[a-f0-9]{64}$/
const SAFE_LOCALE = /^[a-z]{2}(?:-[A-Z]{2}|-\d{3})?$/
const SECRET = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN\s+.*PRIVATE\s+KEY-----|(?:api|access|auth|payload|session)[_-]?(?:secret|token|key)\s*[:=])/i
const PRIVATE = /(?:^|[\s"'=])(\/(?:Users|private|tmp|var)\/|[A-Za-z]:[\\/]|\\\\|\.env(?:\.|$))/i
const PII = /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const FORBIDDEN_KEY = /(?:author|email|private|internal|audit|review|secret|token|binary|bytes|raw|credential|session|user[_-]?(?:id|data|ref)|prompt)/i

const safeText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('\u0000') && !SECRET.test(value) && !PRIVATE.test(value) && !PII.test(value)
const safePublicUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(value)) return false
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    return !parsed.username && !parsed.password && host !== 'localhost' && !host.endsWith('.internal') && !/^(?:0|10|127|192\.168)\./.test(host) && !/(?:token|secret|signature|sig|key|expires|credential)=/i.test(parsed.search)
  } catch {
    return false
  }
}

const walkForbiddenKeys = (value: unknown, path = ''): boolean => {
  if (Array.isArray(value)) return value.some((item, index) => walkForbiddenKeys(item, `${path}[${index}]`))
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    // `prompt` is a supported field for licensed records.  Its policy is
    // checked separately, so it is not considered a forbidden key here.
    // Unknown fields are dropped by the allow-list. Internal notes are
    // deliberately ignored rather than copied; explicitly dangerous fields
    // (secrets, private data, author identity, etc.) still fail closed.
    const forbidden = key !== 'prompt' && key !== 'internal_notes' && FORBIDDEN_KEY.test(key)
    return forbidden || walkForbiddenKeys(child, `${path}.${key}`)
  })
}

const permittedRights = new Set<PublicReleaseRights>(['first_party', 'redistribution_licensed', 'metadata_only'])
const fullRights = new Set<PublicReleaseRights>(['first_party', 'redistribution_licensed'])

function validateRecord(record: PublicReleaseRecord): PublicReleaseFinding['reason_code'] | undefined {
  if (!SAFE_ID.test(record.id)) return 'unsafe_id'
  if (record.status !== 'approved') return 'not_approved'
  if (!permittedRights.has(record.rights as PublicReleaseRights)) return 'rights_not_permitted'
  // Metadata-only rows are not allowed to carry private/internal annotations;
  // full-rights rows may contain them because the closed allow-list drops them
  // before serialization. In neither case can the field reach the public tree.
  if (walkForbiddenKeys(record) || (record.rights === 'metadata_only' && Object.prototype.hasOwnProperty.call(record, 'internal_notes'))) return 'forbidden_input_field'
  const isFull = fullRights.has(record.rights as PublicReleaseRights)
  if (!isFull && (record.prompt !== undefined || record.body !== undefined || record.media !== undefined || record.media_refs !== undefined)) return 'metadata_only_content'
  if (record.source_hash !== undefined && !HASH.test(record.source_hash)) return 'invalid_source_hash'
  if (record.source_url !== undefined && !safePublicUrl(record.source_url)) return 'invalid_source_url'
  if (record.slug !== undefined && !safeText(record.slug)) return 'secret_or_private_content'
  if (record.canonical !== undefined && !safePublicUrl(record.canonical)) return 'invalid_public_url'
  for (const value of [record.title, record.description, record.category, record.prompt, record.body]) if (value !== undefined && !safeText(value)) return 'secret_or_private_content'
  if (record.locale !== undefined && !SAFE_LOCALE.test(record.locale)) return 'secret_or_private_content'
  if (record.media_refs !== undefined && (!isFull || record.media_refs.some((ref) => typeof ref !== 'string' || !SAFE_ID.test(ref)))) return 'invalid_media'
  if (record.media !== undefined && (!isFull || record.media.some((media) => !SAFE_ID.test(media.ref) || !['image', 'video'].includes(media.kind) || (media.sha256 !== undefined && !HASH.test(media.sha256))))) return 'invalid_media'
  return undefined
}

function toPublicRecord(record: PublicReleaseRecord): Record<string, unknown> {
  const output: Record<string, unknown> = { id: record.id, rights: record.rights }
  const metadataFields = ['slug', 'locale', 'page_type', 'title', 'description', 'canonical', 'category', 'source_hash', 'source_url'] as const
  for (const field of metadataFields) if (record[field] !== undefined) output[field] = record[field]
  if (fullRights.has(record.rights as PublicReleaseRights)) {
    for (const field of ['prompt', 'body', 'media_refs', 'media'] as const) if (record[field] !== undefined) output[field] = record[field]
  }
  return output
}

export function scanPublicReleaseRecords(records: readonly PublicReleaseRecord[]): PublicReleasePoisonScan {
  const findings = records.flatMap((record) => {
    const reason = validateRecord(record)
    return reason === undefined ? [] : [{ id: record.id, reason_code: reason } satisfies PublicReleaseFinding]
  })
  const blocked = findings.length
  return Object.freeze({ total: records.length, blocked, passed: records.length - blocked, findings: Object.freeze(findings), status: blocked === records.length ? 'PASS' : 'FAIL' })
}

/** A fixed 20-record adversarial corpus used by local acceptance tests. */
export function buildPublicReleasePoisonFixtures(): readonly PublicReleaseRecord[] {
  return Object.freeze(Array.from({ length: 20 }, (_, index) => {
    const id = `poison-${String(index + 1).padStart(2, '0')}`
    const base: PublicReleaseRecord = { id, status: 'approved', rights: 'first_party', title: `poison ${index + 1}` }
    if (index % 4 === 0) return { ...base, rights: 'metadata_only', prompt: 'must not be exported' }
    if (index % 4 === 1) return { ...base, private_notes: '/Users/private/review.txt' }
    if (index % 4 === 2) return { ...base, author_email: 'person@real.example.net' }
    return { ...base, api_secret: 'sk-proj-poison-secret-value' }
  }))
}

export function scanPublicReleasePoisonFixtures(): PublicReleasePoisonScan {
  return scanPublicReleaseRecords(buildPublicReleasePoisonFixtures())
}

export function buildPublicReleaseManifest(input: Readonly<{ releaseVersion: number; records: readonly PublicReleaseRecord[]; poisonFixtures?: readonly PublicReleaseRecord[] }>): PublicReleaseManifest {
  if (!Number.isSafeInteger(input.releaseVersion) || input.releaseVersion < 1) throw new Error('release version must be a positive integer')
  const seen = new Set<string>()
  const files: PublicationTreeFile[] = []
  const excluded: PublicReleaseFinding[] = []
  for (const record of [...input.records].sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)))) {
    if (seen.has(record.id)) throw new Error(`duplicate public release id: ${record.id}`)
    seen.add(record.id)
    const reason = validateRecord(record)
    if (reason !== undefined) { excluded.push({ id: record.id, reason_code: reason }); continue }
    files.push({ path: `public/records/${record.id}.json`, bytes: stableJson(toPublicRecord(record)) })
  }
  const poisonScan = scanPublicReleaseRecords(input.poisonFixtures ?? buildPublicReleasePoisonFixtures())
  if (poisonScan.status !== 'PASS' || poisonScan.total !== 20 || poisonScan.blocked !== 20) throw new Error('public release poison scan did not block all 20 fixtures')
  return Object.freeze({ schema_version: 'p4-public-release-v1', release_version: input.releaseVersion, tree_hash: hashPublicationTree(files), files: Object.freeze(files), included_ids: Object.freeze(files.map((file) => file.path.slice('public/records/'.length, -'.json'.length))), excluded: Object.freeze(excluded), poison_scan: poisonScan })
}

export const createPublicReleaseManifest = buildPublicReleaseManifest
export const exportPublicRelease = buildPublicReleaseManifest
