import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateMediaEvidence } from '@/collections/MediaEvidence'
import { principals } from '@/access/principals'
import { importHiggsfieldSnapshot, SnapshotImportLeaseConflictError, SnapshotImportTerminalizationError } from '@/imports/higgsfield-snapshot'
import { LocalObjectStore } from '@/storage/local-object-store'
import { afterEach, describe, expect, it } from 'vitest'

type Document = Record<string, unknown> & { id: number }

class InMemoryPayload {
  readonly documents = new Map<string, Document[]>()
  failCollection: string | null = null
  failUpdateCollection: string | null = null
  updateFailuresRemaining = 0
  onUpdateFailure: ((input: { collection: string; id: number | string }) => void) | null = null
  #nextID = 1

  async find(input: { collection: string; where?: unknown }): Promise<{ docs: Document[] }> {
    const docs = this.documents.get(input.collection) ?? []
    return { docs: docs.filter((doc) => this.matches(doc, input.where)) }
  }

  async create(input: { collection: string; data: Record<string, unknown> }): Promise<Document> {
    if (input.collection === this.failCollection) throw new Error(`injected ${input.collection} failure`)
    const data = input.collection === 'media-evidence'
      ? validateMediaEvidence({ data: input.data, operation: 'create' } as never) as Record<string, unknown>
      : input.data
    const document = {
      ...(input.collection === 'workflow-runs' ? { status: 'queued', revision: 1, stable_id: globalThis.crypto.randomUUID() } : {}),
      ...data,
      id: this.#nextID++,
    }
    this.documents.set(input.collection, [...(this.documents.get(input.collection) ?? []), document])
    return document
  }

  async update(input: { collection: string; id: number | string; data: Record<string, unknown>; overrideAccess?: boolean; req?: unknown }): Promise<Document> {
    if (input.collection === this.failUpdateCollection && this.updateFailuresRemaining !== 0) {
      if (this.updateFailuresRemaining > 0) this.updateFailuresRemaining -= 1
      this.onUpdateFailure?.(input)
      throw new Error(`injected ${input.collection} update failure`)
    }
    const documents = this.documents.get(input.collection) ?? []
    const current = documents.find((document) => document.id === input.id)
    if (!current) throw new Error('missing document')
    const updated = { ...current, ...input.data }
    this.documents.set(input.collection, documents.map((document) => document.id === input.id ? updated : document))
    return updated
  }

  count(collection: string): number { return (this.documents.get(collection) ?? []).length }

  private matches(document: Document, where: unknown): boolean {
    if (!where || typeof where !== 'object') return true
    const value = where as { and?: unknown[]; [field: string]: unknown }
    if (value.and) return value.and.every((part) => this.matches(document, part))
    return Object.entries(value).every(([field, condition]) => {
      if (!condition || typeof condition !== 'object' || !('equals' in condition)) return false
      return document[field] === (condition as { equals: unknown }).equals
    })
  }
}

const fixtureDir = join(process.cwd(), 'tests/phase3/fixtures/import/higgsfield-mini')
const correlationId = '00000000-0000-4000-8000-000000000301'
const temporaryDirectories: string[] = []

const rawEvidenceStore = async (): Promise<LocalObjectStore> => {
  const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-raw-'))
  temporaryDirectories.push(directory)
  return new LocalObjectStore({ root_dir: directory, signer_secret: 'higgsfield-import-test-signer' })
}

const updateManifestFileHash = async (directory: string, filename: string): Promise<void> => {
  const manifestPath = join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { output_sha256: Record<string, string> }
  manifest.output_sha256[filename] = createHash('sha256').update(await readFile(join(directory, filename))).digest('hex')
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8')
}

const legacyFixture = async (input: Readonly<{ hashes?: boolean; tweetID?: string; promptText?: string }> = {}): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-legacy-'))
  temporaryDirectories.push(directory)
  const tweetID = input.tweetID ?? 'legacy-101'
  const promptText = input.promptText ?? 'Make a legacy scene.'
  await writeFile(join(directory, 'records.jsonl'), `${JSON.stringify({
    tweet_id: tweetID, created_at: '2026-08-20T12:00:00.000Z', author_handle: 'legacy',
    url: `https://x.com/legacy/status/${tweetID}`, text: 'Legacy prompt source.', prompt_text: promptText,
  })}\n`, 'utf8')
  await writeFile(join(directory, 'raw_hydration.jsonl'), `${JSON.stringify({
    tweet_id: tweetID, syndication: {
      created_at: '2026-08-20T12:00:00.000Z', possibly_sensitive: false,
      mediaDetails: [{ type: 'photo', media_url_https: `https://pbs.twimg.com/media/${tweetID}.jpg`, original_info: { width: 1200, height: 800 } }],
    },
  })}\n`, 'utf8')
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ output_sha256: {} }), 'utf8')
  if (input.hashes !== false) {
    await updateManifestFileHash(directory, 'records.jsonl')
    await updateManifestFileHash(directory, 'raw_hydration.jsonl')
  }
  return directory
}

afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('Higgsfield snapshot importer', () => {
  it('merges the same X status observed by two providers while retaining the second raw observation', async () => {
    const payload = new InMemoryPayload()
    const store = await rawEvidenceStore()

    await importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: store })
    const second = await importHiggsfieldSnapshot({
      snapshotDir: await legacyFixture({ tweetID: 'tweet-101', promptText: 'Create a mountain landscape.' }),
      payload,
      correlationId,
      rawEvidenceStore: store,
    })

    expect(second.created).toEqual({ sources: 0, artifacts: 0, mediaEvidence: 1 })
    expect(payload.count('sources')).toBe(2)
    expect(payload.documents.get('sources')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'twitter241', provider_record_id: 'tweet-101', semantic_key: 'x-status:tweet-101' }),
    ]))
    expect(payload.documents.get('source-observations')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'x_public_search', provider_record_id: 'tweet-101', source_ref: expect.any(Number) }),
    ]))
    expect(payload.count('prompt-artifacts')).toBe(2)
  })

  it('imports a verified legacy public-search snapshot as private evidence', async () => {
    const payload = new InMemoryPayload()
    const result = await importHiggsfieldSnapshot({ snapshotDir: await legacyFixture(), payload, correlationId, rawEvidenceStore: await rawEvidenceStore() })

    expect(result.created).toEqual({ sources: 1, artifacts: 1, mediaEvidence: 1 })
    expect(payload.documents.get('sources')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'x_public_search', provider_record_id: 'legacy-101' }),
    ]))
    expect(payload.documents.get('media-evidence')).toEqual(expect.arrayContaining([
      expect.objectContaining({ visibility: 'private_evidence', delivery_target: 'private_reference' }),
    ]))
  })

  it('assigns an observed input fingerprint to a historical legacy snapshot without published hashes', async () => {
    const result = await importHiggsfieldSnapshot({ snapshotDir: await legacyFixture({ hashes: false }), correlationId, dryRun: true })

    expect(result.manifestHash).toMatch(/^sha256:v1:[a-f0-9]{64}$/)
    expect(result.dryRun).toBe(true)
  })

  it('upgrades provenance for an unchanged legacy record instead of colliding with its stable artifact identity', async () => {
    const directory = await legacyFixture({ hashes: false })
    const payload = new InMemoryPayload()
    const store = await rawEvidenceStore()
    const first = await importHiggsfieldSnapshot({ snapshotDir: directory, payload, correlationId, rawEvidenceStore: store })
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as Record<string, unknown>
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, provenance_upgrade: '2026-08-26' }), 'utf8')

    const second = await importHiggsfieldSnapshot({ snapshotDir: directory, payload, correlationId, rawEvidenceStore: store })

    expect(second.manifestHash).not.toBe(first.manifestHash)
    expect(second.created).toEqual({ sources: 0, artifacts: 0, mediaEvidence: 0 })
    expect(payload.documents.get('sources')).toEqual(expect.arrayContaining([expect.objectContaining({ source_version: second.manifestHash })]))
    expect(payload.documents.get('prompt-artifacts')).toEqual(expect.arrayContaining([expect.objectContaining({ source_version: second.manifestHash })]))
    expect(payload.documents.get('media-evidence')).toEqual(expect.arrayContaining([expect.objectContaining({ source_version: second.manifestHash })]))
  })

  it('is hash-checked and idempotent', async () => {
    const payload = new InMemoryPayload()
    const store = await rawEvidenceStore()

    const first = await importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: store })
    const second = await importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: store })

    expect(first.created).toEqual({ sources: 2, artifacts: 2, mediaEvidence: 2 })
    expect(second.created).toEqual({ sources: 0, artifacts: 0, mediaEvidence: 0 })
    expect(first.manifestHash).toMatch(/^sha256:v1:[a-f0-9]{64}$/)
    expect(payload.count('media')).toBe(0)
    expect(payload.count('workflow-runs')).toBe(1)
    expect(payload.documents.get('media-evidence')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'x', source_version: first.manifestHash, workflow_run: expect.any(Number) }),
    ]))
    expect(payload.documents.get('media-evidence')?.every((document) => typeof document.source_ref === 'number')).toBe(true)
    expect(payload.documents.get('workflow-runs')).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'succeeded', output_ref: expect.stringMatching(/^private\/import-results\//), error_class: null }),
    ]))
  })

  it('retains every verified snapshot input behind the ingest-only raw-evidence boundary', async () => {
    const payload = new InMemoryPayload()
    const store = await rawEvidenceStore()

    const result = await importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: store })

    const inputRef = String(payload.documents.get('workflow-runs')?.[0]?.input_ref)
    expect(inputRef).toMatch(/^raw-evidence:\/\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/)
    const descriptor = await store.get({
      principal: principals.ingestService,
      ref: result.snapshotEvidenceRef!,
    })
    expect(JSON.parse(new TextDecoder().decode(descriptor.bytes))).toMatchObject({
      format_version: 1,
      files: expect.arrayContaining([
        expect.objectContaining({ filename: 'manifest.json' }),
        expect.objectContaining({ filename: 'normalized_posts.jsonl' }),
        expect.objectContaining({ filename: 'media_refs.jsonl' }),
      ]),
    })
  })

  it('keeps reused provider media as distinct source observations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-shared-media-'))
    temporaryDirectories.push(directory)
    await cp(fixtureDir, directory, { recursive: true })
    const mediaPath = join(directory, 'media_refs.jsonl')
    const [first] = (await readFile(mediaPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    await writeFile(mediaPath, `${JSON.stringify(first)}\n${JSON.stringify({ ...first, tweet_id: 'tweet-102' })}\n`, 'utf8')
    await updateManifestFileHash(directory, 'media_refs.jsonl')
    const payload = new InMemoryPayload()

    const result = await importHiggsfieldSnapshot({ snapshotDir: directory, payload, correlationId, rawEvidenceStore: await rawEvidenceStore() })

    expect(result.created.mediaEvidence).toBe(2)
    expect(payload.documents.get('media-evidence')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider_media_id: 'media-101' }),
      expect.objectContaining({ provider_media_id: 'x-observation:media-101:tweet-102' }),
    ]))
  })

  it('records a failed durable ingest run if a direct import fails after its lease record is created', async () => {
    const payload = new InMemoryPayload()
    payload.failCollection = 'sources'

    await expect(importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: await rawEvidenceStore() })).rejects.toThrow(/injected sources failure/i)
    expect(payload.documents.get('workflow-runs')).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', output_ref: null, error_class: 'import_failed' }),
    ]))
  })

  it('retries a transient workflow terminal update and records the import failure', async () => {
    const payload = new InMemoryPayload()
    payload.failCollection = 'sources'
    payload.failUpdateCollection = 'workflow-runs'
    payload.updateFailuresRemaining = 1

    await expect(importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: await rawEvidenceStore() })).rejects.toThrow(/injected sources failure/i)
    expect(payload.documents.get('workflow-runs')).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', output_ref: null, error_class: 'import_failed' }),
    ]))
  })

  it('propagates a durable terminalization failure instead of silently leaving an import run queued', async () => {
    const payload = new InMemoryPayload()
    payload.failCollection = 'sources'
    payload.failUpdateCollection = 'workflow-runs'
    payload.updateFailuresRemaining = -1

    await expect(importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: await rawEvidenceStore() }))
      .rejects.toMatchObject({ name: 'SnapshotImportTerminalizationError', importError: expect.objectContaining({ message: expect.stringMatching(/injected sources failure/i) }) } satisfies Partial<SnapshotImportTerminalizationError>)
    expect(payload.documents.get('workflow-runs')).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'queued', revision: 1 }),
    ]))
  })

  it('refuses to retry terminalization after another worker claims the ingest run', async () => {
    const payload = new InMemoryPayload()
    payload.failCollection = 'sources'
    payload.failUpdateCollection = 'workflow-runs'
    payload.updateFailuresRemaining = 1
    payload.onUpdateFailure = ({ collection, id }) => {
      if (collection !== 'workflow-runs') return
      const runs = payload.documents.get(collection) ?? []
      payload.documents.set(collection, runs.map((run) => run.id === id
        ? { ...run, status: 'running', revision: 2, lease_owner: 'other-worker', lease_expires_at: '2099-01-01T00:00:00.000Z' }
        : run))
    }

    await expect(importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: await rawEvidenceStore() }))
      .rejects.toMatchObject({
        name: 'SnapshotImportTerminalizationError',
        terminalizationError: expect.any(SnapshotImportLeaseConflictError),
      } satisfies Partial<SnapshotImportTerminalizationError>)
    expect(payload.documents.get('workflow-runs')).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'running', revision: 2, lease_owner: 'other-worker' }),
    ]))
  })

  it('does not create rows when a manifest hash is wrong', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-bad-'))
    temporaryDirectories.push(directory)
    await cp(fixtureDir, directory, { recursive: true })
    const manifestPath = join(directory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { output_sha256: Record<string, string> }
    manifest.output_sha256['normalized_posts.jsonl'] = '0'.repeat(64)
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8')
    const payload = new InMemoryPayload()

    await expect(importHiggsfieldSnapshot({ snapshotDir: directory, payload, correlationId, dryRun: true })).rejects.toThrow('manifest hash mismatch')
    expect(payload.count('sources')).toBe(0)
    expect(payload.count('prompt-artifacts')).toBe(0)
    expect(payload.count('media-evidence')).toBe(0)
  })

  it('requires every consumed input to be listed by the manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-unlisted-'))
    temporaryDirectories.push(directory)
    await cp(fixtureDir, directory, { recursive: true })
    const manifestPath = join(directory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { output_sha256: Record<string, string> }
    delete manifest.output_sha256['media_refs.jsonl']
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8')

    await expect(importHiggsfieldSnapshot({ snapshotDir: directory, correlationId, dryRun: true })).rejects.toThrow('manifest missing required input media_refs.jsonl')
  })

  it('rejects an oversized incomplete record without buffering the snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-malformed-'))
    temporaryDirectories.push(directory)
    const malformed = `{"tweet_id":"incomplete","text":"${'x'.repeat(2 * 1024 * 1024)}`
    await writeFile(join(directory, 'normalized_posts.jsonl'), malformed, 'utf8')
    await writeFile(join(directory, 'media_refs.jsonl'), '', 'utf8')
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ output_sha256: {} }), 'utf8')
    await updateManifestFileHash(directory, 'normalized_posts.jsonl')
    await updateManifestFileHash(directory, 'media_refs.jsonl')

    await expect(importHiggsfieldSnapshot({ snapshotDir: directory, correlationId, dryRun: true })).rejects.toThrow('snapshot record exceeds maximum size')
  })

  it('allows the known legacy text field and hashes the original CRLF record bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-crlf-'))
    temporaryDirectories.push(directory)
    await cp(fixtureDir, directory, { recursive: true })
    const normalizedPath = join(directory, 'normalized_posts.jsonl')
    const crlfBytes = Buffer.from((await readFile(normalizedPath, 'utf8')).replaceAll('\n', '\r\n'))
    await writeFile(normalizedPath, crlfBytes)
    await updateManifestFileHash(directory, 'normalized_posts.jsonl')
    const payload = new InMemoryPayload()
    const store = await rawEvidenceStore()

    await importHiggsfieldSnapshot({ snapshotDir: directory, payload, correlationId, rawEvidenceStore: store })

    const firstRecordEnd = crlfBytes.indexOf(Buffer.from('}\r\n')) + 3
    const expectedHash = `sha256:v1:${createHash('sha256').update(crlfBytes.subarray(0, firstRecordEnd)).digest('hex')}`
    const source = payload.documents.get('sources')?.find((document) => document.provider_record_id === 'tweet-101')
    expect(source).toMatchObject({ content_hash: expectedHash })
  })

  it('rejects a raw control character in a source identity field', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-identity-control-'))
    temporaryDirectories.push(directory)
    await cp(fixtureDir, directory, { recursive: true })
    const normalizedPath = join(directory, 'normalized_posts.jsonl')
    await writeFile(normalizedPath, (await readFile(normalizedPath, 'utf8')).replace('"tweet-101"', '"tweet-\n101"'), 'utf8')
    await updateManifestFileHash(directory, 'normalized_posts.jsonl')

    await expect(importHiggsfieldSnapshot({ snapshotDir: directory, correlationId, dryRun: true })).rejects.toThrow('invalid JSONL control character')
  })

  it('requires raw object-store authority before any non-dry Payload mutation', async () => {
    const payload = new InMemoryPayload()

    await expect(importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId })).rejects.toThrow('rawEvidenceStore is required unless dryRun is true')
    expect(payload.count('workflow-runs')).toBe(0)
    expect(payload.count('sources')).toBe(0)
  })

  it('fails closed when an idempotent workflow run belongs to another manifest', async () => {
    const payload = new InMemoryPayload()
    const probe = await importHiggsfieldSnapshot({ snapshotDir: fixtureDir, correlationId, dryRun: true })
    await payload.create({ collection: 'workflow-runs', data: { idempotency_key: `higgsfield-snapshot:${probe.manifestHash}`, job_type: 'ingest', source_version: `sha256:v1:${'0'.repeat(64)}` } })

    await expect(importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId, rawEvidenceStore: await rawEvidenceStore() })).rejects.toThrow('workflow run source_version conflict')
    expect(payload.count('sources')).toBe(0)
  })

  it('fails closed for media without a normalized source identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bo-higgsfield-orphan-'))
    temporaryDirectories.push(directory)
    await cp(fixtureDir, directory, { recursive: true })
    const mediaPath = join(directory, 'media_refs.jsonl')
    await writeFile(mediaPath, (await readFile(mediaPath, 'utf8')).replace('"tweet-101"', '"orphan-tweet"'), 'utf8')
    await updateManifestFileHash(directory, 'media_refs.jsonl')

    await expect(importHiggsfieldSnapshot({ snapshotDir: directory, correlationId, dryRun: true })).rejects.toThrow('orphan media reference orphan-tweet')
  })
})
