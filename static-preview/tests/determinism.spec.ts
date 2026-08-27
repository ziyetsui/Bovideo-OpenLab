import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildPreview, copyVerifiedPinnedDependencyFile, OUTFIT_PINNED_ASSETS } from '../src/build'
import { PREVIEW_ROUTES } from '../fixtures/routes'
import type { PreviewRoute } from '../src/contracts'
import { sortPaths } from '../src/tree'
import { parsePreviewManifest, verifyPreview } from '../src/verify'

const GIT_SHA = '0000000000000000000000000000000000000000'
const temporaryDirectories: string[] = []
const require = createRequire(import.meta.url)
const joinParts = (...parts: readonly string[]): string => parts.join('')
const compareUtf8Bytes = (left: string, right: string): number => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pvb-determinism-'))
  temporaryDirectories.push(directory)
  return directory
}

async function filesAt(root: string): Promise<ReadonlyMap<string, Buffer>> {
  const files = new Map<string, Buffer>()

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath)
      } else {
        files.set(relative(root, absolutePath), await readFile(absolutePath))
      }
    }
  }

  await visit(root)
  return files
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('deterministic static Preview build', () => {
  it('emits the exact Pages root redirect without changing unknown-route handling', async () => {
    const outputDirectory = await makeTemporaryDirectory()
    const manifest = await buildPreview({ outDir: outputDirectory, gitSha: GIT_SHA })
    const files = await filesAt(outputDirectory)

    expect(files.get('_redirects')?.toString('utf8')).toBe('/ /en/prompts/ 302\n')
    expect(manifest.files.map(({ path }) => path)).toContain('_redirects')
    expect(files.get('404.html')?.toString('utf8')).toContain('<h1>Preview unavailable</h1>')
  })

  it('uses the independent UTF-8 byte-order oracle for punctuation-sensitive manifest paths and snapshot bytes', async () => {
    const outputDirectory = await makeTemporaryDirectory()
    const manifest = await buildPreview({ outDir: outputDirectory, gitSha: GIT_SHA })
    const punctuationPaths = [
      '_headers',
      '_redirects',
      '404.html',
      'assets/menu.js',
      'assets/OUTFIT-OFL-1.1.txt',
      'assets/outfit-latin-wght-normal.woff2',
      'assets/styles.css',
    ]
    const oracleOrder = [...punctuationPaths].sort(compareUtf8Bytes)

    expect(oracleOrder).toEqual([
      '404.html',
      '_headers',
      '_redirects',
      'assets/OUTFIT-OFL-1.1.txt',
      'assets/menu.js',
      'assets/outfit-latin-wght-normal.woff2',
      'assets/styles.css',
    ])
    expect(sortPaths(punctuationPaths.map((path) => ({ path }))).map(({ path }) => path)).toEqual(oracleOrder)
    expect(manifest.files.map(({ path }) => path)).toEqual([...manifest.files.map(({ path }) => path)].sort(compareUtf8Bytes))
    expect(manifest.previewSnapshotId).toBe('97d8b41b7df339ae9b688a047203f4fa2fa9726c42fcd61d036554328369139e')
  })

  it('writes an identical 480-route tree and self-excluding manifest for an explicit Git SHA', async () => {
    const firstDirectory = await makeTemporaryDirectory()
    const secondDirectory = await makeTemporaryDirectory()

    const [firstManifest, secondManifest] = await Promise.all([
      buildPreview({ outDir: firstDirectory, gitSha: GIT_SHA }),
      buildPreview({ outDir: secondDirectory, gitSha: GIT_SHA }),
    ])
    const [firstFiles, secondFiles] = await Promise.all([filesAt(firstDirectory), filesAt(secondDirectory)])

    expect(firstManifest.gitSha).toBe(GIT_SHA)
    expect(firstManifest.routeFiles).toHaveLength(480)
    expect(firstManifest.files.map(({ path, sha256, bytes }) => `${path}\u0000${sha256}\u0000${bytes}`)).toEqual(
      [...firstManifest.files]
        .sort((left, right) => compareUtf8Bytes(left.path, right.path))
        .map(({ path, sha256, bytes }) => `${path}\u0000${sha256}\u0000${bytes}`),
    )
    expect(firstManifest).toEqual(secondManifest)
    expect([...firstFiles.keys()].sort()).toEqual([...secondFiles.keys()].sort())

    for (const [path, contents] of firstFiles) {
      expect(secondFiles.get(path)).toEqual(contents)
    }

    const snapshotDomain = firstManifest.files
      .filter(({ path }) => path !== 'preview-manifest.json')
      .sort((left, right) => compareUtf8Bytes(left.path, right.path))
      .map(({ path, sha256 }) => `${path}\u0000${sha256}\n`)
      .join('')
    expect(firstManifest.previewSnapshotId).toBe(createHash('sha256').update(snapshotDomain).digest('hex'))
    expect(firstManifest.files).toHaveLength(488)
    expect(firstManifest.files.map(({ path }) => path)).toEqual(expect.arrayContaining([
      '_redirects',
      'assets/OUTFIT-OFL-1.1.txt',
      'assets/outfit-latin-wght-normal.woff2',
    ]))
    expect(firstManifest.files.some(({ path }) => path === 'preview-manifest.json')).toBe(false)
    expect(firstFiles.get('preview-manifest.json')?.toString('utf8').endsWith('\n')).toBe(true)
  })

  it('verifies a second independent build against the declared tree digest domain', async () => {
    const outputDirectory = await makeTemporaryDirectory()

    const manifest = await verifyPreview({ outDir: outputDirectory, gitSha: GIT_SHA })

    expect(manifest.routeFiles).toHaveLength(480)
    expect(manifest.previewSnapshotId).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects reordered full cohorts and unknown route fields before writing output', async () => {
    const reorderedDirectory = await makeTemporaryDirectory()
    const unknownFieldDirectory = await makeTemporaryDirectory()
    const undefinedFieldDirectory = await makeTemporaryDirectory()
    const withUnknownField = [{ ...PREVIEW_ROUTES[0], unexpected: 'reject-me' }, ...PREVIEW_ROUTES.slice(1)] as unknown as readonly PreviewRoute[]
    const withUndefinedUnknownField = [{ ...PREVIEW_ROUTES[0], unexpected: undefined }, ...PREVIEW_ROUTES.slice(1)] as unknown as readonly PreviewRoute[]

    await expect(buildPreview({ outDir: reorderedDirectory, gitSha: GIT_SHA, routes: [...PREVIEW_ROUTES].reverse() })).rejects.toThrow(
      /canonical/i,
    )
    await expect(buildPreview({ outDir: unknownFieldDirectory, gitSha: GIT_SHA, routes: withUnknownField })).rejects.toThrow(
      /canonical/i,
    )
    await expect(buildPreview({ outDir: undefinedFieldDirectory, gitSha: GIT_SHA, routes: withUndefinedUnknownField })).rejects.toThrow(
      /canonical/i,
    )
  })

  it.each(OUTFIT_PINNED_ASSETS)('rejects a tampered $destinationPath source before it can produce a deployment-ready tree', async (asset) => {
    const outputDirectory = await makeTemporaryDirectory()
    const tamperedSource = join(outputDirectory, 'tampered-source')
    await writeFile(tamperedSource, 'tampered pinned dependency', 'utf8')

    await expect(
      buildPreview({
        outDir: outputDirectory,
        gitSha: GIT_SHA,
        resolvePinnedDependencyPath: (dependencyPath) =>
          dependencyPath === asset.dependencyPath ? tamperedSource : require.resolve(dependencyPath),
      }),
    ).rejects.toThrow(/expected SHA-256/i)
  })

  it.each(OUTFIT_PINNED_ASSETS)('rejects a tampered copied $destinationPath before output can be published', async (asset) => {
    const outputDirectory = await makeTemporaryDirectory()

    await expect(
      copyVerifiedPinnedDependencyFile({
        sourcePath: require.resolve(asset.dependencyPath),
        destinationPath: join(outputDirectory, asset.destinationPath),
        expectedSha256: asset.sha256,
        copy: async (_source, destination) => writeFile(destination, 'tampered copied dependency', 'utf8'),
      }),
    ).rejects.toThrow(/expected SHA-256/i)
  })

  it('keeps public Outfit provenance bound to the hashes enforced by the build', async () => {
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8')

    for (const asset of OUTFIT_PINNED_ASSETS) {
      expect(readme).toContain(asset.destinationPath.split('/').at(-1)!)
      expect(readme).toContain(asset.sha256)
    }
  })

  it('parses only the exact emitted manifest schema before verification consumes it', async () => {
    const outputDirectory = await makeTemporaryDirectory()
    const manifest = await buildPreview({ outDir: outputDirectory, gitSha: GIT_SHA })
    const emitted = await readFile(join(outputDirectory, 'preview-manifest.json'), 'utf8')
    const parsed = JSON.parse(emitted) as Record<string, unknown>

    expect(parsePreviewManifest(emitted)).toEqual(manifest)
    expect(() => parsePreviewManifest(`${JSON.stringify({ ...parsed, unexpected: true })}\n`)).toThrow(/exact schema/i)
    const { files: _files, ...withoutFiles } = parsed
    expect(() => parsePreviewManifest(`${JSON.stringify(withoutFiles)}\n`)).toThrow(/exact schema/i)
    expect(() => parsePreviewManifest(emitted.replace('"gitSha":', joinParts('"git', 'Sha":"bad","git', 'Sha":')))).toThrow(
      /canonical bytes/i,
    )
    expect(() => parsePreviewManifest(emitted.replace('"path":', joinParts('"path":"bad","path":')))).toThrow(
      /canonical bytes/i,
    )
  })
})
