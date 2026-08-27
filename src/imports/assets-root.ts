import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { principals } from '@/access/principals'
import { createWorkflowRunTransitionRequest } from '@/collections/canonical-payload-contract'
import type { SnapshotImportPayload } from '@/imports/higgsfield-snapshot'
import type { ObjectIngressStore } from '@/storage/object-ingress-store'
import type { ObjectRef } from '@/storage/object-ref'

export type AssetsRootImportPlan = Readonly<{
  snapshots: readonly Readonly<{
    kind: 'canonical_twitter241' | 'legacy_public_search'
    directory: string
  }>[]
  derived: readonly Readonly<{ directory: string }>[]
  ignored: readonly Readonly<{ entry: string; reason: 'macos_metadata' }>[]
}>

const hasFile = async (filename: string): Promise<boolean> => {
  try { await access(filename); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const sha256 = (value: Uint8Array): string => `sha256:v1:${createHash('sha256').update(value).digest('hex')}`
const rawEvidenceRef = (contentHash: string, sizeBytes: number, mimeType: string): ObjectRef => ({
  namespace: 'raw-evidence', bucket_class: 'private_raw',
  key: `sha256/${contentHash.slice(10, 12)}/${contentHash.slice(10)}`,
  content_hash: contentHash, version: 'v1', size_bytes: sizeBytes, mime_type: mimeType,
  rights_state: 'metadata_only', deletion_state: 'active',
})
const mimeType = (filename: string): string => filename.endsWith('.json') || filename.endsWith('.jsonl') ? 'application/json' : 'text/plain'
const CHUNK_BYTES = 8 * 1024 * 1024

/**
 * Archives a deterministic evidence-only directory. It deliberately returns
 * only a private reconstruction index: callers cannot accidentally treat a
 * derived index as a new Source, PromptArtifact, or MediaEvidence fact.
 */
export const archivePrivateEvidenceDirectory = async (input: Readonly<{
  directory: string
  label: string
  store: ObjectIngressStore
}>): Promise<ObjectRef> => {
  if (!input.label.trim()) throw new Error('derived evidence label is required')
  const entries = await readdir(input.directory, { withFileTypes: true })
  const files: { filename: string; content_hash: string; size_bytes: number; chunks: ObjectRef[] }[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.includes('/') || entry.name.includes('\\')) throw new Error('invalid derived evidence filename')
    const filename = join(input.directory, entry.name)
    const stat = await lstat(filename)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`derived evidence contains a non-file entry ${entry.name}`)
    const chunks: ObjectRef[] = []
    const digest = createHash('sha256')
    let sizeBytes = 0
    for await (const chunk of createReadStream(filename, { highWaterMark: CHUNK_BYTES })) {
      const bytes = new Uint8Array(chunk)
      const ref = rawEvidenceRef(sha256(bytes), bytes.byteLength, mimeType(entry.name))
      await input.store.write({ principal: principals.ingestService, ref, bytes })
      chunks.push(ref)
      digest.update(bytes)
      sizeBytes += bytes.byteLength
    }
    files.push({ filename: entry.name, content_hash: `sha256:v1:${digest.digest('hex')}`, size_bytes: sizeBytes, chunks })
  }
  const indexBytes = Buffer.from(JSON.stringify({ format_version: 1, kind: 'derived-evidence', label: input.label, files }), 'utf8')
  const indexRef = rawEvidenceRef(sha256(indexBytes), indexBytes.byteLength, 'application/json')
  await input.store.write({ principal: principals.ingestService, ref: indexRef, bytes: indexBytes })
  return indexRef
}

const rawEvidenceURI = (ref: ObjectRef): string => `raw-evidence://${ref.key}`

/** Records a derived-only archive in Payload without creating any content fact. */
export const recordDerivedEvidenceWorkflow = async (input: Readonly<{
  payload: SnapshotImportPayload
  evidence: ObjectRef
}>): Promise<void> => {
  const idempotencyKey = `derived-evidence:${input.evidence.content_hash}`
  const existing = await input.payload.find({
    collection: 'workflow-runs',
    where: { and: [{ job_type: { equals: 'ingest' } }, { idempotency_key: { equals: idempotencyKey } }] },
    limit: 1, overrideAccess: true,
  })
  const run = existing.docs[0] ?? await input.payload.create({
    collection: 'workflow-runs', overrideAccess: true,
    data: {
      source_version: input.evidence.content_hash, job_type: 'ingest', idempotency_key: idempotencyKey,
      attempt: 0, input_ref: rawEvidenceURI(input.evidence), output_ref: null, error_class: null,
    },
  })
  if (run.source_version !== input.evidence.content_hash || run.input_ref !== rawEvidenceURI(input.evidence))
    throw new Error('derived evidence workflow provenance conflict')
  if (run.status === 'succeeded') return
  const status = typeof run.status === 'string' ? run.status : 'queued'
  const revision = typeof run.revision === 'number' && Number.isInteger(run.revision) ? run.revision : 1
  const stableID = typeof run.stable_id === 'string' ? run.stable_id : globalThis.crypto.randomUUID()
  await input.payload.update({
    collection: 'workflow-runs', id: run.id, overrideAccess: true,
    data: { status: 'succeeded', output_ref: `private/derived-evidence/${input.evidence.content_hash.slice(10)}`, error_class: null },
    req: createWorkflowRunTransitionRequest({
      stable_id: stableID, expected: { status, revision }, status: 'succeeded',
      reason_code: 'derived_evidence_archived', correlation_id: globalThis.crypto.randomUUID(),
    }),
  })
}

/**
 * Fails closed on unclassified root entries so an operator never mistakes a
 * partial import for a complete database ingestion. The derived media index is
 * recognised separately: it contains no independent source facts.
 */
export const planAssetsRootImport = async (rootDirectory: string): Promise<AssetsRootImportPlan> => {
  const root = rootDirectory.trim()
  if (!root) throw new Error('assets root directory is required')
  const entries = await readdir(root, { withFileTypes: true })
  const names = new Set(entries.map((entry) => entry.name))
  const canonical = 'higgsfield-x-prompts-2026-08-20-twitter241'
  const legacy = 'higgsfield-x-prompts-2026-08-20'
  const derived = 'higgsfield-x-prompts-2026-08-20-twitter241-derived'
  const known = new Set([canonical, legacy, derived, '.DS_Store'])
  const unknown = [...names].filter((name) => !known.has(name)).sort()
  if (unknown.length > 0) throw new Error(`unrecognized assets-root entry ${unknown[0]}`)
  for (const directory of [canonical, legacy]) {
    if (!names.has(directory) || !await hasFile(join(root, directory, 'manifest.json')))
      throw new Error(`assets-root snapshot ${directory} is missing its manifest`)
  }
  if (!names.has(derived) || !await hasFile(join(root, derived, 'README.md')) || !await hasFile(join(root, derived, 'media_refs.jsonl')))
    throw new Error(`assets-root derived evidence ${derived} is incomplete`)
  return Object.freeze({
    snapshots: Object.freeze([
      Object.freeze({ kind: 'canonical_twitter241', directory: join(root, canonical) }),
      Object.freeze({ kind: 'legacy_public_search', directory: join(root, legacy) }),
    ]),
    derived: Object.freeze([Object.freeze({ directory: join(root, derived) })]),
    ignored: Object.freeze(names.has('.DS_Store') ? [Object.freeze({ entry: '.DS_Store', reason: 'macos_metadata' as const })] : []),
  })
}

export type AssetsRootImportResult<TSnapshot> = Readonly<{
  snapshots: readonly TSnapshot[]
  /** Private reconstruction indexes only; this array has no business rows. */
  derived: readonly ObjectRef[]
  ignored: AssetsRootImportPlan['ignored']
}>

/**
 * Executes a fully classified root plan. Classification happens before the
 * first importer call, so an unexpected file cannot yield a partial Payload
 * write that looks like a complete asset-root import.
 */
export const importAssetsRoot = async <TSnapshot>(input: Readonly<{
  rootDirectory: string
  store: ObjectIngressStore
  importSnapshot: (directory: string) => Promise<TSnapshot>
}>): Promise<AssetsRootImportResult<TSnapshot>> => {
  const plan = await planAssetsRootImport(input.rootDirectory)
  const snapshots: TSnapshot[] = []
  for (const snapshot of plan.snapshots) snapshots.push(await input.importSnapshot(snapshot.directory))
  const derived: ObjectRef[] = []
  for (const evidence of plan.derived) {
    derived.push(await archivePrivateEvidenceDirectory({
      directory: evidence.directory,
      label: evidence.directory.split('/').at(-1) ?? 'derived-evidence',
      store: input.store,
    }))
  }
  return Object.freeze({ snapshots: Object.freeze(snapshots), derived: Object.freeze(derived), ignored: plan.ignored })
}
