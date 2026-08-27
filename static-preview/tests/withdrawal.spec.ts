import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PREVIEW_ROUTES } from '../fixtures/routes'
import { buildPreview } from '../src/build'
import { APPLICATION_LOCALES, type PreviewRoute } from '../src/contracts'
import { outputPath } from '../src/paths'
import { compareUtf8Bytes } from '../src/tree'

const GIT_SHA = '0000000000000000000000000000000000000000'
const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pvb-withdrawal-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('detail-020 withdrawal proof', () => {
  it('uses a full 30-record withdrawn input, removes 16 route files, changes only the declared 48-file dependency closure, and restores byte-identically', async () => {
    const approvedDirectory = await makeTemporaryDirectory()
    const withdrawnDirectory = await makeTemporaryDirectory()
    const restoredDirectory = await makeTemporaryDirectory()
    const withdrawnRoutes: readonly PreviewRoute[] = PREVIEW_ROUTES.map((route) =>
      route.routeId === 'detail-020' ? { ...route, publicationState: 'withdrawn' } : route,
    )
    const withdrawnDetail = withdrawnRoutes.find((route) => route.routeId === 'detail-020')!
    const parent = withdrawnRoutes.find((route) => route.routeId === withdrawnDetail.parentRouteIds[0])!
    const parentGallery = withdrawnRoutes.find((route) => route.routeId === parent.parentRouteIds[0])!
    const hub = withdrawnRoutes.find(({ family }) => family === 'hub')!

    const approved = await buildPreview({ outDir: approvedDirectory, gitSha: GIT_SHA })
    const withdrawn = await buildPreview({ outDir: withdrawnDirectory, gitSha: GIT_SHA, routes: withdrawnRoutes, mode: 'withdrawn' })
    const restored = await buildPreview({ outDir: restoredDirectory, gitSha: GIT_SHA })
    const approvedHashes = new Map(approved.files.map(({ path, sha256 }) => [path, sha256]))
    const withdrawnHashes = new Map(withdrawn.files.map(({ path, sha256 }) => [path, sha256]))
    const closure = new Set(
      APPLICATION_LOCALES.flatMap((locale) => [
        outputPath(locale, hub).replace(/^\//, ''),
        outputPath(locale, parentGallery).replace(/^\//, ''),
        outputPath(locale, parent).replace(/^\//, ''),
      ]),
    )
    const changedExistingRouteFiles = withdrawn.routeFiles.filter((path) => approvedHashes.get(path) !== withdrawnHashes.get(path))
    const unchangedRouteFiles = withdrawn.routeFiles.filter((path) => approvedHashes.get(path) === withdrawnHashes.get(path))

    expect(approved.routeFiles).toHaveLength(480)
    expect(withdrawn.routeFiles).toHaveLength(464)
    expect(withdrawnRoutes).toHaveLength(30)
    expect(withdrawnDetail.publicationState).toBe('withdrawn')
    expect(approved.routeFiles.filter((path) => !withdrawn.routeFiles.includes(path))).toEqual(
      APPLICATION_LOCALES.map((locale) => outputPath(locale, withdrawnDetail).replace(/^\//, '')).sort(compareUtf8Bytes),
    )
    expect(closure.size).toBe(48)
    expect(new Set(changedExistingRouteFiles)).toEqual(closure)
    expect(unchangedRouteFiles).toHaveLength(416)
    await expect(readFile(join(withdrawnDirectory, outputPath('en', withdrawnDetail).replace(/^\//, '')), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(withdrawnDirectory, outputPath('en', parent).replace(/^\//, '')), 'utf8')).resolves.not.toContain(
      outputPath('en', withdrawnDetail).replace('/index.html', ''),
    )
    expect(restored).toEqual(approved)
  })
})
