import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { principals } from '@/access/principals'
import { archivePrivateEvidenceDirectory, importAssetsRoot, planAssetsRootImport, recordDerivedEvidenceWorkflow } from '@/imports/assets-root'
import { LocalObjectStore } from '@/storage/local-object-store'

const roots: string[] = []

const assetRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'bo-assets-root-'))
  roots.push(root)
  await Promise.all([
    mkdir(join(root, 'higgsfield-x-prompts-2026-08-20-twitter241')),
    mkdir(join(root, 'higgsfield-x-prompts-2026-08-20')),
    mkdir(join(root, 'higgsfield-x-prompts-2026-08-20-twitter241-derived')),
  ])
  await Promise.all([
    writeFile(join(root, '.DS_Store'), 'macOS metadata'),
    writeFile(join(root, 'higgsfield-x-prompts-2026-08-20-twitter241', 'manifest.json'), '{}'),
    writeFile(join(root, 'higgsfield-x-prompts-2026-08-20', 'manifest.json'), '{}'),
    writeFile(join(root, 'higgsfield-x-prompts-2026-08-20-twitter241-derived', 'README.md'), 'derived'),
    writeFile(join(root, 'higgsfield-x-prompts-2026-08-20-twitter241-derived', 'media_refs.jsonl'), '{}\n'),
  ])
  return root
}

afterEach(async () => { await Promise.all(roots.splice(0).map(async (root) => await (await import('node:fs/promises')).rm(root, { recursive: true, force: true }))) })

describe('assets-root import planning', () => {
  it('orders canonical and legacy snapshot imports, archives the derived evidence directory, and ignores macOS metadata', async () => {
    const root = await assetRoot()

    await expect(planAssetsRootImport(root)).resolves.toMatchObject({
      snapshots: [
        { kind: 'canonical_twitter241', directory: join(root, 'higgsfield-x-prompts-2026-08-20-twitter241') },
        { kind: 'legacy_public_search', directory: join(root, 'higgsfield-x-prompts-2026-08-20') },
      ],
      derived: [{ directory: join(root, 'higgsfield-x-prompts-2026-08-20-twitter241-derived') }],
      ignored: [{ entry: '.DS_Store', reason: 'macos_metadata' }],
    })
  })

  it('fails closed before import when the root contains an unknown entry', async () => {
    const root = await assetRoot()
    await writeFile(join(root, 'unclassified.csv'), 'untrusted')

    await expect(planAssetsRootImport(root)).rejects.toThrow('unrecognized assets-root entry')
  })

  it('archives derived assets as private evidence without assigning them any business collection', async () => {
    const root = await assetRoot()
    const directory = join(root, 'higgsfield-x-prompts-2026-08-20-twitter241-derived')
    const objectRoot = await mkdtemp(join(tmpdir(), 'bo-derived-evidence-'))
    roots.push(objectRoot)
    const store = new LocalObjectStore({ root_dir: objectRoot, signer_secret: 'derived-evidence-test-signer' })

    const evidence = await archivePrivateEvidenceDirectory({
      directory,
      label: 'twitter241-derived',
      store,
    })
    const bytes = await store.get({ principal: principals.ingestService, ref: evidence })
    const index = JSON.parse(Buffer.from(bytes.bytes).toString('utf8')) as { kind: string; files: { filename: string; content_hash: string }[] }

    expect(evidence.namespace).toBe('raw-evidence')
    expect(index.kind).toBe('derived-evidence')
    expect(index.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: 'README.md', content_hash: expect.any(String) }),
      expect.objectContaining({ filename: 'media_refs.jsonl', content_hash: expect.any(String) }),
    ]))
    expect(await readFile(join(directory, 'README.md'), 'utf8')).toBe('derived')
  })

  it('imports snapshots in canonical order then archives derived evidence without turning it into business data', async () => {
    const root = await assetRoot()
    const objectRoot = await mkdtemp(join(tmpdir(), 'bo-root-import-'))
    roots.push(objectRoot)
    const imported: string[] = []

    const result = await importAssetsRoot({
      rootDirectory: root,
      store: new LocalObjectStore({ root_dir: objectRoot, signer_secret: 'root-import-test-signer' }),
      importSnapshot: async (directory) => { imported.push(directory); return { directory } },
    })

    expect(imported).toEqual([
      join(root, 'higgsfield-x-prompts-2026-08-20-twitter241'),
      join(root, 'higgsfield-x-prompts-2026-08-20'),
    ])
    expect(result.derived).toHaveLength(1)
    expect(result.ignored).toEqual([{ entry: '.DS_Store', reason: 'macos_metadata' }])
  })

  it('records the derived evidence index in the immutable Payload workflow ledger', async () => {
    const root = await assetRoot()
    const objectRoot = await mkdtemp(join(tmpdir(), 'bo-derived-ledger-'))
    roots.push(objectRoot)
    const evidence = await archivePrivateEvidenceDirectory({
      directory: join(root, 'higgsfield-x-prompts-2026-08-20-twitter241-derived'), label: 'twitter241-derived',
      store: new LocalObjectStore({ root_dir: objectRoot, signer_secret: 'derived-ledger-test-signer' }),
    })
    const records: (Record<string, unknown> & { id: number })[] = []
    const payload = {
      find: async () => ({ docs: records }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = { id: 1, status: 'queued', revision: 1, stable_id: '00000000-0000-4000-8000-000000000401', ...data }
        records.push(record); return record
      },
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(records[0], data),
    }

    await recordDerivedEvidenceWorkflow({ payload, evidence })

    expect(records).toEqual([expect.objectContaining({
      job_type: 'ingest', source_version: evidence.content_hash, status: 'succeeded',
      input_ref: `raw-evidence://${evidence.key}`,
    })])
  })
})
