import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { PREVIEW_COPY } from '../fixtures/copy'
import { PREVIEW_ROUTES } from '../fixtures/routes'
import { APPLICATION_LOCALES, PREVIEW_MODES, type ApplicationLocale, type PreviewMode, type PreviewRoute } from './contracts'
import { outputPath } from './paths'
import { renderRoute } from './render'
import { scanPreview } from './scan'
import { compareUtf8Bytes, readTree, sha256, snapshotId, type FileDigest } from './tree'
import { validateCohort, validatePreviewCopy } from './validate'

const require = createRequire(import.meta.url)

export type PinnedOutfitAsset = Readonly<{
  dependencyPath: string
  destinationPath: string
  sha256: string
}>

export const OUTFIT_PINNED_ASSETS = [
  {
    dependencyPath: '@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2',
    destinationPath: 'assets/outfit-latin-wght-normal.woff2',
    sha256: '6c18d579fd87c3776be068b762cbc83fde3acb543d49eabd3ade842eb987e887',
  },
  {
    dependencyPath: '@fontsource-variable/outfit/LICENSE',
    destinationPath: 'assets/OUTFIT-OFL-1.1.txt',
    sha256: '0e5fcef5d93bfcae273c11c00f0bb453d3b5491860e1ac8b658767b7577c938f',
  },
] as const satisfies readonly PinnedOutfitAsset[]

export type PinnedDependencyPathResolver = (dependencyPath: string) => string
export type PinnedDependencyCopy = (sourcePath: string, destinationPath: string) => Promise<void>

export type PreviewManifest = Readonly<{
  schemaVersion: 1
  generatorVersion: '1.0.0'
  gitSha: string
  inputHash: string
  previewSnapshotId: string
  routeIds: readonly string[]
  locales: readonly ApplicationLocale[]
  routeFiles: readonly string[]
  files: readonly FileDigest[]
}>

function assertGitSha(gitSha: string): void {
  if (!/^[a-f0-9]{40}$/.test(gitSha)) {
    throw new Error('Preview build requires an explicit 40-hex Git SHA')
  }
}

function approvedRoutes(routes: readonly PreviewRoute[]): PreviewRoute[] {
  return routes.filter((route) => route.publicationState === 'approved')
}

export function previewRoutesForMode(mode: PreviewMode): readonly PreviewRoute[] {
  return mode === 'baseline'
    ? PREVIEW_ROUTES
    : PREVIEW_ROUTES.map((route) => (route.routeId === 'detail-020' ? { ...route, publicationState: 'withdrawn' } : route))
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesCanonicalValue(value: unknown, canonical: unknown): boolean {
  if (Object.is(value, canonical)) return true
  if (Array.isArray(value) && Array.isArray(canonical)) {
    return value.length === canonical.length && value.every((item, index) => matchesCanonicalValue(item, canonical[index]))
  }
  if (!isRecord(value) || !isRecord(canonical)) return false

  const keys = Reflect.ownKeys(value)
  const canonicalKeys = Reflect.ownKeys(canonical)
  return (
    keys.length === canonicalKeys.length &&
    keys.every((key, index) => key === canonicalKeys[index] && matchesCanonicalValue(value[key], canonical[key]))
  )
}

function validateBuildSelection(routes: readonly PreviewRoute[], mode: PreviewMode): void {
  validateCohort(routes)
  const canonicalRoutes = previewRoutesForMode(mode)
  if (routes.some((route, index) => !matchesCanonicalValue(route, canonicalRoutes[index]))) {
    throw new Error(`Preview ${mode} selection must be the canonical route sequence`)
  }
}

function inputHash(routes: readonly PreviewRoute[]): string {
  return sha256(
    JSON.stringify({
      generatorVersion: '1.0.0',
      routes,
      copy: PREVIEW_COPY,
      locales: APPLICATION_LOCALES,
    }),
  )
}

function manifestJson(manifest: PreviewManifest): string {
  return `${JSON.stringify(manifest)}\n`
}

async function writeOutput(root: string, relativePath: string, contents: string): Promise<void> {
  const destination = join(root, relativePath)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, contents, 'utf8')
}

async function copyPublicFile(root: string, sourceName: string, destinationPath: string): Promise<void> {
  const destination = join(root, destinationPath)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(new URL(`../public/${sourceName}`, import.meta.url), destination)
}

function assertExpectedSha256(label: string, contents: Buffer, expectedSha256: string): void {
  if (sha256(contents) !== expectedSha256) {
    throw new Error(`Pinned ${label} did not match its expected SHA-256`)
  }
}

export async function assertVerifiedPinnedDependencySource(options: Readonly<{ sourcePath: string; expectedSha256: string; label: string }>): Promise<void> {
  assertExpectedSha256(options.label, await readFile(options.sourcePath), options.expectedSha256)
}

export async function copyVerifiedPinnedDependencyFile(options: Readonly<{
  sourcePath: string
  destinationPath: string
  expectedSha256: string
  copy?: PinnedDependencyCopy
}>): Promise<void> {
  await assertVerifiedPinnedDependencySource({
    sourcePath: options.sourcePath,
    expectedSha256: options.expectedSha256,
    label: options.destinationPath,
  })
  const destination = options.destinationPath
  await mkdir(dirname(destination), { recursive: true })
  await (options.copy ?? copyFile)(options.sourcePath, destination)
  assertExpectedSha256(destination, await readFile(destination), options.expectedSha256)
}

export async function buildPreview(options: {
  outDir: string
  gitSha: string
  routes?: readonly PreviewRoute[]
  mode?: PreviewMode
  resolvePinnedDependencyPath?: PinnedDependencyPathResolver
}): Promise<PreviewManifest> {
  assertGitSha(options.gitSha)
  validatePreviewCopy(PREVIEW_COPY)
  const mode = options.mode ?? 'baseline'
  if (!PREVIEW_MODES.includes(mode)) {
    throw new Error(`Unknown Preview mode: ${mode}`)
  }
  const sourceRoutes = options.routes ?? previewRoutesForMode(mode)
  validateBuildSelection(sourceRoutes, mode)
  const routes = approvedRoutes(sourceRoutes)
  const resolvePinnedDependencyPath = options.resolvePinnedDependencyPath ?? require.resolve
  const pinnedSources = OUTFIT_PINNED_ASSETS.map((asset) => ({ ...asset, sourcePath: resolvePinnedDependencyPath(asset.dependencyPath) }))
  await Promise.all(
    pinnedSources.map((asset) =>
      assertVerifiedPinnedDependencySource({
        sourcePath: asset.sourcePath,
        expectedSha256: asset.sha256,
        label: asset.destinationPath,
      }),
    ),
  )
  const routeFiles = APPLICATION_LOCALES.flatMap((locale) =>
    routes.map((route) => outputPath(locale, route).replace(/^\//, '')),
  ).sort(compareUtf8Bytes)

  await rm(options.outDir, { recursive: true, force: true })
  await mkdir(options.outDir, { recursive: true })

  await Promise.all(
    APPLICATION_LOCALES.flatMap((locale) =>
      routes.map(async (route) => {
        const output = outputPath(locale, route).replace(/^\//, '')
        await writeOutput(options.outDir, output, renderRoute({ route, locale, cohort: routes, copy: PREVIEW_COPY }))
      }),
    ),
  )
  await Promise.all([
    copyPublicFile(options.outDir, 'styles.css', 'assets/styles.css'),
    copyPublicFile(options.outDir, 'menu.js', 'assets/menu.js'),
    ...pinnedSources.map((asset) =>
      copyVerifiedPinnedDependencyFile({
        sourcePath: asset.sourcePath,
        destinationPath: join(options.outDir, asset.destinationPath),
        expectedSha256: asset.sha256,
      }),
    ),
    copyPublicFile(options.outDir, '_headers', '_headers'),
    copyPublicFile(options.outDir, '_redirects', '_redirects'),
    copyPublicFile(options.outDir, 'robots.txt', 'robots.txt'),
  ])
  await writeOutput(options.outDir, '404.html', '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>Preview unavailable</title></head><body><main><h1>Preview unavailable</h1><p>This synthetic Preview route is unavailable.</p></main></body></html>\n')

  const files = await readTree(options.outDir)
  const manifest: PreviewManifest = {
    schemaVersion: 1,
    generatorVersion: '1.0.0',
    gitSha: options.gitSha,
    inputHash: inputHash(sourceRoutes),
    previewSnapshotId: snapshotId(files),
    routeIds: routes.map((route) => route.routeId),
    locales: APPLICATION_LOCALES,
    routeFiles,
    files,
  }
  await writeOutput(options.outDir, 'preview-manifest.json', manifestJson(manifest))
  const findings = await scanPreview(options.outDir)
  if (findings.length) {
    throw new Error(`Preview output failed security scan with ${findings.length} redacted finding(s)`)
  }
  return manifest
}
