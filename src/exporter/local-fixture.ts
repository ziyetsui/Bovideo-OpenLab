import { createHash } from 'node:crypto'

import { hashPublicationTree, stableJson, type PublicationTreeFile } from '@/publication/manifest'

type ExportRights = 'first_party' | 'redistribution_licensed' | 'metadata_only' | 'display_licensed' | 'unknown' | 'blocked' | 'revoked'
type ExportStatus = 'approved' | 'candidate' | 'rejected' | 'withdrawn' | string

export type LocalFixtureRecord = Readonly<{
  id: string
  status: ExportStatus
  rights: ExportRights | string
  source_hash?: string
  source_url?: string
  title?: string
  prompt?: string
  category?: string
  locale?: string
  [key: string]: unknown
}>

export type SanitizedExportFixture = Readonly<{
  publication: 'local_only'
  treeHash: string
  files: readonly PublicationTreeFile[]
  excludedIds: readonly string[]
  sensitiveFindingCount: 0
}>

const HASH = /^sha256:v1:[a-f0-9]{64}$/
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/
const SECRET = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN\s+.*PRIVATE\s+KEY-----|(?:api|access|auth|payload|session)[_-]?(?:secret|token|key)\s*[:=])/i
const PRIVATE = /(?:^|[\s"'=])(\/(?:Users|private|tmp|var)\/|[A-Za-z]:[\\/]|\\\\|\.env(?:\.|$)|(?:raw|private|audit|review|user)[_-]?(?:ref|data|note|id)\s*[:=])/i
const PII = /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

const safePublicUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(value)) return false
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    if (parsed.username || parsed.password || host === 'localhost' || host.endsWith('.internal') || /^(?:0|10|127|192\.168)\./.test(host)) return false
    if (/(?:token|secret|signature|sig|key|expires|credential)=/i.test(parsed.search)) return false
    return !/(?:eyJ[A-Za-z0-9_-]{6,}\.|bearer\s+)/i.test(value)
  } catch {
    return false
  }
}

const safeContent = (value: unknown): value is string =>
  typeof value === 'string' && !SECRET.test(value) && !PRIVATE.test(value) && !PII.test(value) && !value.includes('\u0000')

function exportRecord(record: LocalFixtureRecord): Readonly<Record<string, unknown>> | undefined {
  if (!SAFE_ID.test(record.id) || record.status !== 'approved') return undefined
  if (record.rights !== 'first_party' && record.rights !== 'redistribution_licensed' && record.rights !== 'metadata_only') return undefined
  if (record.source_hash !== undefined && !HASH.test(record.source_hash)) return undefined
  if (record.source_url !== undefined && !safePublicUrl(record.source_url)) return undefined
  if (record.title !== undefined && !safeContent(record.title)) return undefined
  if (record.prompt !== undefined && !safeContent(record.prompt)) return undefined

  const result: Record<string, unknown> = { id: record.id, rights: record.rights }
  if (record.source_hash !== undefined) result.source_hash = record.source_hash
  if (record.source_url !== undefined) result.source_url = record.source_url
  if (record.category !== undefined && safeContent(record.category)) result.category = record.category
  if (record.rights !== 'metadata_only') {
    if (record.title !== undefined) result.title = record.title
    if (record.locale !== undefined && /^[a-z]{2}(?:-[A-Z]{2}|-\d{3})?$/.test(record.locale)) result.locale = record.locale
    if (record.prompt !== undefined) result.prompt = record.prompt
  }
  return Object.freeze(result)
}

export function buildSanitizedExportFixture(input: Readonly<{ records: readonly LocalFixtureRecord[] }>): SanitizedExportFixture {
  for (const record of input.records) {
    if (!SAFE_ID.test(record.id)) throw new Error(`unsafe export record id: ${record.id}`)
  }
  const sorted = [...input.records].sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)))
  const files: PublicationTreeFile[] = []
  const excludedIds: string[] = []
  for (const record of sorted) {
    const exported = exportRecord(record)
    if (exported === undefined) {
      excludedIds.push(record.id)
      continue
    }
    files.push({ path: `export/records/${record.id}.json`, bytes: stableJson(exported) })
  }
  return Object.freeze({ publication: 'local_only', treeHash: hashPublicationTree(files), files: Object.freeze(files), excludedIds: Object.freeze(excludedIds), sensitiveFindingCount: 0 })
}

export const createSanitizedExportFixture = buildSanitizedExportFixture
export const hashExportFixture = (files: readonly PublicationTreeFile[]): string => hashPublicationTree(files)
export const contentHash = (value: string): string => `sha256:v1:${sha256(value)}`
